// Capture before/after screenshots of the storefront and admin.
// Usage: node scripts/screenshots.mjs <label>   e.g. node scripts/screenshots.mjs before
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const label = process.argv[2] ?? "capture";
const outRoot = path.resolve("artifacts", "screenshots", label);

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
];

const STOREFRONT_ROUTES = [
  ["home", "/"],
  ["products", "/products"],
  ["search", "/search?q=mojri"],
  ["cart", "/cart"],
  ["login", "/login"],
  ["about", "/about"],
];

const ADMIN_ROUTES = [
  ["dashboard", "/"],
  ["products", "/catalog/products"],
  ["categories", "/catalog/categories"],
  ["homepage", "/homepage"],
  ["orders", "/orders"],
  ["customers", "/customers"],
];

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  // Give font swaps + entrance animations time to finish.
  await page.waitForTimeout(1200);
  await page
    .evaluate(async () => {
      await document.fonts?.ready;
      window.scrollTo(0, document.body.scrollHeight);
    })
    .catch(() => {});
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(500);
}

async function shoot(browser, baseUrl, routes, prefix) {
  const results = [];
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 300)}`));

    for (const [name, route] of routes) {
      const url = `${baseUrl}${route}`;
      const file = path.join(outRoot, `${prefix}-${name}-${viewport.name}.png`);
      try {
        const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await settle(page);
        await page.screenshot({ path: file, fullPage: true });
        results.push({ prefix, name, viewport: viewport.name, url, status: res?.status() ?? null, file });
      } catch (error) {
        results.push({ prefix, name, viewport: viewport.name, url, error: String(error).slice(0, 400) });
      }
    }
    if (consoleErrors.length) {
      results.push({ prefix, viewport: viewport.name, consoleErrors: [...new Set(consoleErrors)].slice(0, 12) });
    }
    await context.close();
  }
  return results;
}

await mkdir(outRoot, { recursive: true });
const browser = await chromium.launch();
const results = [];
results.push(...(await shoot(browser, "http://localhost:3000", STOREFRONT_ROUTES, "storefront")));
results.push(...(await shoot(browser, "http://localhost:3001", ADMIN_ROUTES, "admin")));
await browser.close();
await writeFile(path.join(outRoot, "manifest.json"), JSON.stringify(results, null, 2), "utf8");
console.log(JSON.stringify(results, null, 2));
