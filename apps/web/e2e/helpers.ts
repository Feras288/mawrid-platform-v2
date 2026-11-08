import { expect, type Page } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8026";
export const PASSWORD = process.env.E2E_PASSWORD ?? "E2e-Passw0rd-2026!";

export const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.test`;

/** Poll Mailpit for the latest message to `to` and return the first link in its text body. */
export async function linkFromEmail(to: string, contains?: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    if (res.ok) {
      const data = (await res.json()) as { messages: { ID: string; Subject: string }[] };
      for (const m of data.messages ?? []) {
        const full = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string };
        const link = full.Text.match(/https?:\/\/\S+/)?.[0];
        if (link && (!contains || link.includes(contains))) return link;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No email for ${to}`);
}

export async function register(page: Page, opts: { email: string; name: string; locale?: "ar" | "en" }) {
  const l = opts.locale ?? "ar";
  await page.goto(`/${l}/register`);
  await page.locator("#name").fill(opts.name);
  await page.locator("#email").fill(opts.email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#confirm").fill(PASSWORD);
  await page.locator('input[name="terms"]').check();
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/check-email/);
  const link = await linkFromEmail(opts.email, "verify-email");
  await page.goto(link);
  await expect(page).toHaveURL(/login\?verified=1/);
}

export async function login(page: Page, email: string, locale: "ar" | "en" = "ar") {
  await page.goto(`/${locale}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/account/);
}

export async function createOrg(page: Page, type: "buyer" | "supplier", nameEn: string) {
  await page.goto("/ar/account/organizations");
  await page.getByRole("button", { name: type === "buyer" ? "إنشاء مؤسسة مشترية" : "تسجيل كمورد" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="nameAr"]').fill(`مؤسسة ${nameEn}`);
  await dialog.locator('input[name="nameEn"]').fill(nameEn);
  await dialog.locator('input[name="city"]').fill("الرياض");
  await dialog.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(type === "buyer" ? /\/ar\/org$/ : /\/ar\/supplier\/profile/);
}
