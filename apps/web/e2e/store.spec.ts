import { expect, test, type Page } from "@playwright/test";
import { register, uniqueEmail } from "./helpers";

const SUPPLIER_EMAIL = "supplier.owner@demo.test";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "Seed-Passw0rd-2026!";
const toast = (page: Page, text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text }).first();

test("critical path 13: store purchase with test payment, supplier fulfilment and tax invoice", async ({ browser }) => {
  test.setTimeout(300_000);
  const customer = await (await browser.newContext()).newPage();
  await register(customer, { email: uniqueEmail("shopper"), name: "عميل المتجر" });

  // browse & search
  await customer.goto("/ar/products?q=UPVC-110");
  await expect(customer.getByRole("status")).toContainText("1");
  await customer.getByRole("link", { name: /ماسورة يو بي في سي 110/ }).first().click();
  await expect(customer.getByRole("heading", { level: 1 })).toContainText("ماسورة يو بي في سي 110");
  await expect(customer.getByText("سعر التجزئة")).toBeVisible();

  // add 4 to cart
  await customer.getByRole("textbox", { name: "الكمية" }).fill("4");
  await customer.getByRole("button", { name: "أضف إلى السلة" }).click();
  await expect(toast(customer, "تمت الإضافة إلى السلة")).toBeVisible();
  await customer.getByRole("link", { name: /السلة/ }).click();
  await expect(customer.getByRole("heading", { name: "السلة" })).toBeVisible();
  await expect(customer.getByText(/شحنة من/)).toBeVisible();
  await customer.getByRole("link", { name: "إتمام الطلب" }).click();

  // add a delivery address
  await customer.getByRole("button", { name: "عنوان جديد" }).click();
  const dlg = customer.getByRole("dialog");
  await dlg.locator('input[name="recipientName"]').fill("عميل المتجر");
  await dlg.locator('input[name="phone"]').fill("+966500000001");
  await dlg.locator('select[name="city"]').selectOption("riyadh");
  await dlg.locator('input[name="line1"]').fill("طريق الملك فهد، مبنى 12");
  await dlg.locator('button[type="submit"]').click();
  await expect(customer.getByRole("dialog")).toHaveCount(0);

  // checkout: default address, platform default delivery, card, accept terms
  await expect(customer.getByRole("radio", { name: /عميل المتجر/ })).toBeChecked();
  await expect(customer.locator('select[name="method[]"]')).toBeVisible();
  await customer.getByRole("checkbox", { name: /أوافق على شروط البيع/ }).check();
  await customer.getByRole("button", { name: /تأكيد الطلب/ }).click();

  // test provider "hosted page" → simulate success → result page
  await expect(customer).toHaveURL(/\/checkout\/pay\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(customer.getByText("لبيئة التطوير والاختبار فقط")).toBeVisible();
  await customer.getByRole("button", { name: "محاكاة دفع ناجح" }).click();
  await expect(customer).toHaveURL(/\/checkout\/result\?order=/);
  await expect(customer.getByRole("status")).toHaveText("تم استلام الدفع وتأكيد طلبك.");
  await customer.getByRole("link", { name: "عرض الطلب" }).click();
  await expect(customer).toHaveURL(/\/account\/orders\/[0-9a-f-]{36}$/);
  const orderUrl = customer.url();
  await expect(customer.getByText("مدفوع").first()).toBeVisible();
  const orderCode = (await customer.getByRole("heading", { level: 1 }).textContent())!.trim();
  // 4 × 24.50 = 98.00 + 25.00 shipping (below free threshold) + 15% VAT = 141.45
  await expect(customer.getByText("141.45").first()).toBeVisible();

  // supplier prepares, ships and delivers its group
  const supplier = await (await browser.newContext()).newPage();
  await supplier.goto("/ar/login");
  await supplier.locator("#email").fill(SUPPLIER_EMAIL);
  await supplier.locator("#password").fill(SEED_PASSWORD);
  await supplier.locator('button[type="submit"]').click();
  await expect(supplier).toHaveURL(/\/account/);
  await supplier.goto("/ar/account/organizations");
  await supplier.getByRole("button", { name: "الدخول" }).first().click();
  await expect(supplier).toHaveURL(/\/supplier/, { timeout: 60_000 });
  await supplier.goto("/ar/supplier/orders");
  await supplier.getByRole("link", { name: `${orderCode}-1` }).click();
  await supplier.getByRole("button", { name: "بدء التجهيز" }).click();
  await expect(supplier.getByText("قيد التجهيز").first()).toBeVisible();
  await supplier.getByRole("button", { name: "تأكيد الشحن" }).click();
  const shipDlg = supplier.getByRole("dialog");
  await shipDlg.locator('input[name="carrier"]').fill("أسطول المورد");
  await shipDlg.locator('input[name="trackingNumber"]').fill("TRK-777");
  await shipDlg.locator('button[type="submit"]').click();
  await expect(supplier.getByText("تم الشحن").first()).toBeVisible();
  await supplier.getByRole("button", { name: "تأكيد التسليم" }).click();
  await expect(supplier.getByText("تم التسليم").first()).toBeVisible();
  await expect(supplier.getByText("المستحق لك")).toBeVisible();

  // customer sees delivery and can open the tax invoice with its ZATCA QR
  await customer.goto(orderUrl);
  await expect(customer.getByText("تم التسليم").first()).toBeVisible();
  await expect(customer.getByText("TRK-777")).toBeVisible();
  await customer.getByRole("link", { name: "عرض" }).first().click();
  await expect(customer.getByRole("heading", { level: 1 })).toHaveText("فاتورة ضريبية مبسطة");
  await expect(customer.getByRole("img", { name: "ZATCA QR" })).toBeVisible();
  await expect(customer.getByText("141.45").first()).toBeVisible();
});

test("@mobile store pages render on small screens without horizontal overflow", async ({ page }) => {
  for (const path of ["/ar", "/ar/products", "/en/products?q=pipe"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
