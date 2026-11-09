import { afterEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { eq } from "drizzle-orm";
import { AppError } from "@platform/core";
import { withSystem } from "@platform/db";
import { aiUsage, boqDocuments, categories, featureFlags } from "@platform/db/schema";
import { FakeProvider, setAiProvider } from "@platform/integrations/ai";
import { addManualItem, approveBoq, createManualBoq, getBoq, listItems, processBoq, selectMatch, setReviewStatus, updateItem, uploadBoq } from "../src/boq";
import { createCanonical } from "../src/catalog";
import { updateOrgSettings } from "../src/organizations";
import { createProject, getProject } from "../src/projects";
import { createUser, ctxFor, rawAsApp, setupOrg } from "./helpers";
import { GOLDEN_LINES, goldenRows } from "./fixtures/boq-golden";

async function xlsx(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOQ", { views: [{ rightToLeft: true }] });
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function textPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const put = (t: string, x: number, y: number) => page.drawText(t, { x, y, size: 9, font });
  put("Item", 40, 780);
  put("Description", 90, 780);
  put("Unit", 420, 780);
  put("Qty", 480, 780);
  const lines = [
    ["1", "Supply uPVC drainage pipe 110mm PN10", "m", "120"],
    ["2", "Copper cable 4x16mm2 XLPE", "m", "300"],
    ["3", "MCB 1P 20A 6kA", "No", "48"],
  ];
  lines.forEach((l, i) => {
    const y = 760 - i * 18;
    put(l[0]!, 40, y);
    put(l[1]!, 90, y);
    put(l[2]!, 422, y);
    put(l[3]!, 482, y);
  });
  return Buffer.from(await pdf.save());
}

async function adminCtx() {
  const admin = await createUser({ platformAdmin: true, twoFactor: true });
  return ctxFor(admin.id);
}

async function catId(slug: string) {
  const [c] = await withSystem((tx) => tx.select().from(categories).where(eq(categories.slug, slug)).limit(1));
  return c!.id;
}

afterEach(() => setAiProvider(undefined));

describe("projects", () => {
  it("creates a project with sequential code; restricted projects are hidden from non-members", async () => {
    const { ctx, org } = await setupOrg("buyer");
    const p1 = await createProject(ctx, { name: "برج الرياض", projectType: "commercial", city: "riyadh" });
    expect(p1.code).toMatch(/^PRJ-\d{4}-000001$/);
    const p2 = await createProject(ctx, { name: "Restricted", visibility: "members" });
    expect(p2.code).toMatch(/000002$/);
    // a viewer (no project.manage_members) cannot see the restricted project
    const { inviteMember, acceptInvitation, listAssignableRoles } = await import("../src/organizations");
    const viewer = (await listAssignableRoles(ctx)).find((r) => r.key === "viewer")!;
    const u = await createUser();
    const { token } = await inviteMember(ctx, { email: u.email, roleIds: [viewer.id] });
    await acceptInvitation(await ctxFor(u.id), token);
    const vctx = await ctxFor(u.id, org.id);
    await expect(getProject(vctx, p2.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getProject(vctx, p1.id)).project.name).toBe("برج الرياض");
  });
});

describe("BOQ pipeline (rule engine, no AI)", () => {
  it("processes an Arabic XLSX end-to-end: extract, normalize, match, review, approve", async () => {
    const { ctx } = await setupOrg("buyer");
    const admin = await adminCtx();
    // catalog products the engine should match
    const pipes = await catId("pipes");
    const tag = Date.now().toString(36);
    const cp = await createCanonical(admin, { categoryId: pipes, nameAr: `ماسورة يو بي في سي 110 مم PN10 ${tag}`, nameEn: `uPVC pipe 110mm PN10 ${tag}`, baseUnit: "m", attributes: { material: "upvc", diameter_mm: 110, pressure_class: "PN10" } });
    const project = await createProject(ctx, { name: "Golden project" });
    const doc = await uploadBoq(ctx, { projectId: project.id, title: "Golden AR" }, { buffer: await xlsx(goldenRows("ar")), fileName: "boq.xlsx" });
    expect(doc.code).toMatch(/^BOQ-/);
    expect(doc.useAi).toBe(false);
    const res = await processBoq(doc.id);
    expect(res).toEqual({ status: "needs_review", lines: GOLDEN_LINES.length });

    const { items } = await listItems(ctx, doc.id, { pageSize: 200 });
    const p01 = items.find((i) => i.itemCode === "P-01")!;
    expect(p01).toMatchObject({ quantity: "120.0000", unit: "m", unitRaw: "م.ط", extractionMethod: "rule" });
    expect(p01.attributes).toMatchObject({ material: "upvc", diameter_mm: 110, pressure_class: "PN10" });
    expect(p01.candidates[0]?.canonicalProductId).toBe(cp.product.id);
    expect(["auto_suggested", "needs_review"]).toContain(p01.matchStatus);
    expect(p01.matchedCanonicalId).toBe(cp.product.id);
    // 160mm line must NOT match the 110mm product (critical attribute conflict)
    const p02 = items.find((i) => i.itemCode === "P-02")!;
    expect(p02.candidates.map((c) => c.canonicalProductId)).not.toContain(cp.product.id);

    // approval is blocked until every line is reviewed
    await expect(approveBoq(ctx, doc.id)).rejects.toMatchObject({ messageKey: "boq_lines_unreviewed" });
    await updateItem(ctx, p02.id, { quantity: "90" });
    await selectMatch(ctx, p01.id, cp.product.id);
    await setReviewStatus(ctx, doc.id, items.map((i) => i.id), "approved");
    const v = await approveBoq(ctx, doc.id, "first approval");
    expect(v.version).toBe(1);
    expect(v.lineCount).toBe(GOLDEN_LINES.length);
    expect(v.lines.find((l) => l.itemCode === "P-02")!.quantity).toBe("90.0000");
    expect(v.lines.find((l) => l.itemCode === "P-01")!.canonicalProductId).toBe(cp.product.id);
    const { doc: after, versions } = await getBoq(ctx, doc.id);
    expect(after.status).toBe("approved");
    expect(versions).toHaveLength(1);
    // project activity recorded
    const { activity } = await getProject(ctx, project.id);
    expect(activity.map((a) => a.action)).toEqual(expect.arrayContaining(["boq.uploaded", "boq.approved"]));
  });

  it("concurrent processing of the same document runs once (no duplicate lines)", async () => {
    const { ctx } = await setupOrg("buyer");
    const doc = await uploadBoq(ctx, { title: "Race" }, { buffer: await xlsx(goldenRows("en")), fileName: "race.xlsx" });
    const results = await Promise.all([processBoq(doc.id), processBoq(doc.id)]);
    expect(results.map((r) => r.status).sort()).toEqual(["in_progress", "needs_review"]);
    const items = await listItems(ctx, doc.id, { pageSize: 500 });
    expect(items.total).toBe(GOLDEN_LINES.length);
  });

  it("extracts a text PDF", async () => {
    const { ctx } = await setupOrg("buyer");
    const doc = await uploadBoq(ctx, { title: "PDF" }, { buffer: await textPdf(), fileName: "boq.pdf" });
    const res = await processBoq(doc.id);
    expect(res.lines).toBe(3);
    const { items } = await listItems(ctx, doc.id);
    expect(items.map((i) => [i.quantity, i.unit])).toEqual([
      ["120.0000", "m"],
      ["300.0000", "m"],
      ["48.0000", "pc"],
    ]);
    expect(items[1]!.attributes).toMatchObject({ cores: 4, cross_section_mm2: 16 });
  });

  it("asks for column mapping when the sheet has no recognizable table", async () => {
    const { ctx } = await setupOrg("buyer");
    const doc = await uploadBoq(ctx, {}, { buffer: Buffer.from("a,b\nhello,world\n", "utf8"), fileName: "x.csv" });
    expect((await processBoq(doc.id)).status).toBe("needs_column_mapping");
  });

  it("routes images to manual entry when AI is not allowed; manual lines can be added and approved", async () => {
    const { ctx } = await setupOrg("buyer");
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4360000000049454e44ae426082", "hex");
    const doc = await uploadBoq(ctx, {}, { buffer: png, fileName: "scan.png" });
    expect((await processBoq(doc.id)).status).toBe("needs_manual_entry");
    const m = await createManualBoq(ctx, { title: "Manual" });
    const line = await addManualItem(ctx, m.id, { description: "Copper cable 4x16mm2", quantity: "100", unit: "m" });
    expect(line.attributes).toMatchObject({ cores: 4, cross_section_mm2: 16 });
    await expect(addManualItem(ctx, m.id, { description: "x pipe", quantity: "0", unit: "m" })).rejects.toBeDefined();
    await setReviewStatus(ctx, m.id, [line.id], "approved");
    expect((await approveBoq(ctx, m.id)).lineCount).toBe(1);
  });
});

describe("BOQ AI path & data policy", () => {
  it("does not send documents to the AI provider unless the org opted in", async () => {
    const fake = new FakeProvider();
    fake.lines = [{ itemCode: "1", section: null, description: "uPVC pipe 110mm", quantity: "10", unit: "m", page: 1 }];
    setAiProvider(fake);
    const { ctx } = await setupOrg("buyer");
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4360000000049454e44ae426082", "hex");
    const d1 = await uploadBoq(ctx, {}, { buffer: png, fileName: "a.png" });
    expect(d1.useAi).toBe(false);
    expect((await processBoq(d1.id)).status).toBe("needs_manual_entry");
    expect(fake.calls).toHaveLength(0);

    await updateOrgSettings(ctx, { allowExternalAI: true, aiMonthlyBudgetUsd: "1" });
    const d2 = await uploadBoq(ctx, {}, { buffer: png, fileName: "b.png" });
    expect(d2.useAi).toBe(true);
    expect((await processBoq(d2.id)).lines).toBe(1);
    const { items } = await listItems(ctx, d2.id);
    expect(items[0]).toMatchObject({ extractionMethod: "ai", reviewStatus: "needs_review" });
    expect(items[0]!.issues).toContain("ai_extracted");
    const usage = await withSystem((tx) => tx.select().from(aiUsage).where(eq(aiUsage.documentId, d2.id)));
    expect(usage[0]).toMatchObject({ purpose: "boq_extraction", status: "ok" });
  });

  it("an AI failure marks the document failed without corrupting data; budget exhaustion blocks calls", async () => {
    const fake = new FakeProvider();
    fake.failWith = new AppError("INTEGRATION_FAILED", "provider down", { key: "ai_invalid_output" });
    setAiProvider(fake);
    const { ctx } = await setupOrg("buyer");
    await updateOrgSettings(ctx, { allowExternalAI: true, aiMonthlyBudgetUsd: "0.01" });
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4360000000049454e44ae426082", "hex");
    const d = await uploadBoq(ctx, {}, { buffer: png, fileName: "c.png" });
    expect((await processBoq(d.id)).status).toBe("failed");
    expect(fake.calls).toHaveLength(1);
    const [doc] = await withSystem((tx) => tx.select().from(boqDocuments).where(eq(boqDocuments.id, d.id)));
    expect(doc!.status).toBe("failed");
    expect((await listItems(ctx, d.id)).total).toBe(0);
    // spend recorded on failure? (fake failure has no usage) — now exhaust budget with a successful call
    fake.failWith = null;
    fake.lines = [{ itemCode: null, section: null, description: "x", quantity: "1", unit: "m", page: null }];
    const d2 = await uploadBoq(ctx, {}, { buffer: png, fileName: "d.png" });
    await processBoq(d2.id); // costs 0.008 → budget 0.01 not yet exceeded
    const d3 = await uploadBoq(ctx, {}, { buffer: png, fileName: "e.png" });
    await processBoq(d3.id); // 0.016 >= 0.01 → next call blocked
    const d4 = await uploadBoq(ctx, {}, { buffer: png, fileName: "f.png" });
    const r4 = await processBoq(d4.id);
    expect(r4.status).toBe("failed");
    const [doc4] = await withSystem((tx) => tx.select().from(boqDocuments).where(eq(boqDocuments.id, d4.id)));
    expect(doc4!.error).toBe("ai_budget_exhausted");
  });

  it("respects the feature flag kill-switch", async () => {
    const fake = new FakeProvider();
    setAiProvider(fake);
    const { ctx } = await setupOrg("buyer");
    await updateOrgSettings(ctx, { allowExternalAI: true });
    await withSystem((tx) => tx.insert(featureFlags).values({ key: "boq.ai_extraction", enabled: false }).onConflictDoUpdate({ target: featureFlags.key, set: { enabled: false } }));
    try {
      const d = await uploadBoq(ctx, {}, { buffer: await xlsx(goldenRows("en")), fileName: "g.xlsx" });
      expect(d.useAi).toBe(false);
    } finally {
      await withSystem((tx) => tx.delete(featureFlags).where(eq(featureFlags.key, "boq.ai_extraction")));
    }
  });
});

describe("BOQ isolation", () => {
  it("another org cannot read BOQ documents, items or versions (service + RLS)", async () => {
    const a = await setupOrg("buyer");
    const b = await setupOrg("buyer");
    const doc = await uploadBoq(a.ctx, {}, { buffer: await xlsx(goldenRows("en")), fileName: "secret.xlsx" });
    await processBoq(doc.id);
    await expect(getBoq(b.ctx, doc.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listItems(b.ctx, doc.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const g = { userId: b.user.id, orgId: b.org.id };
    expect(await rawAsApp(g, "select id from boq_documents where id = $1", [doc.id])).toHaveLength(0);
    expect(await rawAsApp(g, "select id from boq_items where document_id = $1", [doc.id])).toHaveLength(0);
    expect(await rawAsApp(g, "select id from files where id = $1", [doc.fileId])).toHaveLength(0);
    const s = await setupOrg("supplier");
    expect(await rawAsApp({ userId: s.user.id, orgId: s.org.id }, "select id from boq_items where document_id = $1", [doc.id])).toHaveLength(0);
  });
});
