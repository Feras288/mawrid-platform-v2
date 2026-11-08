import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, dec, invalidState, isAppError, notFound, validation } from "@platform/core";
import { parseLocaleNumber } from "@platform/core/text";
import { nextDocNumber, pageParams, withContext, withSystem, type Tx } from "@platform/db";
import {
  boqDocuments,
  boqItemMatches,
  boqItemRevisions,
  boqItems,
  boqProcessingRuns,
  boqVersions,
  categories,
  units,
  type BoqVersionLine,
  type ColumnMapping,
} from "@platform/db/schema";
import { getOcr } from "@platform/integrations/ocr";
import { aiPolicyFor, assertBudget, recordAiUsage } from "../ai";
import { audit } from "../audit";
import { authorize, requireOrg } from "../authz";
import { attributesForCategory, normalizeAttributes } from "../catalog";
import { dbCtx, type Ctx } from "../context";
import { readFileContent, uploadFile } from "../files";
import { canonicalNames, decide, findMatches, loadMatchContext } from "../matching";
import { notifyUsers } from "../notifications";
import { emit } from "../outbox";
import { assertProjectAccess, logActivity } from "../projects";
import { resolveUnitCode } from "../reference";
import { parseSpreadsheet } from "../spreadsheet";
import { detectMapping, inferMapping, itemsToLines, lineConfidence, linesToGrid, parseRows, type Mapping, type ParsedLine, type TextItem } from "./extract";
import { classifyCategory, detectLanguage, extractAttributes } from "./normalize";

export * from "./extract";
export * from "./normalize";

const MIME_SOURCE: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "application/pdf": "pdf",
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
};

// ------------------------------------------------------------------------------------------ upload

export async function uploadBoq(ctx: Ctx, input: { projectId?: string | null; title?: string | null }, file: { buffer: Buffer; fileName: string }) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "boq.upload", { write: true });
  const policy = await aiPolicyFor(ctx.orgId);
  return withContext(dbCtx(ctx), async (tx) => {
    await assertProjectAccess(tx, ctx, input.projectId);
    const f = await uploadFile(ctx, { buffer: file.buffer, fileName: file.fileName, ownerType: "boq_document", classification: "confidential" }, tx);
    const sourceType = MIME_SOURCE[f.mimeType] ?? "unknown";
    const code = await nextDocNumber(tx, ctx.orgId, "boq", "BOQ");
    const [doc] = await tx
      .insert(boqDocuments)
      .values({ orgId: ctx.orgId, projectId: input.projectId ?? null, code, title: input.title?.trim() || f.originalName, fileId: f.id, sourceType, useAi: policy.allowed, createdBy: ctx.userId })
      .returning();
    await tx.execute(sql`update files set owner_id = ${doc!.id} where id = ${f.id}`);
    await emit({ topic: "boq.uploaded", aggregateType: "boq_document", aggregateId: doc!.id, orgId: ctx.orgId, payload: { documentId: doc!.id } }, tx);
    if (input.projectId) await logActivity(tx, ctx, input.projectId, "boq.uploaded", { type: "boq_document", id: doc!.id }, { title: doc!.title });
    await audit(ctx, { action: "boq.uploaded", entityType: "boq_document", entityId: doc!.id, data: { sourceType, aiAllowed: policy.allowed, aiReason: policy.reason } }, tx);
    return doc!;
  });
}

/** A BOQ entered by hand (no file); lines are added in the review screen. */
export async function createManualBoq(ctx: Ctx, input: { projectId?: string | null; title: string }) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "boq.upload", { write: true });
  const title = z.string().trim().min(2).max(200).parse(input.title);
  return withContext(dbCtx(ctx), async (tx) => {
    await assertProjectAccess(tx, ctx, input.projectId);
    const code = await nextDocNumber(tx, ctx.orgId, "boq", "BOQ");
    const [doc] = await tx.insert(boqDocuments).values({ orgId: ctx.orgId, projectId: input.projectId ?? null, code, title, sourceType: "manual", status: "needs_review", createdBy: ctx.userId }).returning();
    await audit(ctx, { action: "boq.created_manual", entityType: "boq_document", entityId: doc!.id }, tx);
    return doc!;
  });
}

// ------------------------------------------------------------------------------------------ pipeline

async function startRun(documentId: string, orgId: string, stage: string, method?: string) {
  const [r] = await withSystem((tx) => tx.insert(boqProcessingRuns).values({ documentId, orgId, stage, status: "started", method: method ?? null }).returning({ id: boqProcessingRuns.id }));
  return r!.id;
}
async function endRun(id: string, status: "completed" | "failed", details: Record<string, unknown> = {}, error?: string) {
  await withSystem((tx) => tx.update(boqProcessingRuns).set({ status, details, error: error ?? null, finishedAt: new Date() }).where(eq(boqProcessingRuns.id, id)));
}
async function setStatus(documentId: string, status: string, patch: Partial<typeof boqDocuments.$inferInsert> = {}) {
  await withSystem((tx) => tx.update(boqDocuments).set({ status, ...patch }).where(eq(boqDocuments.id, documentId)));
}

interface Extracted {
  lines: ParsedLine[];
  method: "rule" | "ai" | "ocr";
  outcome: "ok" | "needs_column_mapping" | "needs_manual_entry";
  preview?: { sheet: string; rows: string[][] }[];
  aiCostUsd?: number;
}

async function pdfTextItems(buffer: Buffer): Promise<TextItem[]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const items: TextItem[] = [];
  const pages = Math.min(pdf.numPages, 300);
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items as { str?: string; transform?: number[]; width?: number }[]) {
      if (typeof it.str === "string" && it.transform) items.push({ str: it.str, x: it.transform[4]!, y: it.transform[5]!, width: it.width ?? it.str.length * 5, page: p });
    }
  }
  return items;
}

async function aiExtract(doc: typeof boqDocuments.$inferSelect, input: Parameters<Awaited<ReturnType<typeof aiPolicyFor>>["provider"]["extractBoqLines"]>[0], fileName: string): Promise<Extracted> {
  const policy = await aiPolicyFor(doc.orgId);
  if (!doc.useAi || !policy.allowed) return { lines: [], method: "ai", outcome: "needs_manual_entry" };
  await assertBudget(doc.orgId);
  try {
    const { lines, usage } = await policy.provider.extractBoqLines(input, { fileName });
    await recordAiUsage({ orgId: doc.orgId, purpose: "boq_extraction", documentId: doc.id, usage });
    const parsed: ParsedLine[] = lines.map((l, i) => {
      const qty = l.quantity ? parseLocaleNumber(l.quantity) : null;
      const issues = ["ai_extracted"];
      if (!qty) issues.push("quantity_missing");
      if (!l.unit) issues.push("unit_missing");
      return { lineNo: i + 1, itemCode: l.itemCode, section: l.section, rawText: l.description, description: l.description, quantity: qty, unitRaw: l.unit, source: { page: l.page ?? undefined }, issues };
    });
    return { lines: parsed, method: "ai", outcome: parsed.length ? "ok" : "needs_manual_entry", aiCostUsd: usage.costUsd };
  } catch (e) {
    const usage = (e as { usage?: Parameters<typeof recordAiUsage>[0]["usage"] }).usage ?? null;
    await recordAiUsage({ orgId: doc.orgId, purpose: "boq_extraction", documentId: doc.id, usage, provider: policy.provider.name, error: isAppError(e) ? e.messageKey : "error" });
    throw e;
  }
}

async function extract(doc: typeof boqDocuments.$inferSelect, unitAliases: Set<string>): Promise<Extracted> {
  const { buffer, file } = await withSystem((tx) => readFileContent(tx, doc.fileId!));
  if (doc.sourceType === "xlsx" || doc.sourceType === "csv") {
    const sheets = await parseSpreadsheet(buffer, file.mimeType);
    const override = doc.columnMapping;
    const lines: ParsedLine[] = [];
    for (const sh of sheets) {
      if (override?.sheet && override.sheet !== sh.name) continue;
      let m: Mapping | null;
      if (override && override.description !== undefined && override.quantity !== undefined) {
        m = { headerRow: override.headerRow ?? 0, description: override.description, quantity: override.quantity, unit: override.unit, itemCode: override.itemCode, score: 99 };
      } else m = detectMapping(sh.rows) ?? inferMapping(sh.rows, unitAliases);
      if (!m) continue;
      for (const l of parseRows(sh.rows, m, { sheet: sh.name })) lines.push({ ...l, lineNo: lines.length + 1 });
    }
    if (!lines.length) return { lines, method: "rule", outcome: "needs_column_mapping", preview: sheets.slice(0, 5).map((s) => ({ sheet: s.name, rows: s.rows.slice(0, 15) })) };
    return { lines, method: "rule", outcome: "ok" };
  }
  if (doc.sourceType === "pdf") {
    const items = await pdfTextItems(buffer);
    const textChars = items.reduce((a, i) => a + i.str.trim().length, 0);
    if (textChars < 40) {
      await setStatus(doc.id, "extracting", { sourceType: "pdf_scanned" });
      return aiExtract(doc, { kind: "pdf", base64: buffer.toString("base64") }, file.originalName);
    }
    const { rows, pages } = linesToGrid(itemsToLines(items));
    const m = detectMapping(rows);
    const lines = m ? parseRows(rows, m, { page: (r) => pages[r] }) : [];
    if (lines.length) return { lines, method: "rule", outcome: "ok" };
    // text PDF without a recognizable table: AI if allowed, else manual
    if (doc.useAi) return aiExtract(doc, { kind: "pdf", base64: buffer.toString("base64") }, file.originalName);
    return { lines: [], method: "rule", outcome: "needs_manual_entry" };
  }
  if (doc.sourceType === "image") {
    if (doc.useAi) return aiExtract(doc, { kind: "image", base64: buffer.toString("base64"), mediaType: file.mimeType as "image/png" }, file.originalName);
    const ocr = getOcr();
    if (ocr.isConfigured()) {
      const res = await ocr.recognize(buffer);
      const items: TextItem[] = res.words.map((w) => ({ str: w.text, x: w.x0, y: -w.y0, width: w.x1 - w.x0, page: 1 }));
      const { rows } = linesToGrid(itemsToLines(items, 8));
      const m = detectMapping(rows);
      const lines = m ? parseRows(rows, m).map((l) => ({ ...l, issues: [...l.issues, "ocr_extracted"] })) : [];
      return { lines, method: "ocr", outcome: lines.length ? "ok" : "needs_manual_entry" };
    }
    return { lines: [], method: "rule", outcome: "needs_manual_entry" };
  }
  return { lines: [], method: "rule", outcome: "needs_manual_entry" };
}

/**
 * Process a BOQ document end-to-end (worker). Idempotent: re-running replaces unapproved extracted
 * lines. Stages and errors are recorded in boq_processing_runs.
 */
export async function processBoq(documentId: string): Promise<{ status: string; lines: number }> {
  const [doc] = await withSystem((tx) => tx.select().from(boqDocuments).where(eq(boqDocuments.id, documentId)).limit(1));
  if (!doc) throw notFound("BOQ");
  if (doc.status === "approved") return { status: doc.status, lines: doc.stats.lines ?? 0 };
  const unitRows = await withSystem((tx) => tx.select({ code: units.code, aliases: units.aliases, dimension: units.dimension }).from(units));
  const unitAliases = new Set(unitRows.flatMap((u) => [u.code, ...u.aliases.map((a) => a.toLowerCase())]));

  await setStatus(documentId, "extracting", { error: null, statusDetail: null });
  const runId = await startRun(documentId, doc.orgId, "extract");
  let ex: Extracted;
  try {
    ex = await extract(doc, unitAliases);
    await endRun(runId, "completed", { lines: ex.lines.length, method: ex.method, outcome: ex.outcome, preview: ex.preview });
  } catch (e) {
    const key = isAppError(e) ? e.messageKey : "extraction_failed";
    await endRun(runId, "failed", {}, key);
    await setStatus(documentId, "failed", { error: key });
    // Known errors (validation, provider failures, budget) are final: retrying would repeat paid AI calls.
    if (isAppError(e) && e.code !== "INTERNAL") return { status: "failed", lines: 0 };
    throw e;
  }
  if (ex.outcome !== "ok") {
    await setStatus(documentId, ex.outcome, { statusDetail: ex.outcome });
    return { status: ex.outcome, lines: 0 };
  }

  // normalize
  await setStatus(documentId, "normalizing");
  const nRun = await startRun(documentId, doc.orgId, "normalize");
  const cats = await withSystem((tx) => tx.select({ id: categories.id, slug: categories.slug, system: categories.system }).from(categories));
  const normalized = ex.lines.map((l) => {
    const unit = resolveUnitCode(l.unitRaw, unitRows);
    const attributes = extractAttributes(`${l.description}`);
    const cls = classifyCategory(l.description, l.section);
    const cat = cls ? cats.find((c) => c.slug === cls.slug) : undefined;
    const issues = [...l.issues];
    if (l.unitRaw && !unit) issues.push("unit_unknown");
    if (!cat) issues.push("category_unknown");
    const lang = detectLanguage(l.description);
    return { ...l, unit, attributes, categoryId: cat?.id ?? null, system: cat?.system ?? null, lang, issues };
  });
  await endRun(nRun, "completed", { classified: normalized.filter((n) => n.categoryId).length });

  // persist lines (replace previous unapproved extraction)
  await withSystem(async (tx) => {
    await tx.delete(boqItems).where(eq(boqItems.documentId, documentId));
    if (normalized.length) {
      for (let i = 0; i < normalized.length; i += 500) {
        await tx.insert(boqItems).values(
          normalized.slice(i, i + 500).map((l) => ({
            documentId,
            orgId: doc.orgId,
            lineNo: l.lineNo,
            itemCode: l.itemCode,
            section: l.section,
            system: l.system,
            categoryId: l.categoryId,
            rawText: l.rawText.slice(0, 4000),
            description: l.description.slice(0, 4000),
            descriptionAr: l.lang === "ar" ? l.description.slice(0, 4000) : null,
            descriptionEn: l.lang === "en" ? l.description.slice(0, 4000) : null,
            quantity: l.quantity ? dec(l.quantity).toFixed(4) : null,
            unitRaw: l.unitRaw,
            unit: l.unit,
            attributes: l.attributes,
            source: l.source,
            extractionMethod: ex.method,
            confidence: lineConfidence({ description: l.description, quantity: l.quantity, unit: l.unit, issues: l.issues }).toFixed(4),
            issues: l.issues,
          })),
        );
      }
    }
  });

  // match
  await setStatus(documentId, "matching");
  const mRun = await startRun(documentId, doc.orgId, "match");
  const counts = await matchDocument(documentId, doc.orgId, doc.useAi);
  await endRun(mRun, "completed", counts);

  const stats = await computeStats(documentId);
  await setStatus(documentId, "needs_review", { stats: { ...stats, aiCostUsd: ex.aiCostUsd ?? 0 } });
  await withSystem(async (tx) => {
    if (doc.createdBy)
      await notifyUsers(
        { userIds: [doc.createdBy], kind: "boq.processed", params: { fileName: doc.title, lines: stats.lines ?? 0, review: stats.needsReview ?? 0 }, link: `/org/boq/${documentId}`, orgId: doc.orgId, dedupeKey: `boq-processed:${documentId}:${Date.now()}`, email: true },
        tx,
      );
    await emit({ topic: "boq.processed", aggregateType: "boq_document", aggregateId: documentId, orgId: doc.orgId, payload: { documentId, lines: stats.lines } }, tx);
  });
  return { status: "needs_review", lines: stats.lines ?? 0 };
}

const AI_RERANK_LIMIT = 30;

/** Match every unconfirmed item of a document; optionally AI re-rank ambiguous ones (budgeted). */
export async function matchDocument(documentId: string, orgId: string, useAi: boolean) {
  const items = await withSystem((tx) => tx.select().from(boqItems).where(and(eq(boqItems.documentId, documentId), ne(boqItems.matchStatus, "confirmed"))));
  const ctxM = await withSystem((tx) => loadMatchContext(tx));
  const policy = useAi ? await aiPolicyFor(orgId) : null;
  let reranks = 0;
  const counts = { auto: 0, review: 0, none: 0, reranked: 0 };
  for (const it of items) {
    let ranked = await withSystem((tx) => findMatches(tx, { text: it.description, attributes: it.attributes, unit: it.unit, categoryId: it.categoryId }, ctxM));
    let decision = decide(ranked);
    if (policy?.allowed && decision.status === "needs_review" && ranked.filter((r) => !r.rejected).length >= 2 && reranks < AI_RERANK_LIMIT) {
      try {
        await assertBudget(orgId);
        const viable = ranked.filter((r) => !r.rejected).slice(0, 5);
        const names = await withSystem((tx) => canonicalNames(tx, viable.map((v) => v.id)));
        const cands = names.map((r) => ({ id: r.id, name: `${r.nameEn} / ${r.nameAr}`, attributes: r.attributes }));
        const { result, usage } = await policy.provider.rerank({ text: it.description, attributes: it.attributes }, cands);
        await recordAiUsage({ orgId, purpose: "match_rerank", documentId, usage });
        reranks++;
        counts.reranked++;
        ranked = ranked.map((r) => {
          const ai = result.ranking.find((x) => x.id === r.id);
          if (!ai || r.rejected) return r;
          // AI only re-orders within rule-viable candidates; it cannot remove rule rejections.
          const blended = Number((0.5 * r.score + 0.5 * ai.score).toFixed(4));
          return { ...r, score: Math.min(blended, r.reasons.some((x) => x.startsWith("missing:")) ? 0.7 : 1), signals: { ...r.signals, ai: ai.score }, reasons: [...r.reasons, `ai:${ai.reason.slice(0, 120)}`] };
        });
        ranked.sort((a, b) => Number(a.rejected) - Number(b.rejected) || b.score - a.score);
        decision = decide(ranked);
      } catch (e) {
        if (!(isAppError(e) && e.messageKey === "ai_budget_exhausted")) await recordAiUsage({ orgId, purpose: "match_rerank", documentId, provider: policy.provider.name, error: isAppError(e) ? e.messageKey : "error" });
      }
    }
    const status = decision.status;
    if (status === "auto_suggested") counts.auto++;
    else if (status === "needs_review") counts.review++;
    else counts.none++;
    const needsReview = status !== "auto_suggested" || it.issues.length > 0 || Number(it.confidence) < 0.8 || !it.quantity || !it.unit;
    await withSystem(async (tx) => {
      await tx.delete(boqItemMatches).where(eq(boqItemMatches.itemId, it.id));
      const keep = ranked.filter((r) => !r.rejected).slice(0, 5);
      if (keep.length) await tx.insert(boqItemMatches).values(keep.map((r, i) => ({ itemId: it.id, orgId, canonicalProductId: r.id, rank: i + 1, score: r.score.toFixed(4), signals: r.signals, reasons: r.reasons })));
      await tx
        .update(boqItems)
        .set({
          matchedCanonicalId: decision.best?.id ?? null,
          matchConfidence: decision.best ? decision.best.score.toFixed(4) : null,
          matchStatus: status,
          reviewStatus: it.reviewStatus === "approved" || it.reviewStatus === "excluded" ? it.reviewStatus : needsReview ? "needs_review" : "pending",
        })
        .where(eq(boqItems.id, it.id));
    });
  }
  return counts;
}

type BoqStats = { lines?: number; needsReview?: number; matched?: number; approved?: number; excluded?: number };

async function computeStats(documentId: string): Promise<BoqStats> {
  const [r] = await withSystem((tx) =>
    tx
      .select({
        lines: sql<number>`count(*)::int`,
        needsReview: sql<number>`count(*) filter (where ${boqItems.reviewStatus} = 'needs_review')::int`,
        matched: sql<number>`count(*) filter (where ${boqItems.matchStatus} in ('auto_suggested','confirmed'))::int`,
        approved: sql<number>`count(*) filter (where ${boqItems.reviewStatus} = 'approved')::int`,
        excluded: sql<number>`count(*) filter (where ${boqItems.reviewStatus} = 'excluded')::int`,
      })
      .from(boqItems)
      .where(eq(boqItems.documentId, documentId)),
  );
  return r ?? {};
}

async function refreshStats(tx: Tx, documentId: string) {
  const s = await computeStats(documentId);
  const [d] = await tx.select({ stats: boqDocuments.stats }).from(boqDocuments).where(eq(boqDocuments.id, documentId)).limit(1);
  await tx.update(boqDocuments).set({ stats: { ...(d?.stats ?? {}), ...s } }).where(eq(boqDocuments.id, documentId));
}

// ------------------------------------------------------------------------------------------ reads

async function loadDoc(tx: Tx, ctx: Ctx, documentId: string) {
  const [doc] = await tx.select().from(boqDocuments).where(and(eq(boqDocuments.id, documentId), eq(boqDocuments.orgId, ctx.orgId!))).limit(1);
  if (!doc) throw notFound("BOQ");
  if (doc.projectId) await assertProjectAccess(tx, ctx, doc.projectId).catch(() => {
    throw notFound("BOQ");
  });
  return doc;
}

export async function listBoqs(ctx: Ctx, opts: { projectId?: string; page?: number } = {}) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "boq.view");
  const { limit, offset, page, pageSize } = pageParams(opts.page, 20);
  return withContext(dbCtx(ctx), async (tx) => {
    const where = and(
      eq(boqDocuments.orgId, ctx.orgId),
      opts.projectId ? eq(boqDocuments.projectId, opts.projectId) : undefined,
      sql`(${boqDocuments.projectId} is null or ${boqDocuments.projectId} in (select p.id from projects p where p.org_id = ${ctx.orgId} and (p.visibility = 'org' or p.manager_user_id = ${ctx.userId} or exists (select 1 from project_members pm where pm.project_id = p.id and pm.user_id = ${ctx.userId}) or ${ctx.permissions.has("project.manage_members")})))`,
    );
    const items = await tx.select().from(boqDocuments).where(where).orderBy(desc(boqDocuments.createdAt)).limit(limit).offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(boqDocuments).where(where);
    return { items, total: c?.n ?? 0, page, pageSize };
  });
}

export async function getBoq(ctx: Ctx, documentId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "boq.view");
  return withContext(dbCtx(ctx), async (tx) => {
    const doc = await loadDoc(tx, ctx, documentId);
    const runs = await tx.select().from(boqProcessingRuns).where(eq(boqProcessingRuns.documentId, documentId)).orderBy(desc(boqProcessingRuns.startedAt)).limit(20);
    const versions = await tx.select({ id: boqVersions.id, version: boqVersions.version, lineCount: boqVersions.lineCount, approvedAt: boqVersions.approvedAt, approvedBy: boqVersions.approvedBy }).from(boqVersions).where(eq(boqVersions.documentId, documentId)).orderBy(desc(boqVersions.version));
    return { doc, runs, versions };
  });
}

export async function listItems(ctx: Ctx, documentId: string, opts: { filter?: "all" | "needs_review" | "unmatched" | "approved" | "excluded"; page?: number; pageSize?: number } = {}) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "boq.view");
  const { limit, offset, page, pageSize } = pageParams(opts.page, opts.pageSize ?? 50, 200);
  return withContext(dbCtx(ctx), async (tx) => {
    await loadDoc(tx, ctx, documentId);
    const f = opts.filter ?? "all";
    const where = and(
      eq(boqItems.documentId, documentId),
      f === "needs_review" ? eq(boqItems.reviewStatus, "needs_review") : f === "approved" ? eq(boqItems.reviewStatus, "approved") : f === "excluded" ? eq(boqItems.reviewStatus, "excluded") : f === "unmatched" ? inArray(boqItems.matchStatus, ["no_match", "unmatched", "needs_review"]) : undefined,
    );
    const items = await tx.select().from(boqItems).where(where).orderBy(asc(boqItems.lineNo)).limit(limit).offset(offset);
    const matches = items.length
      ? await tx
          .select({ itemId: boqItemMatches.itemId, canonicalProductId: boqItemMatches.canonicalProductId, rank: boqItemMatches.rank, score: boqItemMatches.score, reasons: boqItemMatches.reasons, nameAr: sql<string>`(select name_ar from canonical_products cp where cp.id = ${boqItemMatches.canonicalProductId})`, nameEn: sql<string>`(select name_en from canonical_products cp where cp.id = ${boqItemMatches.canonicalProductId})` })
          .from(boqItemMatches)
          .where(inArray(boqItemMatches.itemId, items.map((i) => i.id)))
          .orderBy(asc(boqItemMatches.rank))
      : [];
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(boqItems).where(where);
    return { items: items.map((i) => ({ ...i, candidates: matches.filter((m) => m.itemId === i.id) })), total: c?.n ?? 0, page, pageSize };
  });
}

// ------------------------------------------------------------------------------------------ review

export const itemPatchSchema = z.object({
  description: z.string().trim().min(2).max(4000).optional(),
  quantity: z
    .union([z.string(), z.number()])
    .transform((v) => parseLocaleNumber(v))
    .refine((v) => v !== null && Number(v) >= 0, "Invalid quantity")
    .optional(),
  unit: z.string().trim().max(10).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  itemCode: z.string().trim().max(60).nullable().optional(),
  section: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

async function assertEditable(doc: typeof boqDocuments.$inferSelect) {
  if (["received", "extracting", "normalizing", "matching"].includes(doc.status)) throw invalidState("BOQ is still processing", { key: "boq_processing" });
}

export async function updateItem(ctx: Ctx, itemId: string, input: z.input<typeof itemPatchSchema>) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "boq.edit", { write: true });
  const d = itemPatchSchema.parse(input);
  return withContext(dbCtx(ctx), async (tx) => {
    const [it] = await tx.select().from(boqItems).where(and(eq(boqItems.id, itemId), eq(boqItems.orgId, ctx.orgId))).limit(1);
    if (!it) throw notFound("Item");
    const doc = await loadDoc(tx, ctx, it.documentId);
    await assertEditable(doc);
    if (d.unit) {
      const [u] = await tx.select({ code: units.code }).from(units).where(eq(units.code, d.unit)).limit(1);
      if (!u) throw validation("Unknown unit", { key: "unit_unknown" });
    }
    let attributes = it.attributes;
    const categoryId = d.categoryId === undefined ? it.categoryId : d.categoryId;
    if (d.attributes && categoryId) attributes = normalizeAttributes(d.attributes, await attributesForCategory(categoryId));
    else if (d.attributes) throw validation("Choose a category before editing specifications", { key: "category_required" });
    const next = {
      description: d.description ?? it.description,
      quantity: d.quantity !== undefined ? dec(d.quantity!).toFixed(4) : it.quantity,
      unit: d.unit ?? it.unit,
      categoryId,
      attributes,
      itemCode: d.itemCode === undefined ? it.itemCode : d.itemCode,
      section: d.section === undefined ? it.section : d.section,
      notes: d.notes === undefined ? it.notes : d.notes,
    };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(next)) {
      const before = (it as Record<string, unknown>)[k];
      if (JSON.stringify(before) !== JSON.stringify(v)) changes[k] = { from: before, to: v };
    }
    if (!Object.keys(changes).length) return it;
    const cat = categoryId ? (await tx.select({ system: categories.system }).from(categories).where(eq(categories.id, categoryId)).limit(1))[0] : null;
    const issues = it.issues.filter((i) => !((changes.quantity && i.startsWith("quantity")) || (changes.unit && (i === "unit_missing" || i === "unit_unknown")) || (changes.categoryId && i === "category_unknown")));
    const [row] = await tx
      .update(boqItems)
      .set({ ...next, system: cat?.system ?? it.system, isEdited: true, issues, reviewStatus: it.reviewStatus === "excluded" ? "excluded" : "needs_review", extractionMethod: it.extractionMethod })
      .where(eq(boqItems.id, itemId))
      .returning();
    await tx.insert(boqItemRevisions).values({ itemId, orgId: ctx.orgId, userId: ctx.userId, changes });
    if (doc.status === "approved") await tx.update(boqDocuments).set({ status: "needs_review" }).where(eq(boqDocuments.id, doc.id));
    await refreshStats(tx, doc.id);
    return row!;
  });
}

/** Re-run matching for one item after edits (user-triggered). */
export async function rematchItem(ctx: Ctx, itemId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "boq.edit", { write: true });
  const [it] = await withContext(dbCtx(ctx), (tx) => tx.select().from(boqItems).where(and(eq(boqItems.id, itemId), eq(boqItems.orgId, ctx.orgId))).limit(1));
  if (!it) throw notFound("Item");
  await withSystem((tx) => tx.update(boqItems).set({ matchStatus: "unmatched" }).where(eq(boqItems.id, itemId)));
  const ctxM = await withSystem((tx) => loadMatchContext(tx));
  const ranked = await withSystem((tx) => findMatches(tx, { text: it.description, attributes: it.attributes, unit: it.unit, categoryId: it.categoryId }, ctxM));
  const decision = decide(ranked);
  await withContext(dbCtx(ctx), async (tx) => {
    await tx.delete(boqItemMatches).where(eq(boqItemMatches.itemId, itemId));
    const keep = ranked.filter((r) => !r.rejected).slice(0, 5);
    if (keep.length) await tx.insert(boqItemMatches).values(keep.map((r, i) => ({ itemId, orgId: ctx.orgId!, canonicalProductId: r.id, rank: i + 1, score: r.score.toFixed(4), signals: r.signals, reasons: r.reasons })));
    await tx.update(boqItems).set({ matchedCanonicalId: decision.best?.id ?? null, matchConfidence: decision.best?.score.toFixed(4) ?? null, matchStatus: decision.status }).where(eq(boqItems.id, itemId));
  });
  return decision;
}

/** Confirm a canonical match (or record "no catalog match") — always a human decision. */
export async function selectMatch(ctx: Ctx, itemId: string, canonicalProductId: string | null) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "boq.edit", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const [it] = await tx.select().from(boqItems).where(and(eq(boqItems.id, itemId), eq(boqItems.orgId, ctx.orgId))).limit(1);
    if (!it) throw notFound("Item");
    const doc = await loadDoc(tx, ctx, it.documentId);
    await assertEditable(doc);
    if (canonicalProductId) {
      const exists = await tx.execute(sql`select 1 from canonical_products where id = ${canonicalProductId} and status <> 'archived'`);
      if (!exists.rows.length) throw validation("Unknown product");
    }
    await tx.update(boqItems).set({ matchedCanonicalId: canonicalProductId, matchStatus: canonicalProductId ? "confirmed" : "rejected" }).where(eq(boqItems.id, itemId));
    await tx.insert(boqItemRevisions).values({ itemId, orgId: ctx.orgId, userId: ctx.userId, changes: { matchedCanonicalId: { from: it.matchedCanonicalId, to: canonicalProductId } } });
    await refreshStats(tx, doc.id);
  });
}

/** Set review status for items. Approving requires quantity and unit. */
export async function setReviewStatus(ctx: Ctx, documentId: string, itemIds: string[] | "all_clean", status: "approved" | "excluded" | "needs_review") {
  requireOrg(ctx, "buyer");
  authorize(ctx, "boq.edit", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const doc = await loadDoc(tx, ctx, documentId);
    await assertEditable(doc);
    const where =
      itemIds === "all_clean"
        ? and(eq(boqItems.documentId, documentId), eq(boqItems.reviewStatus, "pending"), sql`${boqItems.quantity} is not null`, sql`${boqItems.unit} is not null`, sql`jsonb_array_length(${boqItems.issues}) = 0`)
        : and(eq(boqItems.documentId, documentId), inArray(boqItems.id, itemIds.length ? itemIds : ["00000000-0000-0000-0000-000000000000"]));
    if (status === "approved") {
      const bad = await tx.select({ id: boqItems.id, lineNo: boqItems.lineNo }).from(boqItems).where(and(where, sql`(${boqItems.quantity} is null or ${boqItems.unit} is null)`));
      if (bad.length) throw new AppError("VALIDATION", "Lines need quantity and unit before approval", { key: "boq_lines_incomplete", details: { lines: bad.map((b) => b.lineNo) } });
    }
    const rows = await tx.update(boqItems).set({ reviewStatus: status }).where(where).returning({ id: boqItems.id });
    if (doc.status === "approved") await tx.update(boqDocuments).set({ status: "needs_review" }).where(eq(boqDocuments.id, documentId));
    await refreshStats(tx, documentId);
    await audit(ctx, { action: `boq.items_${status}`, entityType: "boq_document", entityId: documentId, data: { count: rows.length } }, tx);
    return { updated: rows.length };
  });
}

export const manualItemSchema = z.object({
  description: z.string().trim().min(2).max(4000),
  quantity: z
    .union([z.string(), z.number()])
    .transform((v) => parseLocaleNumber(v))
    .refine((v) => v !== null && Number(v) > 0, "Invalid quantity"),
  unit: z.string().trim().min(1).max(10),
  itemCode: z.string().trim().max(60).optional().nullable(),
  section: z.string().trim().max(200).optional().nullable(),
});

export async function addManualItem(ctx: Ctx, documentId: string, input: z.input<typeof manualItemSchema>) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "boq.edit", { write: true });
  const d = manualItemSchema.parse(input);
  return withContext(dbCtx(ctx), async (tx) => {
    const doc = await loadDoc(tx, ctx, documentId);
    await assertEditable(doc);
    const [u] = await tx.select({ code: units.code }).from(units).where(eq(units.code, d.unit)).limit(1);
    if (!u) throw validation("Unknown unit", { key: "unit_unknown" });
    const [max] = await tx.select({ n: sql<number>`coalesce(max(${boqItems.lineNo}), 0)::int` }).from(boqItems).where(eq(boqItems.documentId, documentId));
    const cls = classifyCategory(d.description, d.section);
    const cat = cls ? (await tx.select().from(categories).where(eq(categories.slug, cls.slug)).limit(1))[0] : undefined;
    const [row] = await tx
      .insert(boqItems)
      .values({
        documentId,
        orgId: ctx.orgId,
        lineNo: (max?.n ?? 0) + 1,
        itemCode: d.itemCode ?? null,
        section: d.section ?? null,
        description: d.description,
        rawText: d.description,
        quantity: dec(d.quantity!).toFixed(4),
        unitRaw: d.unit,
        unit: d.unit,
        attributes: extractAttributes(d.description),
        categoryId: cat?.id ?? null,
        system: cat?.system ?? null,
        extractionMethod: "manual",
        confidence: "1",
        reviewStatus: "needs_review",
        source: {},
      })
      .returning();
    if (doc.status === "approved" || doc.status === "needs_manual_entry") await tx.update(boqDocuments).set({ status: "needs_review" }).where(eq(boqDocuments.id, documentId));
    await refreshStats(tx, documentId);
    return row!;
  });
}

export async function setColumnMapping(ctx: Ctx, documentId: string, mapping: ColumnMapping) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "boq.upload", { write: true });
  const m = z
    .object({ sheet: z.string().max(100).optional(), headerRow: z.number().int().min(0).max(1000), description: z.number().int().min(0).max(60), quantity: z.number().int().min(0).max(60), unit: z.number().int().min(0).max(60).optional(), itemCode: z.number().int().min(0).max(60).optional() })
    .parse(mapping);
  if (m.description === m.quantity) throw validation("Description and quantity must be different columns");
  return withContext(dbCtx(ctx), async (tx) => {
    const doc = await loadDoc(tx, ctx, documentId);
    if (doc.status === "approved") throw invalidState("Approved BOQs cannot be re-extracted");
    await tx.update(boqDocuments).set({ columnMapping: m, status: "received" }).where(eq(boqDocuments.id, documentId));
    await emit({ topic: "boq.uploaded", aggregateType: "boq_document", aggregateId: documentId, orgId: ctx.orgId, payload: { documentId, reprocess: Date.now() } }, tx);
    await audit(ctx, { action: "boq.column_mapping_set", entityType: "boq_document", entityId: documentId, data: m }, tx);
  });
}

export async function reprocessBoq(ctx: Ctx, documentId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "boq.upload", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const doc = await loadDoc(tx, ctx, documentId);
    if (doc.status === "approved" || doc.sourceType === "manual") throw invalidState("Cannot reprocess this BOQ");
    const policy = await aiPolicyFor(ctx.orgId);
    await tx.update(boqDocuments).set({ status: "received", useAi: policy.allowed }).where(eq(boqDocuments.id, documentId));
    await emit({ topic: "boq.uploaded", aggregateType: "boq_document", aggregateId: documentId, orgId: ctx.orgId, payload: { documentId, reprocess: Date.now() } }, tx);
  });
}

// ------------------------------------------------------------------------------------------ approval & versions

/**
 * Approve the BOQ (human decision, `boq.approve`). Every non-excluded line must be approved and have
 * a quantity and unit. Creates an immutable version used by RFQs.
 */
export async function approveBoq(ctx: Ctx, documentId: string, notes?: string | null) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "boq.approve", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const [doc] = await tx.select().from(boqDocuments).where(and(eq(boqDocuments.id, documentId), eq(boqDocuments.orgId, ctx.orgId))).limit(1).for("update");
    if (!doc) throw notFound("BOQ");
    await loadDoc(tx, ctx, documentId);
    if (doc.status !== "needs_review") throw invalidState("BOQ is not ready for approval", { key: "boq_not_reviewable" });
    const items = await tx.select().from(boqItems).where(and(eq(boqItems.documentId, documentId), ne(boqItems.reviewStatus, "excluded"))).orderBy(asc(boqItems.lineNo));
    if (!items.length) throw new AppError("VALIDATION", "BOQ has no lines", { key: "boq_empty" });
    const pending = items.filter((i) => i.reviewStatus !== "approved" || !i.quantity || !i.unit);
    if (pending.length) throw new AppError("VALIDATION", "All lines must be reviewed", { key: "boq_lines_unreviewed", details: { lines: pending.slice(0, 50).map((p) => p.lineNo), count: pending.length } });
    const version = doc.currentVersion + 1;
    const lines: BoqVersionLine[] = items.map((i) => ({
      itemId: i.id,
      lineNo: i.lineNo,
      itemCode: i.itemCode,
      section: i.section,
      system: i.system,
      categoryId: i.categoryId,
      description: i.description,
      quantity: i.quantity!,
      unit: i.unit!,
      attributes: i.attributes,
      canonicalProductId: i.matchStatus === "confirmed" || i.matchStatus === "auto_suggested" ? i.matchedCanonicalId : null,
    }));
    const [v] = await tx.insert(boqVersions).values({ documentId, orgId: ctx.orgId, version, lines, lineCount: lines.length, notes: notes ?? null, approvedBy: ctx.userId }).returning();
    await tx.update(boqDocuments).set({ status: "approved", currentVersion: version }).where(eq(boqDocuments.id, documentId));
    if (doc.projectId) await logActivity(tx, ctx, doc.projectId, "boq.approved", { type: "boq_document", id: documentId }, { version });
    await audit(ctx, { action: "boq.approved", entityType: "boq_document", entityId: documentId, data: { version, lines: lines.length } }, tx);
    await emit({ topic: "boq.approved", aggregateType: "boq_document", aggregateId: documentId, orgId: ctx.orgId, payload: { documentId, versionId: v!.id, version } }, tx);
    return v!;
  });
}

export async function getVersion(ctx: Ctx, versionId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "boq.view");
  return withContext(dbCtx(ctx), async (tx) => {
    const [v] = await tx.select().from(boqVersions).where(and(eq(boqVersions.id, versionId), eq(boqVersions.orgId, ctx.orgId))).limit(1);
    if (!v) throw notFound("BOQ version");
    await loadDoc(tx, ctx, v.documentId);
    return v;
  });
}

/** Approved versions available for RFQ creation. */
export async function approvedVersions(ctx: Ctx, opts: { projectId?: string | null } = {}) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "boq.view");
  return withContext(dbCtx(ctx), (tx) =>
    tx
      .select({ id: boqVersions.id, version: boqVersions.version, lineCount: boqVersions.lineCount, documentId: boqDocuments.id, code: boqDocuments.code, title: boqDocuments.title, projectId: boqDocuments.projectId })
      .from(boqVersions)
      .innerJoin(boqDocuments, eq(boqDocuments.id, boqVersions.documentId))
      .where(and(eq(boqVersions.orgId, ctx.orgId), opts.projectId ? eq(boqDocuments.projectId, opts.projectId) : undefined))
      .orderBy(desc(boqVersions.approvedAt))
      .limit(200),
  );
}

