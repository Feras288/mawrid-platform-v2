import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createOrg, register, uniqueEmail } from "./helpers";

const FIXTURE = readFileSync(join(process.cwd(), "e2e", "fixtures", "boq-golden-ar.xlsx"));

test("critical paths 3–4: project, BOQ upload, automatic extraction, review and approval", async ({ page }) => {
  test.setTimeout(240_000);
  await register(page, { email: uniqueEmail("boq"), name: "مدير المشتريات" });
  await createOrg(page, "buyer", `BOQ Buyer ${Date.now()}`);

  // create project
  await page.goto("/ar/org/projects");
  await page.getByRole("button", { name: "مشروع جديد" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.locator('input[name="name"]').fill("مشروع برج الأعمال");
  await dlg.locator('select[name="projectType"]').selectOption("commercial");
  await dlg.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/org\/projects\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("مشروع برج الأعمال");

  // upload BOQ from the project page
  await page.getByRole("button", { name: "رفع جدول كميات" }).click();
  dlg = page.getByRole("dialog");
  await dlg.locator('input[name="title"]').fill("جدول كميات المرحلة الأولى");
  await dlg.locator('input[name="file"]').setInputFiles({ name: "boq.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: FIXTURE });
  await dlg.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/org\/boq\/[0-9a-f-]{36}$/, { timeout: 60_000 });

  // worker processes the file; page auto-refreshes until review state
  await expect(page.getByText("بحاجة لمراجعة").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("معالجة بالقواعد دون إرسال الملف لأي جهة خارجية")).toBeVisible();
  await expect(page.getByRole("cell", { name: /توريد وتركيب ماسورة يو بي في سي قطر 110 مم/ })).toBeVisible();

  // approval is blocked until lines are reviewed
  await page.getByRole("button", { name: "اعتماد جدول الكميات" }).click();
  dlg = page.getByRole("dialog");
  await dlg.locator('button[type="submit"]').click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "يجب مراجعة جميع البنود" })).toBeVisible();
  await page.keyboard.press("Escape");

  // edit one line (quantity) — creates a revision
  const row = page.getByRole("row", { name: /كاشف دخان معنون/ });
  await row.getByRole("button", { name: "تعديل" }).click();
  dlg = page.getByRole("dialog");
  await dlg.locator('input[name="quantity"]').fill("160");
  await dlg.getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("row", { name: /كاشف دخان معنون/ })).toContainText("160");

  // select all lines and approve them (human decision), then approve the BOQ
  await page.getByRole("checkbox", { name: "تحديد الكل" }).check();
  await page.getByRole("button", { name: "اعتماد المحدد" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "تم التحديث" })).toBeVisible();
  await page.getByRole("button", { name: "اعتماد جدول الكميات" }).click();
  dlg = page.getByRole("dialog");
  await dlg.locator('button[type="submit"]').click();
  await expect(page.getByText("الإصدارات المعتمدة")).toBeVisible();
  await expect(page.getByText("معتمد").first()).toBeVisible();
});
