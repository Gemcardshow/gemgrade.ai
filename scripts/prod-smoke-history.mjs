#!/usr/bin/env node
/**
 * Production smoke: /history list, metadata columns, VIEW for Scout/Pro, mobile viewport.
 * Uses existing Edge session. Close Edge before running.
 */
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const PRODUCTION_URL = "https://gemgrade-ai.vercel.app";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const frontPath = path.join(ROOT, "benchmarks/TEST 4/1989 F BIRD PSA 4  FRONT.jpg");
const backPath = path.join(ROOT, "benchmarks/TEST 4/1989 F BIRD PSA 4 BACK.jpg");

const userDataDir = path.join(
  os.homedir(),
  "AppData",
  "Local",
  "Microsoft",
  "Edge",
  "User Data",
);

function pass(label, detail = "") {
  console.log(`✓ ${label}${detail ? `: ${detail}` : ""}`);
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const consoleErrors = [];

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "msedge",
  headless: true,
  args: ["--profile-directory=Default"],
});

const page = await context.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

await page.goto(PRODUCTION_URL, { waitUntil: "networkidle", timeout: 120000 });

const signedInNotice = page.locator(".grade-scanner__notice");
if (await signedInNotice.isVisible().catch(() => false)) {
  fail("Not signed in — log in in Edge first");
}
pass("Logged in");

const beforeCount = await page.evaluate(async () => {
  const res = await fetch("/api/scans", { credentials: "include" });
  const body = await res.json();
  return Array.isArray(body.scans) ? body.scans.length : 0;
});

await page.locator('label.scan-mode-selector__option:has(input[value="scout"])').click();
await page.locator('input[name="frontImage"]').setInputFiles(frontPath);
await page.locator('button[type="submit"]').click();
await page.locator(".grade-result--scout").waitFor({ timeout: 180000 });
pass("Scout scan completes");

await page.locator('label.scan-mode-selector__option:has(input[value="pro"])').click();
await page.locator('input[name="frontImage"]').setInputFiles(frontPath);
await page.locator('input[name="backImage"]').setInputFiles(backPath);
await page.locator('button[type="submit"]').click();
await page.locator(".grade-result--pro").waitFor({ timeout: 180000 });
pass("Pro scan completes");

const historyAfter = await page.evaluate(async () => {
  const res = await fetch("/api/scans", { credentials: "include" });
  const body = await res.json();
  return body.scans ?? [];
});

if (historyAfter.length < beforeCount + 2) {
  fail(
    `Expected at least ${beforeCount + 2} scans after Scout+Pro, got ${historyAfter.length}`,
  );
}
pass("Scout and Pro saved to history", `${historyAfter.length} total`);

const latestScout =
  historyAfter.find((scan) => scan.mode === "scout" || scan.creditsUsed === 1) ??
  historyAfter[1];
const latestPro =
  historyAfter.find((scan) => scan.mode === "pro" || scan.creditsUsed === 2) ??
  historyAfter[0];

if (!latestScout) {
  fail("No Scout scan found in history API");
}
if (!latestPro) {
  fail("No Pro scan found in history API");
}

pass(
  "History metadata on latest Scout",
  `confidence=${latestScout.confidence ?? "—"}, credits=${latestScout.creditsUsed ?? "—"}, era=${latestScout.era ?? "—"}`,
);
pass(
  "History metadata on latest Pro",
  `confidence=${latestPro.confidence ?? "—"}, credits=${latestPro.creditsUsed ?? "—"}, era=${latestPro.era ?? "—"}`,
);

async function verifyView(scan, label) {
  await page.goto(`${PRODUCTION_URL}/history/${scan.id}`, {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  await page.locator(".grade-result").first().waitFor({ timeout: 30000 });
  const hasError = await page
    .locator(".scan-history__error")
    .isVisible()
    .catch(() => false);
  if (hasError) {
    fail(`${label} VIEW showed error state`);
  }
  pass(`${label} VIEW works`, `id ${scan.id}`);
}

await verifyView(latestScout, "Scout");
await verifyView(latestPro, "Pro");

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${PRODUCTION_URL}/history`, { waitUntil: "networkidle" });
await page.locator(".scan-history__table").waitFor({ timeout: 30000 });
pass("Mobile /history table renders");

await page.locator('a.scan-history__link').first().click();
await page.waitForURL("**/history/**", { timeout: 30000 });
await page.locator(".grade-result").first().waitFor({ timeout: 30000 });
pass("Mobile VIEW opens detail without crash");

const crashErrors = consoleErrors.filter(
  (message) =>
    !message.includes("404") &&
    !message.includes("Failed to load resource"),
);
if (crashErrors.length) {
  fail(`Client errors: ${crashErrors.join(" | ")}`);
}
pass("No client-side exceptions");

await context.close();
console.log("\nAll history production checks passed.");
