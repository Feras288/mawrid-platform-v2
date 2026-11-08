import { expect, test, type Page } from "@playwright/test";
import { createOrg, register, uniqueEmail } from "./helpers";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1");
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@platform.test";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "Seed-Passw0rd-2026!";

async function saveForm(page: Page, form: ReturnType<Page["locator"]>) {
  await form.locator('button[type="submit"]').click();
  await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
}

async function uploadDoc(page: Page, kindLabel: string, name: string) {
  await page.getByRole("button", { name: "رفع مستند" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.locator('select[name="kind"]').selectOption({ label: kindLabel });
  await dlg.locator('input[name="file"]').setInputFiles({ name, mimeType: "application/pdf", buffer: PDF });
  await dlg.locator('button[type="submit"]').click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("cell", { name: kindLabel })).toBeVisible();
}

test("critical path 2: supplier onboarding, admin verification, product publishing", async ({ browser }) => {
  test.setTimeout(180_000);
  const supplier = await browser.newPage();
  const email = uniqueEmail("supplier");
  const name = `Supplier ${Date.now()}`;
  await register(supplier, { email, name: "مورد الاختبار" });
  await createOrg(supplier, "supplier", name);

  // organization profile
  const orgForm = supplier.locator("form").filter({ has: supplier.locator('input[name="crNumber"]') });
  await orgForm.locator('input[name="crNumber"]').fill("1010" + String(Date.now()).slice(-6));
  await orgForm.locator('input[name="vatNumber"]').fill("300000000000003");
  await orgForm.locator('input[name="city"]').fill("riyadh");
  await saveForm(supplier, orgForm);

  // supplier profile + categories
  const spForm = supplier.locator("form").filter({ has: supplier.locator('textarea[name="descriptionAr"]') });
  await spForm.locator('textarea[name="descriptionAr"]').fill("مورد مواسير ووصلات");
  await spForm.getByLabel("المواسير", { exact: true }).check();
  await saveForm(supplier, spForm);

  // submitting too early lists what's missing
  await supplier.getByRole("button", { name: "إرسال للتحقق" }).first().click();
  await expect(supplier.locator("[data-sonner-toast]").filter({ hasText: "غير مكتمل" })).toBeVisible();

  await supplier.goto("/ar/supplier/documents");
  await uploadDoc(supplier, "السجل التجاري", "cr.pdf");
  await uploadDoc(supplier, "شهادة ضريبة القيمة المضافة", "vat.pdf");

  await supplier.goto("/ar/supplier/profile");
  await supplier.getByRole("button", { name: "إرسال للتحقق" }).first().click();
  await expect(supplier.getByText("بانتظار التحقق").first()).toBeVisible();

  // platform admin reviews
  const admin = await (await browser.newContext()).newPage();
  await admin.goto("/ar/login");
  await admin.locator("#email").fill(ADMIN_EMAIL);
  await admin.locator("#password").fill(SEED_PASSWORD);
  await admin.locator('button[type="submit"]').click();
  await expect(admin).toHaveURL(/\/account/);
  await admin.goto("/ar/admin/suppliers?status=pending_verification");
  await admin.getByRole("row", { name: new RegExp(name) }).getByRole("link", { name: "مراجعة" }).click();
  await admin.getByRole("button", { name: "بدء المراجعة" }).click();
  await expect(admin.getByRole("button", { name: "بدء المراجعة" })).toHaveCount(0);
  for (let i = 0; i < 2; i++) {
    await admin.getByRole("button", { name: "تحقق", exact: true }).first().click();
    await admin.waitForTimeout(800);
  }
  await expect(admin.getByText("تم التحقق")).toHaveCount(2);
  await admin.locator('select[name="decision"]').selectOption("approved");
  await admin.getByRole("button", { name: "حفظ" }).click();
  await expect(admin.getByText("معتمد").first()).toBeVisible();

  // supplier now approved: warehouse, price list, product, price, stock, publish
  await supplier.goto("/ar/supplier");
  await expect(supplier.getByText("معتمد").first()).toBeVisible();
  await supplier.goto("/ar/supplier/warehouses");
  await supplier.getByRole("button", { name: "إضافة مستودع" }).click();
  let dlg = supplier.getByRole("dialog");
  await dlg.locator('input[name="name"]').fill("مستودع الرياض");
  await dlg.locator('select[name="city"]').selectOption("riyadh");
  await dlg.locator('button[type="submit"]').click();
  await expect(supplier.getByRole("cell", { name: "مستودع الرياض" })).toBeVisible();

  await supplier.goto("/ar/supplier/pricing");
  await supplier.getByRole("button", { name: "قائمة أسعار جديدة" }).click();
  dlg = supplier.getByRole("dialog");
  await dlg.locator('input[name="name"]').fill("Retail");
  await dlg.locator('button[type="submit"]').click();
  await expect(supplier.getByRole("cell", { name: "Retail" })).toBeVisible();

  await supplier.goto("/ar/supplier/products/new");
  await supplier.locator('input[name="sku"]').fill("E2E-PVC-110");
  await supplier.locator("#categoryId").selectOption({ label: "المواسير" });
  await supplier.locator('input[name="nameAr"]').fill("ماسورة اختبار 110 مم");
  await supplier.locator('input[name="nameEn"]').fill("Test pipe 110mm");
  await supplier.locator('select[name="saleUnit"]').selectOption("m");
  await supplier.locator('select[name="status"]').selectOption("active");
  await expect(supplier.locator('select[name="attr.material"]')).toBeVisible();
  await supplier.locator('select[name="attr.material"]').selectOption("upvc");
  await supplier.locator('input[name="attr.diameter_mm"]').fill("110");
  await supplier.getByRole("button", { name: "حفظ" }).click();
  await expect(supplier).toHaveURL(/\/supplier\/products\/[0-9a-f-]{36}$/);

  // publishing without a price is refused
  await supplier.getByRole("button", { name: "نشر في المتجر" }).click();
  await expect(supplier.locator("[data-sonner-toast]").filter({ hasText: "سعر التجزئة" })).toBeVisible();

  const pricing = supplier.locator("form").filter({ has: supplier.locator('input[name="unitPrice[]"]') });
  await pricing.locator('input[name="unitPrice[]"]').first().fill("27.5");
  await pricing.getByRole("button", { name: "حفظ الأسعار" }).click();
  await expect(supplier.locator("[data-sonner-toast]").filter({ hasText: "تم حفظ الأسعار" })).toBeVisible();

  const stock = supplier.locator("form").filter({ has: supplier.locator('input[name="onHand"]') });
  await stock.locator('input[name="onHand"]').fill("250");
  await stock.getByRole("button", { name: "تحديث" }).click();
  await expect(supplier.locator("[data-sonner-toast]").filter({ hasText: "تم تحديث المخزون" })).toBeVisible();

  await supplier.getByRole("button", { name: "نشر في المتجر" }).click();
  await expect(supplier.getByRole("button", { name: "إيقاف النشر" })).toBeVisible();

  await supplier.goto("/ar/supplier/products");
  await expect(supplier.getByRole("row", { name: /E2E-PVC-110/ })).toContainText("250");
});
