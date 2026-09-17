import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseURL = process.env.QA_BASE_URL || "http://localhost:3100";
const email = process.env.QA_EMAIL;
const password = process.env.QA_PASSWORD;
if (!email || !password) throw new Error("Set QA_EMAIL and QA_PASSWORD for the disposable local QA user.");

const outputDir = path.resolve(".impeccable/review");
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function authenticatedPage(viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(`${baseURL}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("login"));
  return { context, page };
}

async function assertNoOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    width: document.documentElement.scrollWidth,
  }));
  if (metrics.width > metrics.viewport) {
    throw new Error(`${label} overflows horizontally: ${metrics.width}px > ${metrics.viewport}px`);
  }
}

async function selectPrefix(select, prefix) {
  await select.locator("option").filter({ hasText: prefix }).first().waitFor({ state: "attached" });
  const value = await select.locator("option").evaluateAll(
    (options, wanted) => options.find((option) => option.textContent?.startsWith(wanted))?.value,
    prefix,
  );
  if (!value) throw new Error(`No option starts with ${prefix}.`);
  await select.selectOption(value);
}

async function desktop(width, height) {
  const { context, page } = await authenticatedPage({ width, height });
  await page.goto(`${baseURL}/inventory/units`);
  await page.getByRole("heading", { name: "Units", exact: true }).waitFor();
  await page.getByText("BAG", { exact: true }).first().waitFor();
  await assertNoOverflow(page, `${width}x${height} Units`);
  await page.screenshot({ path: path.join(outputDir, `units-desktop-${width}x${height}.png`), fullPage: true });

  await page.goto(`${baseURL}/products/new`);
  await page.getByLabel("Primary Unit *").selectOption({ label: "BOX — Boxes" });
  await page.getByLabel("Secondary Unit").selectOption({ label: "PCS — Pieces" });
  await page.locator(".uom-conversion-field input").fill("10");
  await assertNoOverflow(page, `${width}x${height} Product`);
  await page.screenshot({ path: path.join(outputDir, `product-uom-desktop-${width}x${height}.png`), fullPage: true });

  await page.goto(`${baseURL}/sales/invoices/new`);
  await selectPrefix(page.locator(".inventory-document-line select").nth(0), "QA UOM Cabinet Hinge");
  await page.waitForFunction(() => {
    const selects = document.querySelectorAll(".inventory-document-line select");
    return selects[1] && !selects[1].disabled && selects[1].querySelectorAll("option").length > 1;
  });
  await page.locator(".inventory-document-line select").nth(1).selectOption({ label: "PCS" });
  if ((await page.locator(".inventory-document-line input[type=number]").nth(1).inputValue()) !== "10") throw new Error("Sales rate did not convert to PCS.");

  await page.goto(`${baseURL}/purchases/bills/new`);
  await page.waitForFunction(() => document.querySelectorAll(".inventory-document-line select").length >= 5);
  const account = page.locator(".inventory-document-line select").nth(3);
  if ((await account.inputValue()) !== "") throw new Error("Purchase account must begin at Select account.");
  await selectPrefix(page.locator(".inventory-document-line select").nth(0), "QA UOM White Cement");
  if ((await account.inputValue()) !== "") throw new Error("Product selection unexpectedly mapped an account.");
  await context.close();
}

async function mobile(width, height) {
  const { context, page } = await authenticatedPage({ width, height });
  await page.goto(`${baseURL}/inventory/units`);
  await page.getByRole("heading", { name: "Units", exact: true }).waitFor();
  await assertNoOverflow(page, `${width}x${height} Units`);
  await page.screenshot({ path: path.join(outputDir, `units-mobile-${width}x${height}.png`), fullPage: true });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("navigation", { name: "Mobile navigation" }).waitFor();
  await page.getByAltText("FYNTA").waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outputDir, `sidebar-mobile-${width}x${height}.png`) });
  await context.close();
}

try {
  await desktop(1366, 768);
  await desktop(1440, 900);
  await mobile(390, 844);
  await mobile(430, 932);
  console.log(`Authenticated browser QA passed. Screenshots: ${outputDir}`);
} finally {
  await browser.close();
}
