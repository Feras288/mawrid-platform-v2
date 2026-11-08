import { describe, expect, it } from "vitest";
import { BUYER_PERMISSIONS, ROLE_TEMPLATES, SUPPLIER_PERMISSIONS } from "../src/authz/permissions";
import { validateUpload } from "../src/files";
import { interpolate, renderEmail, TEMPLATES } from "../src/notifications";

const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1");
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4360000000049454e44ae426082", "hex");

describe("upload validation", () => {
  it("accepts a real PDF for supplier documents", async () => {
    await expect(validateUpload({ buffer: PDF, fileName: "cr.pdf", ownerType: "supplier_document" })).resolves.toBe("application/pdf");
  });
  it("rejects content/extension mismatch (PNG renamed to .pdf)", async () => {
    await expect(validateUpload({ buffer: PNG, fileName: "cr.pdf", ownerType: "supplier_document" })).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA" });
  });
  it("rejects executables disguised as CSV", async () => {
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 0)]);
    await expect(validateUpload({ buffer: exe, fileName: "boq.csv", ownerType: "boq_document" })).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA" });
  });
  it("accepts UTF-8 CSV with Arabic text", async () => {
    const csv = Buffer.from("الوصف,الكمية,الوحدة\nماسورة PVC 110 مم,120,م.ط\n", "utf8");
    await expect(validateUpload({ buffer: csv, fileName: "boq.csv", ownerType: "boq_document" })).resolves.toBe("text/csv");
  });
  it("enforces size limits and rejects empty files", async () => {
    await expect(validateUpload({ buffer: Buffer.alloc(0), fileName: "a.pdf", ownerType: "supplier_document" })).rejects.toMatchObject({ code: "VALIDATION" });
    const big = Buffer.concat([PDF, Buffer.alloc(11 * 1024 * 1024)]);
    await expect(validateUpload({ buffer: big, fileName: "a.pdf", ownerType: "supplier_document" })).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
});

describe("email templates", () => {
  it("every template exists in both locales", () => {
    for (const [key, v] of Object.entries(TEMPLATES)) {
      expect(v.ar.subject, key).toBeTruthy();
      expect(v.en.subject, key).toBeTruthy();
    }
  });
  it("escapes HTML in parameters and renders RTL for Arabic", () => {
    const r = renderEmail(TEMPLATES["org.invitation"].ar, "ar", { orgName: "<script>x</script>", inviterName: "أحمد", actionUrl: "https://example.test/ar/invite/abc" });
    expect(r.html).toContain('dir="rtl"');
    expect(r.html).not.toContain("<script>x</script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.text).toContain("https://example.test/ar/invite/abc");
  });
  it("drops non-http action urls", () => {
    const r = renderEmail(TEMPLATES["org.invitation"].en, "en", { orgName: "A", inviterName: "B", actionUrl: "javascript:alert(1)" });
    expect(r.html).not.toContain("javascript:");
  });
  it("interpolates missing params as empty", () => {
    expect(interpolate("Hi {{name}} {{x}}", { name: "A" }, false)).toBe("Hi A ");
  });
});

describe("role templates", () => {
  it("only use permissions valid for their org type", () => {
    for (const r of ROLE_TEMPLATES) {
      const allowed = new Set<string>(r.orgType === "buyer" ? BUYER_PERMISSIONS : r.orgType === "supplier" ? SUPPLIER_PERMISSIONS : r.permissions);
      for (const p of r.permissions) expect(allowed.has(p), `${r.key}:${p}`).toBe(true);
    }
  });
  it("covers every account type from the brief", () => {
    const keys = ROLE_TEMPLATES.map((r) => r.key);
    for (const k of ["owner", "admin", "procurement_officer", "technical_reviewer", "financial_reviewer", "procurement_manager", "approver", "supplier_admin", "supplier_staff", "platform_admin"]) {
      expect(keys).toContain(k);
    }
  });
  it("admin role cannot decide approvals by default (separation of duties)", () => {
    expect(ROLE_TEMPLATES.find((r) => r.key === "admin")!.permissions).not.toContain("approval.decide");
  });
});
