import { expect, test, type Page } from "@playwright/test";
import { createOrg, register, uniqueEmail } from "./helpers";

const SUPPLIER_EMAIL = "supplier.owner@demo.test";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "Seed-Passw0rd-2026!";
const SUPPLIER_NAME = /Demo Supply Est\./;

const toast = (page: Page, text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text }).first();

/** Reload until the locator appears (for state advanced by background jobs). */
async function reloadUntil(page: Page, locator: ReturnType<Page["locator"]>, timeout = 90_000) {
  await expect(async () => {
    await page.reload();
    await expect(locator).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout, intervals: [1_000, 2_000, 3_000] });
}

function futureLocal(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return { date: d.toISOString().slice(0, 10), datetime: `${d.toISOString().slice(0, 10)}T12:00` };
}

test("critical paths 5–12: RFQ → supplier quotation → comparison & award → PO → shipment → receipt", async ({ browser }) => {
  test.setTimeout(420_000);
  const title = `E2E RFQ ${Date.now()}`;

  // ---------------------------------------------------------------- buyer creates a manual RFQ
  const buyer = await (await browser.newContext()).newPage();
  await register(buyer, { email: uniqueEmail("rfq"), name: "Procurement Lead" });
  await createOrg(buyer, "buyer", `RFQ Buyer ${Date.now()}`);
  await buyer.goto("/en/org/rfqs");
  await buyer.getByRole("button", { name: "New RFQ" }).click();
  let dlg = buyer.getByRole("dialog");
  await dlg.locator('input[name="title"]').fill(title);
  await dlg.locator('input[name="closesAt"]').fill(futureLocal(7).datetime);
  await dlg.locator('textarea[name="paymentTerms"]').fill("30 days");
  await dlg.locator('button[type="submit"]').click();
  await expect(buyer).toHaveURL(/\/en\/org\/rfqs\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const rfqUrl = buyer.url();

  for (const [desc, qty] of [
    ["uPVC pipe 110mm", "120"],
    ["Copper cable 4x16mm² XLPE", "300"],
  ] as const) {
    await buyer.getByRole("button", { name: "Add line" }).click();
    dlg = buyer.getByRole("dialog");
    await dlg.locator('textarea[name="description"]').fill(desc);
    await dlg.locator('input[name="quantity"]').fill(qty);
    await dlg.locator('select[name="unit"]').selectOption("m");
    await dlg.locator('button[type="submit"]').click();
    await expect(buyer.getByRole("dialog")).toHaveCount(0);
    await expect(buyer.getByRole("cell", { name: desc })).toBeVisible();
  }

  // invite the seeded approved supplier
  const recipients = buyer.locator("form").filter({ has: buyer.locator('input[name="supplierOrgIds[]"]') });
  await recipients.getByLabel(SUPPLIER_NAME).first().check();
  await recipients.getByRole("button", { name: "Save supplier list" }).click();
  await expect(toast(buyer, "Saved")).toBeVisible();
  await expect(buyer.getByRole("cell", { name: SUPPLIER_NAME })).toBeVisible();

  // submit (no policy → auto-approved) and send
  await buyer.getByRole("button", { name: "Submit for review & approval" }).click();
  await expect(buyer.getByText("Approved for sending").first()).toBeVisible();
  await buyer.getByRole("button", { name: "Send to suppliers" }).click();
  await expect(toast(buyer, "RFQ sent")).toBeVisible();
  await reloadUntil(buyer, buyer.getByRole("row", { name: SUPPLIER_NAME }).getByText("Sent"));
  await expect(buyer.getByText("Open").first()).toBeVisible();

  // ---------------------------------------------------------------- supplier responds
  const supplier = await (await browser.newContext()).newPage();
  await supplier.goto("/en/login");
  await supplier.locator("#email").fill(SUPPLIER_EMAIL);
  await supplier.locator("#password").fill(SEED_PASSWORD);
  await supplier.locator('button[type="submit"]').click();
  await expect(supplier).toHaveURL(/\/account/);
  await supplier.goto("/en/account/organizations");
  await supplier.getByRole("button", { name: "Open" }).first().click();
  await expect(supplier).toHaveURL(/\/supplier/, { timeout: 60_000 });
  await supplier.goto("/en/supplier/rfqs");
  await supplier.getByRole("link", { name: title }).click();
  await expect(supplier.getByRole("heading", { level: 1 })).toHaveText(title);
  await supplier.locator('input[name="validUntil"]').fill(futureLocal(30).date);
  await supplier.locator('input[name="leadTimeDays"]').fill("5");
  await supplier.locator('input[name="unitPrice[]"]').nth(0).fill("22");
  await supplier.locator('input[name="unitPrice[]"]').nth(1).fill("57.5");
  await supplier.getByRole("button", { name: "Submit quotation" }).click();
  await expect(toast(supplier, "Quotation submitted")).toBeVisible();
  await expect(supplier.getByText("Submitted").first()).toBeVisible();

  // ---------------------------------------------------------------- buyer evaluates and awards
  await buyer.goto(rfqUrl);
  buyer.once("dialog", (d) => void d.accept());
  await buyer.getByRole("button", { name: "Close submissions & start evaluation" }).click();
  await expect(buyer.getByText("Under evaluation").first()).toBeVisible();
  await buyer.getByRole("link", { name: "Compare quotations" }).click();
  await expect(buyer.getByRole("heading", { level: 1 })).toHaveText("Quotation comparison");
  await expect(buyer.getByText("Lowest complete total")).toBeVisible();

  const awardForms = buyer.locator("form").filter({ has: buyer.locator('input[name="rfqItemId"]') });
  await expect(awardForms).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const form = awardForms.nth(i);
    await form.locator('select[name="supplierOrgId"]').selectOption({ label: "Demo Supply Est." });
    await form.locator('input[name="reason"]').fill("Lowest compliant price");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(buyer.locator(".bg-success-50").nth(i)).toBeVisible();
  }
  await buyer.getByRole("button", { name: "Submit award for approval" }).click();
  dlg = buyer.getByRole("dialog");
  await dlg.locator('button[type="submit"]').click();
  await expect(buyer.getByRole("dialog")).toHaveCount(0);
  await expect(buyer.getByText("Approved").first()).toBeVisible();

  // idempotent PO creation from the approved award
  await buyer.getByRole("button", { name: "Create purchase orders" }).click();
  await expect(buyer).toHaveURL(/\/en\/org\/purchase-orders$/, { timeout: 60_000 });
  const poLink = buyer.getByRole("row", { name: SUPPLIER_NAME }).getByRole("link").first();
  const poCode = (await poLink.textContent())!.trim();
  await poLink.click();
  await expect(buyer.getByText("Draft").first()).toBeVisible();
  await buyer.getByRole("button", { name: "Submit for approval & issue" }).click();
  await expect(buyer.getByText("Issued").first()).toBeVisible();
  // bilingual PDFs are generated in the background
  await reloadUntil(buyer, buyer.getByRole("link", { name: "PDF (Arabic)" }));
  const poUrl = buyer.url();

  // ---------------------------------------------------------------- supplier fulfils
  // PO numbers are sequenced per buyer org, so the supplier may see the same number from several buyers
  const poId = poUrl.split("/").pop()!;
  await supplier.goto("/en/supplier/purchase-orders");
  await supplier.locator(`a[href$="/supplier/purchase-orders/${poId}"]`).click();
  await expect(supplier.getByRole("heading", { level: 1 })).toHaveText(poCode);
  await supplier.getByRole("button", { name: "Acknowledge & start preparing" }).click();
  await expect(supplier.getByText("Preparing").first()).toBeVisible();
  await supplier.getByRole("button", { name: "Record shipment" }).click();
  dlg = supplier.getByRole("dialog");
  await dlg.locator('input[name="carrier"]').fill("Own fleet");
  await dlg.locator('input[name="quantity[]"]').first().fill("60"); // partial shipment of line 1
  await dlg.locator('button[type="submit"]').click();
  await expect(supplier.getByRole("dialog")).toHaveCount(0);
  await expect(supplier.getByText("Partially shipped").first()).toBeVisible();
  await supplier.getByRole("button", { name: "Record shipment" }).click();
  dlg = supplier.getByRole("dialog");
  await dlg.locator('button[type="submit"]').click();
  await expect(supplier.getByRole("dialog")).toHaveCount(0);
  await expect(supplier.getByText("Shipped").first()).toBeVisible();

  // ---------------------------------------------------------------- buyer receives and closes
  await buyer.goto(poUrl);
  await buyer.getByRole("button", { name: "Record receipt" }).click();
  dlg = buyer.getByRole("dialog");
  await dlg.locator('button[type="submit"]').click();
  await expect(buyer.getByRole("dialog")).toHaveCount(0);
  await expect(buyer.getByText("Delivered").first()).toBeVisible();
  await buyer.getByRole("button", { name: "Close PO" }).click();
  await expect(buyer.getByText("Completed").first()).toBeVisible();

  // public verification page rejects unknown codes without leaking data
  await buyer.goto("/en/verify/po/unknown-code-123");
  await expect(buyer.getByRole("status")).toHaveText("No purchase order found for this code");
});
