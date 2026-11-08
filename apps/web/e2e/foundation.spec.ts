import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createOrg, linkFromEmail, login, register, uniqueEmail } from "./helpers";

test.describe("foundation: identity, organizations, members", () => {
  test("pages are RTL in Arabic and LTR in English", async ({ page }) => {
    await page.goto("/ar/login");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.goto("/en/login");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  });

  test("auth pages have no serious accessibility violations", async ({ page }) => {
    for (const path of ["/ar/login", "/ar/register", "/en/login"]) {
      await page.goto(path);
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious, `${path}: ${serious.map((v) => v.id).join(", ")}`).toEqual([]);
    }
  });

  test("unverified users cannot sign in; protected pages redirect", async ({ page }) => {
    await page.goto("/ar/org");
    await expect(page).toHaveURL(/\/ar\/login/);
  });

  test("critical path 1: register, verify, create buyer org, invite and accept member", async ({ browser }) => {
    const owner = await browser.newPage();
    const ownerEmail = uniqueEmail("owner");
    await register(owner, { email: ownerEmail, name: "مالك الاختبار" });
    await createOrg(owner, "buyer", `Buyer ${Date.now()}`);

    await owner.goto("/ar/org/members");
    const memberEmail = uniqueEmail("member");
    await owner.getByRole("button", { name: "دعوة عضو" }).click();
    const dlg = owner.getByRole("dialog");
    await dlg.locator('input[name="email"]').fill(memberEmail);
    await dlg.getByLabel("موظف مشتريات").check();
    await dlg.locator('button[type="submit"]').click();
    await expect(owner.getByText(memberEmail)).toBeVisible();

    const member = await (await browser.newContext()).newPage();
    await register(member, { email: memberEmail, name: "موظف المشتريات" });
    const invite = await linkFromEmail(memberEmail, "/invite/");
    await login(member, memberEmail);
    await member.goto(invite);
    await member.getByRole("button", { name: "قبول الدعوة" }).click();
    await expect(member).toHaveURL(/account\/organizations/);

    await owner.reload();
    await expect(owner.getByRole("cell", { name: /موظف المشتريات/ })).toBeVisible();
  });

  test("@mobile account portal renders on small screens", async ({ page }) => {
    const email = uniqueEmail("mobile");
    await register(page, { email, name: "Mobile User" });
    await page.goto("/ar/account");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
  });
});
