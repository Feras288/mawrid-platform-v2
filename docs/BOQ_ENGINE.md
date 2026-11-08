# BOQ Engine

## Pipeline (job `boq.process`, resumable by stage)
```
received → validating → stored → extracting → parsed → normalizing → matching → needs_review → approved
                     ↘ failed (with error code; retryable stages re-run idempotently)
```
1. **Receive**: upload via authorized endpoint; `files` row + `boq_documents` row (status `received`).
2. **Validate**: magic bytes, size, sheet/page count limits; reject executables/macros (xlsm rejected).
3. **Store**: private S3 key `org/<org>/boq/<doc>/<uuid>`; checksum sha256 (duplicate upload warning).
4. **Extract** (by format):
   - XLSX: exceljs; each sheet scanned for a header row (scored keyword match in ar/en:
     description/الوصف/البيان, qty/الكمية, unit/الوحدة, item/رقم البند, rate/السعر). Merged cells and
     multi-row descriptions handled; section headers (rows w/o qty) become `section` context.
   - CSV: papaparse with delimiter/encoding detection, same header detection.
   - Text PDF: unpdf text items with coordinates → line clustering by y → column inference by x gaps.
   - Scanned PDF / images: AI vision provider (if org allows external AI) else tesseract (ara+eng) if
     available; else document marked `needs_manual_entry` (manual grid entry remains available).
   - User can override detected column mapping and re-run from `parsed`.
5. **Parse lines**: raw text, description, quantity (Arabic-Indic digits, thousands separators), unit,
   item code, section/system, provenance (sheet, row / page, line).
6. **Normalize**: Arabic normalization (alef forms, ya/alef maqsura, ta marbuta, tatweel, diacritics),
   unit canonicalization (m, lm, م.ط → `m`; no, nos, pcs, عدد → `pc`; m2/م2/sqm → `m2` …),
   attribute extraction by rules: diameter (mm/inch, Ø), pressure class (PN), voltage, power (kW/HP),
   cable size (`4x16mm²`), material (uPVC, PPR, GI, copper, HDPE…), thickness, length, brand hints.
7. **Match** (`matching` module): candidates scored by
   - hard filters: category/system compatibility, unit dimension compatibility, critical attribute
     equality (a critical attribute present on both sides and unequal ⇒ candidate rejected);
   - lexical score: pg_trgm similarity on normalized names + token overlap;
   - attribute score: matched / required attributes;
   - semantic (embedding) similarity: **Not Implemented** — pgvector is installed but no embedding
     provider is wired; lexical + attribute + unit signals are used instead;
   - optional AI re-rank (structured output) when enabled.
   Final confidence ∈ [0,1]. `auto_suggested` if ≥ `match.autoSuggest` (0.85) AND no missing critical
   attribute; otherwise `needs_review`. Nothing is ever auto-approved.
8. **Review**: grid with filters (low confidence, unmatched, edited); user edits quantity/unit/
   attributes/match; every edit stored in `boq_item_revisions`.
9. **Approve**: requires `boq.approve`; freezes a `boq_versions` snapshot used by RFQs.

## AI layer (as implemented)
`AiProvider` interface (`packages/integrations/src/ai`): `extractBoqLines(input)` for text / PDF
(base64 document block) / image, and `rerank(line, candidates)`. Adapters: `anthropic` (official
`@anthropic-ai/sdk`, structured outputs via `output_config.format` json_schema, streaming
`finalMessage()`, server-side refusal fallback `fallbacks: "default"` beta), `disabled`, and `fake`
(tests only, refused in production). Default models: extraction `claude-opus-5-5` (effort medium),
rerank `claude-haiku-5-5` (effort low) — override with `AI_MODEL_EXTRACTION` / `AI_MODEL_FAST`.
Cost estimate from token usage with a per-model price table (override `AI_PRICE_<MODEL>="in,out"`).
An OpenAI-compatible adapter is **Not Implemented** (abstraction allows adding one).
Rule-match signals are not overridden by AI: AI re-ranking only reorders rule-viable candidates. Every call: org data policy check (`orgs.settings.allowExternalAI`), monthly cost budget
check, schema-validated output (Zod), retry (3, exponential, only on retryable errors), usage row in
`ai_usage` (provider, model, tokens, cost estimate, purpose, document id). Document content is wrapped
as untrusted data; system prompt instructs to ignore instructions inside documents; outputs are only data.

## Accuracy evaluation
Golden set in `packages/modules/test/fixtures/boq-golden.ts` (synthetic bilingual BOQ with expected
lines, quantities, units, attributes and categories). `pnpm test` asserts extraction recall, attribute
and category accuracy for the rule engine. AI-assisted accuracy is not measured in CI (needs a key and
paid calls) — **Known Limitation**; it can be evaluated manually by enabling AI for a test org.

## Implementation notes & limitations
- Arabic unit words are normalized to Latin tokens before pattern matching (JS word boundary `\b` is ASCII-only).
- Text PDFs: columns are rebuilt from text positions anchored on the header line. Arabic text in PDFs
  may come back in visual order from pdf.js — Arabic PDFs are better processed via AI (opt-in) or
  uploaded as Excel. **Known Limitation.**
- Scanned PDFs / images: AI vision when the org opted in; otherwise local Tesseract OCR only if
  `OCR_LANG_PATH` provides `ara`/`eng` traineddata (never downloaded at runtime); otherwise the
  document is routed to manual entry. **Integration Pending** (language data provisioning).
- Known provider failures (invalid output, refusal, budget) fail the document without queue retries,
  so paid calls are not repeated; network/5xx errors are retried by the SDK.
- Golden set (`packages/modules/test/fixtures/boq-golden.ts`, 15 bilingual lines): extraction recall
  1.0 on AR and EN headers; attribute accuracy ≥ 0.95; category accuracy ≥ 0.9 — asserted in CI.
