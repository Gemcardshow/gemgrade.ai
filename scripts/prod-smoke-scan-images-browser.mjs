#!/usr/bin/env node
/**
 * Post-deploy smoke: Scout + Pro scans, image storage, history thumbnails, VIEW images.
 * Uses existing Edge session. Close all Edge windows before running.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const PRODUCTION_URL = process.env.PRODUCTION_URL?.trim() || "https://gemgrade-ai.vercel.app";
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

function assert(condition, message) {
  if (!condition) fail(message);
}

const consoleErrors = [];

let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "msedge",
    headless: true,
    args: ["--profile-directory=Default"],
  });
} catch (error) {
  fail(
    `Could not open Edge profile. Close all Edge windows and retry: ${
      error instanceof Error ? error.message : error
    }`,
  );
}

const page = await context.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

await page.goto(PRODUCTION_URL, { waitUntil: "networkidle", timeout: 120000 });

if (await page.locator(".grade-scanner__notice").isVisible().catch(() => false)) {
  fail("Not signed in — log in at gemgrade-ai.vercel.app in Edge first");
}
pass("Logged in", PRODUCTION_URL);

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

  assert(historyAfter.length >= beforeCount + 1, `Expected new scans in history (before=${beforeCount}, after=${historyAfter.length})`);
const latestPro = historyAfter.find((scan) => scan.mode === "pro") ?? historyAfter[0];
const latestScout = historyAfter.find((scan) => scan.mode === "scout") ?? historyAfter[1];
assert(latestPro?.id, "Missing Pro scan");
assert(latestScout?.id, "Missing Scout scan");
pass("History saved new scans", `${historyAfter.length} total`);

const imageChecks = await page.evaluate(async ({ proId, scoutId }) => {
  async function check(side, id) {
    const res = await fetch(`/api/scans/${id}/image?side=${side}`, {
      credentials: "include",
    });
    const contentType = res.headers.get("content-type") || "";
    const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
    return { status: res.status, contentType, bytes };
  }

  return {
    proFront: await check("front", proId),
    proBack: await check("back", proId),
    scoutFront: await check("front", scoutId),
    thumb: await fetch(`/api/scans/${proId}/thumbnail`, { credentials: "include" }).then(
      async (res) => ({
        status: res.status,
        contentType: res.headers.get("content-type") || "",
        bytes: res.ok ? (await res.arrayBuffer()).byteLength : 0,
      }),
    ),
  };
}, { proId: latestPro.id, scoutId: latestScout.id });

for (const [label, result] of Object.entries(imageChecks)) {
  assert(result.status === 200, `${label} API returned ${result.status}`);
  assert(result.contentType.startsWith("image/"), `${label} not image/*`);
  assert(result.bytes > 100, `${label} payload too small`);
  pass(`${label} image API`, `${result.bytes} bytes`);
}

const withoutImage =
  historyAfter.find((scan) => scan.hasFrontImage === false) ??
  historyAfter.find((scan) => scan.id !== latestPro.id && scan.id !== latestScout.id);

if (withoutImage) {
  const legacy = await page.evaluate(async (id) => {
    const res = await fetch(`/api/scans/${id}/image?side=front`, { credentials: "include" });
    return res.status;
  }, withoutImage.id);
  assert(legacy === 404, `Expected 404 for imageless scan, got ${legacy}`);
  pass("Imageless scan returns 404 on image API", `id ${withoutImage.id}`);
}

await page.goto(`${PRODUCTION_URL}/history`, { waitUntil: "networkidle", timeout: 120000 });
await page.locator(".scan-history__table").waitFor({ timeout: 30000 });
const thumbSlots = await page.locator(".scan-history__thumb").count();
assert(thumbSlots > 0, "History list should render thumbnail slots");
const loadedThumbs = await page.locator("img.scan-history__thumb--list").count();
assert(loadedThumbs > 0, "History list should show at least one loaded thumbnail");
pass("History list thumbnails", `${loadedThumbs} loaded / ${thumbSlots} slots`);

await page.goto(`${PRODUCTION_URL}/history/${latestPro.id}`, {
  waitUntil: "networkidle",
  timeout: 120000,
});
await page.locator(".scan-history-detail__images").waitFor({ timeout: 30000 });
const detailImages = await page.locator(".scan-history-detail__images img").count();
assert(detailImages >= 1, "Detail VIEW should load at least front image");
pass("VIEW detail images", `${detailImages} loaded`);

if (withoutImage) {
  await page.goto(`${PRODUCTION_URL}/history/${withoutImage.id}`, {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  await page.locator(".scan-history-detail__images").waitFor({ timeout: 30000 });
  const placeholders = await page
    .locator(".scan-history-detail__images .scan-history__thumb--placeholder")
    .count();
  assert(placeholders >= 1, "Old scan should show placeholder(s)");
  const hasError = await page.locator(".scan-history__error").isVisible().catch(() => false);
  assert(!hasError, "Old scan detail should not error");
  pass("Old scan VIEW safe", `id ${withoutImage.id}`);
}

const crashErrors = consoleErrors.filter(
  (message) =>
    !message.includes("404") &&
    !message.includes("Failed to load resource"),
);
assert(crashErrors.length === 0, `Client errors: ${crashErrors.join(" | ")}`);
pass("No client-side exceptions");

await context.close();
console.log("\nAll post-deploy scan image checks passed.");
