#!/usr/bin/env node
/**
 * Production smoke: scan image storage + history thumbnails/detail images.
 *
 * Auth (pick one):
 *   SMOKE_ACCESS_TOKEN=<jwt>
 *   SMOKE_EMAIL + SMOKE_PASSWORD
 *
 * Optional (storage/path DB verification):
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * Target:
 *   PRODUCTION_URL (default https://gemgrade-ai.vercel.app)
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import { fetchProductionSupabasePublicConfig } from "./productionPublicConfig.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const baseUrl = process.env.PRODUCTION_URL?.trim() || "https://gemgrade-ai.vercel.app";

const frontPath = path.join(ROOT, "benchmarks/TEST 4/1989 F BIRD PSA 4  FRONT.jpg");
const backPath = path.join(ROOT, "benchmarks/TEST 4/1989 F BIRD PSA 4 BACK.jpg");

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

function toDataUrl(filePath) {
  return `data:image/jpeg;base64,${fs.readFileSync(filePath).toString("base64")}`;
}

async function apiFetch(route, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.arrayBuffer();
  return { status: response.status, contentType, payload, response };
}

async function resolveAccessToken(supabaseUrl, anonKey) {
  if (process.env.SMOKE_ACCESS_TOKEN?.trim()) {
    return process.env.SMOKE_ACCESS_TOKEN.trim();
  }

  const email = process.env.SMOKE_EMAIL?.trim();
  const password = process.env.SMOKE_PASSWORD?.trim();
  assert(email && password, "Set SMOKE_ACCESS_TOKEN or SMOKE_EMAIL + SMOKE_PASSWORD");

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  assert(!error, `Login failed: ${error?.message}`);
  assert(data.session?.access_token, "Missing access token after signInWithPassword");
  return data.session.access_token;
}

function getServiceRoleClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function verifyStoragePaths(scanId, userId) {
  const supabase = getServiceRoleClient();
  if (!supabase) {
    console.log("  (skip DB/storage checks — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
    return;
  }

  const { data: row, error } = await supabase
    .from("scans")
    .select("id, front_image_path, back_image_path")
    .eq("id", scanId)
    .maybeSingle();

  assert(!error, `DB read failed: ${error?.message}`);
  assert(row, `Scan ${scanId} not found in DB`);
  assert(
    typeof row.front_image_path === "string" && row.front_image_path.trim(),
    `front_image_path missing for scan ${scanId}`,
  );
  assert(
    typeof row.back_image_path === "string" && row.back_image_path.trim(),
    `back_image_path missing for scan ${scanId}`,
  );
  pass("DB paths written", `front=${row.front_image_path}`);

  for (const [label, objectPath] of [
    ["front", row.front_image_path],
    ["back", row.back_image_path],
  ]) {
    const { data, error: downloadError } = await supabase.storage
      .from("scan-images")
      .download(objectPath);
    assert(!downloadError && data, `${label} object missing in scan-images bucket: ${objectPath}`);
    assert(data.size > 0, `${label} object is empty`);
    pass(`${label} image in scan-images bucket`, `${objectPath} (${data.size} bytes)`);
  }

  if (userId) {
    assert(
      row.front_image_path.startsWith(`${userId}/`),
      `front path should be namespaced by user id`,
    );
  }
}

async function verifyImageApi(token, scanId, side) {
  const { status, contentType, payload } = await apiFetch(
    `/api/scans/${scanId}/image?side=${side}`,
    { token },
  );
  assert(status === 200, `${side} image API returned ${status}`);
  assert(
    contentType.startsWith("image/"),
    `${side} image API content-type expected image/*, got ${contentType}`,
  );
  assert(payload.byteLength > 100, `${side} image payload too small`);
  pass(`${side} image API`, `${payload.byteLength} bytes`);
}

async function verifyBrowserUi(token, scans) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript((jwt) => {
    window.__smokeToken = jwt;
  }, token);

  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle", timeout: 120000 });

  if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) {
    await page.fill('input[type="email"]', process.env.SMOKE_EMAIL);
    await page.fill('input[type="password"]', process.env.SMOKE_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 60000 });
  } else {
    fail("Browser UI checks need SMOKE_EMAIL + SMOKE_PASSWORD for cookie session");
  }

  const withImage = scans.find((scan) => scan.hasFrontImage === true) ?? scans[0];
  const withoutImage =
    scans.find(
      (scan) => scan.hasFrontImage === false && scan.hasBackImage === false,
    ) ?? scans.find((scan) => scan.hasFrontImage === false);

  await page.goto(`${baseUrl}/history`, { waitUntil: "networkidle", timeout: 120000 });
  await page.locator(".scan-history__table").waitFor({ timeout: 30000 });
  const thumbCount = await page.locator(".scan-history__thumb").count();
  assert(thumbCount > 0, "History list should render thumbnail slots");
  pass("History list thumbnails render", `${thumbCount} slots`);

  const loadedThumb = await page.locator("img.scan-history__thumb--list").count();
  if (withImage?.hasFrontImage) {
    assert(loadedThumb > 0, "Expected at least one loaded front thumbnail image");
    pass("History list shows loaded front thumbnail");
  }

  await page.goto(`${baseUrl}/history/${withImage.id}`, {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  await page.locator(".scan-history-detail__images").waitFor({ timeout: 30000 });
  const detailImages = await page.locator(".scan-history-detail__images img").count();
  assert(detailImages >= 1, "Detail page should show at least front image");
  pass("Detail page front/back section", `${detailImages} loaded image(s)`);

  if (withoutImage) {
    const missingFront = await apiFetch(
      `/api/scans/${withoutImage.id}/image?side=front`,
      { token },
    );
    assert(missingFront.status === 404, "Old scan without image should 404 image API");
    await page.goto(`${baseUrl}/history/${withoutImage.id}`, {
      waitUntil: "networkidle",
      timeout: 120000,
    });
    await page.locator(".scan-history-detail__images").waitFor({ timeout: 30000 });
    const placeholders = await page
      .locator(".scan-history-detail__images .scan-history__thumb--placeholder")
      .count();
    assert(placeholders >= 1, "Old scan should show image placeholder(s)");
    const detailError = await page
      .locator(".scan-history__error")
      .isVisible()
      .catch(() => false);
    assert(!detailError, "Old scan detail should not error");
    pass("Old scan without images shows placeholders", `id ${withoutImage.id}`);
  } else {
    console.log("  (skip old-scan placeholder check — no imageless scan in history)");
  }

  const crashErrors = consoleErrors.filter(
    (message) => !message.includes("404") && !message.includes("Failed to load resource"),
  );
  assert(crashErrors.length === 0, `Client errors: ${crashErrors.join(" | ")}`);
  pass("No client-side exceptions on history pages");

  await browser.close();
}

async function main() {
  const { supabaseUrl, anonKey } = await fetchProductionSupabasePublicConfig();
  const token = await resolveAccessToken(supabaseUrl, anonKey);
  pass("Authenticated", baseUrl);

  const balance = await apiFetch("/api/credits/balance", { token });
  assert(balance.status === 200, `Balance check failed: ${balance.status}`);
  assert(balance.payload.balance >= 3, `Need >= 3 credits, have ${balance.payload.balance}`);
  pass("Credits available", `${balance.payload.balance}`);

  const historyBefore = await apiFetch("/api/scans", { token });
  assert(historyBefore.status === 200, `History failed: ${historyBefore.status}`);
  const beforeCount = historyBefore.payload.scans?.length ?? 0;

  const frontImage = toDataUrl(frontPath);
  const backImage = toDataUrl(backPath);

  console.log("Running Scout scan (~30s)...");
  const scout = await apiFetch("/api/grade", {
    method: "POST",
    token,
    body: { frontImage, era: "auto", mode: "scout" },
  });
  assert(scout.status === 200, `Scout failed (${scout.status}): ${JSON.stringify(scout.payload)}`);
  pass("Scout scan completes");

  console.log("Running Pro scan (~30s)...");
  const pro = await apiFetch("/api/grade", {
    method: "POST",
    token,
    body: { frontImage, backImage, era: "auto", mode: "pro" },
  });
  assert(pro.status === 200, `Pro failed (${pro.status}): ${JSON.stringify(pro.payload)}`);
  pass("Pro scan completes");

  const historyAfter = await apiFetch("/api/scans", { token });
  assert(historyAfter.status === 200, `History failed: ${historyAfter.status}`);
  const scans = historyAfter.payload.scans ?? [];
  assert(scans.length >= beforeCount + 2, "Expected new Scout and Pro rows in history");
  pass("History saved new scans", `${scans.length} total`);

  const latestPro = scans.find((scan) => scan.mode === "pro") ?? scans[0];
  const latestScout = scans.find((scan) => scan.mode === "scout") ?? scans[1];

  assert(latestPro?.id, "Missing latest Pro scan id");
  assert(latestScout?.id, "Missing latest Scout scan id");

  if (latestPro.hasFrontImage === false) {
    fail("Latest Pro scan reports hasFrontImage=false — image paths not persisted");
  }
  pass("History API reports front image", `pro id ${latestPro.id}`);

  const { data: userData } = await createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth.getUser(token);
  const userId = userData.user?.id ?? null;

  await verifyStoragePaths(latestPro.id, userId);
  await verifyImageApi(token, latestPro.id, "front");
  await verifyImageApi(token, latestPro.id, "back");
  await verifyImageApi(token, latestScout.id, "front");

  const thumbLegacy = await apiFetch(`/api/scans/${latestPro.id}/thumbnail`, { token });
  assert(thumbLegacy.status === 200, `Legacy thumbnail route failed: ${thumbLegacy.status}`);
  pass("Legacy /thumbnail route works");

  await verifyBrowserUi(token, scans);

  console.log("\nAll scan image production checks passed.");
}

main().catch((error) => {
  console.error("\n✗ Scan image smoke failed:", error.message);
  process.exit(1);
});
