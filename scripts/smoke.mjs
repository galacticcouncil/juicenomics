// headless check of a running build: renders, share links round-trip, tabs work, no console errors
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const ORIGIN = process.env.SIM_URL ?? "http://localhost:4173/";
const OUT = new URL("../screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER ?? "/usr/bin/brave" });
const results = [];
const check = (ok, msg) => { results.push(`${ok ? "ok  " : "FAIL"} ${msg}`); console.log(results.at(-1)); };

async function open(url, scheme = "light") {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: scheme });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".tile .value", { timeout: 20000 });
  return { page, errors };
}

const { page, errors } = await open(ORIGIN);
const tiles = await page.$$eval(".tile", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
check(tiles.length >= 8 && tiles.some((t) => /jBTC net APR −?\d/i.test(t)), `overview tiles render (${tiles.length})`);
await page.screenshot({ path: `${OUT}overview-light.png`, fullPage: true });

// load a preset, let the url settle, reopen the link in a fresh page
await page.selectOption("header select", "disc100");
await page.waitForTimeout(800);
const url = page.url();
check(/#s=1[zj]/.test(url), `config lands in the url (${url.length} chars)`);
const before = await page.$eval(".tiles", (e) => e.innerText);
const again = await open(url);
const after = await again.page.$eval(".tiles", (e) => e.innerText);
check(before === after, "share link restores the same results");

for (const tab of ["Simulation", "Explore & optimize", "Compare A / B", "Model & assumptions"]) {
  await again.page.click(`nav.tabs button:has-text("${tab}")`);
  await again.page.waitForTimeout(600);
  await again.page.screenshot({ path: `${OUT}${tab.split(" ")[0].toLowerCase()}-light.png`, fullPage: true });
}
const dark = await open(ORIGIN, "dark");
await dark.page.screenshot({ path: `${OUT}overview-dark.png`, fullPage: true });
const wasm = await page.evaluate(async () => {
  const r = await fetch(new URL("./", location.href));
  return r.ok;
});
check(wasm, "index served");
const allErrors = [...errors, ...again.errors, ...dark.errors];
check(allErrors.length === 0, `no console errors${allErrors.length ? `: ${allErrors.slice(0, 3).join(" | ")}` : ""}`);
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
