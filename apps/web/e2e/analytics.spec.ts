import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createOrg, register, uniqueEmail } from "./helpers";

async function noSeriousA11y(page: Page, path: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, `${path}: ${serious.map((v) => `${v.id} (${v.nodes[0]?.target})`).join(", ")}`).toEqual([]);
}

test("analytics and price index dashboards render with data tables, methodology and no serious a11y issues", async ({ page }) => {
  test.setTimeout(180_000);
  await register(page, { email: uniqueEmail("kpi"), name: "Analyst" });
  await createOrg(page, "buyer", `KPI Buyer ${Date.now()}`);

  await page.goto("/en/org/analytics");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Analytics");
  await expect(page.getByText("PO value", { exact: true })).toBeVisible();
  const chart = page.getByRole("img", { name: /Purchase order spend by month/ });
  await expect(chart).toBeVisible();
  // exact values are always reachable without the chart
  await page.getByText("Show data table").click();
  await expect(page.getByRole("columnheader", { name: "Value" })).toBeVisible();
  await noSeriousA11y(page, "/en/org/analytics");

  await page.goto("/ar/org/price-index");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("مؤشر الأسعار");
  await expect(page.getByText("المنهجية")).toBeVisible();
  await expect(page.getByText(/5 مشاهدات على الأقل من 3 جهات مستقلة/)).toBeVisible();
  await noSeriousA11y(page, "/ar/org/price-index");
});
