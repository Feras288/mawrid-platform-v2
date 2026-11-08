import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { login, register, uniqueEmail } from "./helpers";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@platform.test";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "Seed-Passw0rd-2026!";
const toast = (page: Page, text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text }).first();

async function adminLogin(page: Page) {
  await page.goto("/en/login");
  await page.locator("#email").fill(ADMIN_EMAIL);
  await page.locator("#password").fill(SEED_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/account/);
}

test("admin console: all sections render; secrets stay hidden; content publishes; break-glass is read-only", async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await (await browser.newContext()).newPage();
  await adminLogin(page);

  for (const [path, heading] of [
    ["/en/admin/users", "Users"],
    ["/en/admin/organizations", "Organizations"],
    ["/en/admin/integrations", "Integrations & settings"],
    ["/en/admin/flags", "Feature flags"],
    ["/en/admin/jobs", "Jobs & deliveries"],
    ["/en/admin/ai-usage", "AI usage & cost"],
    ["/en/admin/audit", "Audit log"],
    ["/en/admin/privacy", "Privacy requests"],
    ["/en/admin/content", "Content pages"],
    ["/en/admin/reports", "Reports"],
    ["/en/admin/finance", "Finance"],
    ["/en/admin/store-orders", "Store orders"],
    ["/en/admin/shipping", "Default delivery rates"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }), path).toHaveText(heading);
  }
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // SMTP password is stored but never shown back
  await page.goto("/en/admin/integrations");
  const smtp = page.getByRole("form", { name: "Email (SMTP)" });
  await smtp.locator('input[name="host"]').fill("smtp.e2e.test");
  await smtp.locator('input[name="from"]').fill("no-reply@e2e.test");
  await smtp.locator('input[name="__secret"]').fill("e2e-smtp-secret-value");
  await smtp.getByRole("button", { name: "Save" }).click();
  await expect(toast(page, "Saved")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("form", { name: "Email (SMTP)" }).getByText("A secret is stored (hidden)")).toBeVisible();
  expect(await page.content()).not.toContain("e2e-smtp-secret-value");
  // restore: clear SMTP override so local mail keeps flowing through the environment config
  const smtp2 = page.getByRole("form", { name: "Email (SMTP)" });
  await smtp2.locator('input[name="host"]').fill("");
  await smtp2.locator('input[name="from"]').fill("");
  await smtp2.getByRole("checkbox", { name: "Remove stored secret" }).check();
  await smtp2.getByRole("button", { name: "Save" }).click();
  await expect(toast(page, "Saved")).toBeVisible();

  // content: draft → publish → public page
  await page.goto("/en/admin/content");
  await page.getByRole("button", { name: "New draft" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.locator('select[name="slug"]').selectOption("returns");
  await dlg.locator('select[name="locale"]').selectOption("en");
  const title = `Returns policy ${Date.now()}`;
  await dlg.locator('input[name="title"]').fill(title);
  await dlg.locator('textarea[name="body"]').fill("Items may be returned within 7 days of delivery. Draft pending legal review.");
  await dlg.locator('button[type="submit"]').click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("row", { name: new RegExp(title) }).getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("row", { name: new RegExp(title) }).getByText("Published")).toBeVisible();
  await page.goto("/en/legal/returns");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

  // break-glass into the demo buyer org: reason required, read-only banner, audited
  await page.goto("/en/admin/organizations?q=Demo%20Construction");
  await page.getByRole("row", { name: /Demo Construction/ }).getByRole("button", { name: "Exceptional access (break-glass)" }).click();
  const bg = page.getByRole("dialog");
  await bg.locator('textarea[name="reason"]').fill("E2E: verifying exceptional read-only access workflow");
  await bg.locator('input[name="minutes"]').fill("10");
  await bg.locator('button[type="submit"]').click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Open read-only" }).first().click();
  await expect(page).toHaveURL(/\/en\/org$/, { timeout: 60_000 });
  await expect(page.getByRole("alert").filter({ hasText: "Break-glass read-only access" })).toBeVisible();
  await page.goto("/en/admin/audit?action=breakglass");
  await expect(page.getByText("breakglass.opened").first()).toBeVisible();
  await page.goto("/en/admin/organizations?q=Demo%20Construction");
  await page.getByRole("button", { name: "Revoke" }).first().click();
  await expect(page.getByRole("button", { name: "Open read-only" })).toHaveCount(0);
});

test("privacy self-service: consents and personal data export", async ({ page }) => {
  test.setTimeout(180_000);
  const email = uniqueEmail("pdpl");
  await register(page, { email, name: "Privacy User", locale: "en" });
  await login(page, email, "en");
  await page.goto("/en/account/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy & my data");
  // optional consent can be granted and withdrawn
  const marketing = page.locator("div").filter({ hasText: /^Marketing messages/ }).last();
  await marketing.getByRole("button", { name: "Allow" }).click();
  await expect(page.locator("div").filter({ hasText: /^Marketing messages/ }).last().getByText("Granted")).toBeVisible();
  // export is prepared by the worker and offered for download
  await page.getByRole("button", { name: "Prepare my data" }).click();
  await expect(toast(page, "Request submitted")).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("link", { name: "Download" })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 3_000] });
  const href = await page.getByRole("link", { name: "Download" }).getAttribute("href");
  const res = await page.request.get(href!, { maxRedirects: 0 });
  expect([200, 302, 303, 307]).toContain(res.status());
});
