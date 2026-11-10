import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@platform.test";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "Seed-Passw0rd-2026!";
const toast = (page: Page, text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text }).first();

test("admin supplier products: list, create on a supplier's behalf (reason required), edit, audit", async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await (await browser.newContext()).newPage();
  await page.goto("/en/login");
  await page.locator("#email").fill(ADMIN_EMAIL);
  await page.locator("#password").fill(SEED_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/account/);

  await page.goto("/en/admin/products");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Supplier products");
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // create on behalf of the seeded supplier
  await page.getByRole("link", { name: "New product" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New product on behalf of a supplier");
  const sku = `E2E-ADM-${Date.now()}`;
  const supplier = page.locator('select[name="supplierOrgId"]');
  const firstSupplier = await supplier.locator("option:not([value=''])").first().getAttribute("value");
  await supplier.selectOption(firstSupplier!);
  await page.locator('input[name="sku"]').fill(sku);
  await page.locator("#categoryId").selectOption({ index: 1 });
  await page.locator('input[name="nameAr"]').fill("منتج من الإدارة");
  await page.locator('input[name="nameEn"]').fill("Admin created product");
  await page.locator('select[name="saleUnit"]').selectOption("pc");
  await page.locator('input[name="reason"]').fill("e2e: created on the supplier's request");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(toast(page, "Product saved")).toBeVisible();
  await expect(page).toHaveURL(/\/en\/admin\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Admin created product");

  // edit: the reason of the edit form is required
  const editForm = page.locator("form").filter({ has: page.locator('input[name="sku"]') });
  await editForm.locator('input[name="nameEn"]').fill("Admin edited product");
  await editForm.locator('input[name="reason"]').fill("e2e: fix the name");
  await editForm.getByRole("button", { name: "Save" }).click();
  // the form refreshes the page on success (the create toast may still be on screen, so wait for the data itself)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Admin edited product");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Admin edited product");

  // listed with its supplier, and the change is in the audit log
  await page.goto(`/en/admin/products?q=${sku}`);
  await expect(page.getByRole("cell", { name: sku })).toBeVisible();
  await page.goto("/en/admin/audit?action=product.updated");
  await expect(page.getByText("product.updated").first()).toBeVisible();
});
