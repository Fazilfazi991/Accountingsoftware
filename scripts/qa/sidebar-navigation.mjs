import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const baseUrl = process.env.LEDGERLY_PREVIEW_URL ?? "http://localhost:3010";
const email = process.env.LEDGERLY_PREVIEW_EMAIL;
const password = process.env.LEDGERLY_PREVIEW_PASSWORD;
if (!email || !password) throw new Error("Set local preview credentials before running navigation QA.");

const expectedRoutes = new Set([
  "/", "/sales/invoices", "/sales/quotations", "/sales/delivery-notes",
  "/sales/credit-notes", "/sales/customer-payments", "/purchases/bills",
  "/purchases/debit-notes", "/purchases/supplier-payments", "/inventory/opening",
  "/inventory/adjustments", "/inventory/transfers", "/reports/stock-summary",
  "/reports/stock-movements", "/reports/inventory-valuation",
  "/reports/cost-of-goods-sold", "/products", "/inventory/locations",
  "/inventory/units", "/accounting/opening-balances", "/accounting/journals",
  "/expenses", "/reports/customer-statement", "/reports/supplier-statement",
  "/reports/accounts-receivable", "/reports/accounts-payable",
  "/reports/profit-loss", "/reports/balance-sheet", "/reports/cash-flow",
  "/reports/trial-balance", "/reports/general-ledger", "/reports/vat-summary",
  "/reports/vat-transactions", "/reports", "/sales/customers",
  "/purchases/suppliers", "/accounting/masters", "/accounting/chart-of-accounts",
  "/accounting/account-groups", "/accounting/cash-accounts",
  "/accounting/bank-accounts", "/accounting/tax-rates",
  "/accounting/financial-years", "/accounting/document-numbering",
  "/settings", "/settings/audit-log",
]);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const waitForDashboard = (page) => page.waitForFunction(
  () => [...document.querySelectorAll(".dashboard-metrics .metric strong")]
    .some((element) => element.textContent?.trim() !== "—"),
  null,
  { timeout: 15000 },
);
const screenshots = ".impeccable/review";
await mkdir(screenshots, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const browserErrors = [];
page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") browserErrors.push(message.text());
});

try {
  console.log("QA: opening local sign-in");
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await Promise.all([
    page.waitForURL(`${baseUrl}/`),
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);
  console.log("QA: authenticated local workspace");
  await page.getByRole("heading", { name: /Good afternoon/ }).waitFor();
  await waitForDashboard(page);

  const primaryLabels = await page.locator(".primary-nav-item .nav-label").allTextContents();
  assert(primaryLabels.join("|") === "Overview|Sales|Purchases|Inventory|Accounts|Reports|Masters|Settings", "Primary navigation order changed.");
  const discovered = new Set([await page.getByRole("link", { name: "Overview", exact: true }).getAttribute("href")]);
  for (const label of primaryLabels.slice(1)) {
    await page.getByRole("button", { name: label, exact: true }).click();
    assert(await page.locator(".nav-flyout").count() === 1, `${label} did not open exactly one flyout.`);
    assert(await page.evaluate(() => document.activeElement?.closest(".nav-flyout") !== null), `${label} flyout did not receive keyboard focus.`);
    for (const href of await page.locator(".nav-flyout a").evaluateAll((links) => links.map((link) => link.getAttribute("href")))) discovered.add(href);
  }
  console.log("QA: complete route inventory found");
  assert(discovered.size === expectedRoutes.size, `Expected ${expectedRoutes.size} routes, found ${discovered.size}.`);
  for (const route of expectedRoutes) assert(discovered.has(route), `Missing navigation route ${route}.`);
  await page.keyboard.press("Escape");
  assert(await page.locator(".nav-flyout").count() === 0, "Escape did not close the flyout.");
  assert(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Settings"), "Escape did not return focus to the group trigger.");
  assert(await page.locator(".sidebar").evaluate((element) => Math.round(element.getBoundingClientRect().width)) === 232, "Expanded desktop sidebar is not 232px.");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  assert(await page.locator(".sidebar").evaluate((element) => Math.round(element.getBoundingClientRect().width)) === 72, "Collapsed sidebar is not 72px.");
  assert(await page.evaluate(() => localStorage.getItem("ledgerly-sidebar-collapsed")) === "true", "Collapsed preference was not stored.");
  await page.reload({ waitUntil: "domcontentloaded" });
  assert(await page.locator(".sidebar").evaluate((element) => Math.round(element.getBoundingClientRect().width)) === 72, "Collapsed preference did not survive reload.");
  await waitForDashboard(page);
  await page.evaluate(() => {
    localStorage.setItem("ledgerly-sidebar-collapsed", "false");
    window.dispatchEvent(new Event("ledgerly-sidebar-preference"));
  });
  await page.locator(".sidebar:not(.collapsed)").waitFor();
  await page.getByRole("button", { name: "Sales", exact: true }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${screenshots}/sidebar-1440x900-sales.png`, fullPage: false });
  console.log("QA: desktop interactions passed");

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await page.waitForTimeout(250);
  assert(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth), "Desktop has horizontal overflow.");
  await page.screenshot({ path: `${screenshots}/sidebar-1920x1080-reports.png`, fullPage: false });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page.waitForTimeout(250);
  assert(await page.locator(".sidebar").evaluate((element) => Math.round(element.getBoundingClientRect().width)) === 72, "Tablet did not use the compact rail.");
  assert(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth), "Tablet has horizontal overflow.");
  await page.screenshot({ path: `${screenshots}/sidebar-1024x768-inventory.png`, fullPage: false });
  console.log("QA: tablet interactions passed");

  for (const [width, height] of [[390, 844], [375, 812]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => document.activeElement?.classList.contains("mobile-close")), "Opening the mobile drawer did not move focus inside it.");
    await page.keyboard.press("Shift+Tab");
    assert(await page.evaluate(() => document.activeElement?.closest(".mobile-nav") !== null), "Mobile drawer did not trap reverse-tab focus.");
    await page.getByRole("button", { name: "Sales", exact: true }).click();
    await page.waitForTimeout(220);
    assert(await page.locator(".mobile-nav-group [aria-expanded=true]").count() === 1, "Mobile opened more than one accordion group.");
    assert(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth), `Mobile ${width}px has horizontal overflow.`);
    await page.screenshot({ path: `${screenshots}/sidebar-${width}x${height}-sales.png`, fullPage: false });
    await Promise.all([
      page.waitForURL(`${baseUrl}/sales/quotations`),
      page.locator(".mobile-nav-sections").getByRole("link", { name: "Quotations", exact: true }).click(),
    ]);
    assert(!(await page.locator(".sidebar-wrap").getAttribute("class")).includes("open"), "Mobile drawer stayed open after navigation.");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.waitForTimeout(300);
    assert(await page.locator(".mobile-nav-group > button.active").getAttribute("aria-controls") === "mobile-nav-1", "Active child route did not highlight its mobile parent.");
    assert(await page.locator(".mobile-nav-sections a.active").getAttribute("href") === "/sales/quotations", "Active child route was not highlighted.");
    await page.locator(".mobile-close").click();
    await page.waitForTimeout(50);
    assert(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Open navigation"), "Closing the mobile drawer did not restore trigger focus.");
  }

  assert(browserErrors.length === 0, `Browser console errors: ${browserErrors.join(" | ")}`);
  console.log(`PASS sidebar navigation: ${expectedRoutes.size} routes, 5 viewports, no overflow or console errors.`);
} finally {
  await browser.close();
}
