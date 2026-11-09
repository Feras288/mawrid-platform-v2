import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createOrg, register, uniqueEmail } from "./helpers";

const SUPPLIER_EMAIL = "supplier.owner@demo.test";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "Seed-Passw0rd-2026!";

const BUYER_PAGES = ["/org", "/org/projects", "/org/boq", "/org/rfqs", "/org/approvals", "/org/purchase-orders", "/org/analytics", "/org/price-index", "/org/members", "/org/roles", "/org/approval-policies", "/org/settings", "/org/audit", "/account", "/account/orders", "/account/addresses", "/account/wishlist", "/account/notifications", "/account/security", "/account/privacy"];
const SUPPLIER_PAGES = ["/supplier", "/supplier/profile", "/supplier/documents", "/supplier/products", "/supplier/pricing", "/supplier/warehouses", "/supplier/rfqs", "/supplier/purchase-orders", "/supplier/orders", "/supplier/returns", "/supplier/shipping", "/supplier/analytics"];
const PUBLIC_PAGES = ["/", "/products", "/legal/terms", "/login", "/register"];

async function check(page: Page, path: string, opts: { axe: boolean; overflow: boolean }) {
  const res = await page.goto(path);
  expect(res?.status(), path).toBeLessThan(400);
  await expect(page.locator("main").first(), path).toBeVisible();
  await expect(page.getByText("Something went wrong"), path).toHaveCount(0);
  const dir = await page.locator("html").getAttribute("dir");
  expect(dir, path).toBe(path.startsWith("/ar") ? "rtl" : "ltr");
  if (opts.overflow) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1);
  }
  if (opts.axe) {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.target}`), path).toEqual([]);
  }
}

async function sweep(page: Page, paths: string[], mobile: boolean) {
  for (const locale of ["ar", "en"] as const) {
    for (const p of paths) await check(page, `/${locale}${p === "/" ? "" : p}`, { axe: !mobile, overflow: mobile });
  }
}

for (const [label, pages] of [
  ["organization (buyer) pages", BUYER_PAGES.filter((p) => p.startsWith("/org"))],
  ["account & storefront pages", [...PUBLIC_PAGES.filter((p) => !["/login", "/register"].includes(p)), ...BUYER_PAGES.filter((p) => p.startsWith("/account"))]],
] as const) {
  test(`@mobile portal sweep: ${label} render in Arabic and English without errors, overflow or serious a11y issues`, async ({ page, isMobile }) => {
    test.setTimeout(900_000);
    await register(page, { email: uniqueEmail("sweep"), name: "Sweep User" });
    await createOrg(page, "buyer", `Sweep Buyer ${Date.now()}`);
    await sweep(page, [...pages], isMobile);
  });
}

test("@mobile portal sweep: supplier pages", async ({ page, isMobile }) => {
  test.setTimeout(900_000);
  await page.goto("/ar/login");
  await page.locator("#email").fill(SUPPLIER_EMAIL);
  await page.locator("#password").fill(SEED_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/account/);
  await page.goto("/ar/account/organizations");
  await page.getByRole("button", { name: "الدخول" }).first().click();
  await expect(page).toHaveURL(/\/supplier/, { timeout: 60_000 });
  await sweep(page, SUPPLIER_PAGES, isMobile);
});

test("@mobile public pages and auth forms", async ({ page, isMobile }) => {
  test.setTimeout(300_000);
  await sweep(page, PUBLIC_PAGES, isMobile);
});
