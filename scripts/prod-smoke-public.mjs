#!/usr/bin/env node
/**
 * Production smoke checks that do not require authenticated Supabase session.
 */
import { fetchProductionSupabasePublicConfig } from "./productionPublicConfig.mjs";

const PRODUCTION_URL = "https://gemgrade-ai.vercel.app";

function pass(label, detail = "") {
  console.log(`✓ ${label}${detail ? `: ${detail}` : ""}`);
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function apiFetch(route, options = {}) {
  const response = await fetch(`${PRODUCTION_URL}${route}`, options);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return { status: response.status, payload };
}

const publicConfig = await fetchProductionSupabasePublicConfig();
pass("Production Supabase public config present", publicConfig.supabaseUrl);

const loginPage = await fetch(`${PRODUCTION_URL}/login`);
if (loginPage.status !== 200) fail(`Login page status ${loginPage.status}`);
const loginHtml = await loginPage.text();
if (!loginHtml.includes("Send login code")) fail("Login form missing");
pass("Login page loads");

const home = await fetch(PRODUCTION_URL);
if (home.status !== 200) fail(`Homepage status ${home.status}`);
const html = await home.text();
if (!html.includes('accept="image/*"')) fail("Missing mobile upload accept");
if (!html.includes("GemGrade")) fail("Missing GemGrade branding");
if (!html.includes("Scout")) fail("Missing Scout mode");
if (!html.includes("Pro")) fail("Missing Pro mode");
pass("Mobile upload + GemGrade UI on homepage");

const balance = await apiFetch("/api/credits/balance");
if (balance.status !== 401) fail(`Expected 401 on balance, got ${balance.status}`);
pass("Credit balance API requires auth");

const grade = await apiFetch("/api/grade", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ frontImage: "data:image/jpeg;base64,abc", mode: "scout" }),
});
if (grade.status !== 401) fail(`Expected 401 on grade, got ${grade.status}`);
pass("Grade API requires auth");

const history = await apiFetch("/api/scans");
if (history.status !== 401) fail(`Expected 401 on scans, got ${history.status}`);
pass("Scan history API requires auth");

const creditsPage = await fetch(`${PRODUCTION_URL}/credits`);
if (creditsPage.status !== 200) fail(`Credits page status ${creditsPage.status}`);
pass("Credits page loads");

const historyPage = await fetch(`${PRODUCTION_URL}/history`);
if (historyPage.status !== 200) fail(`History page status ${historyPage.status}`);
pass("History page loads");

console.log("\nPublic production smoke checks passed.");
console.log(
  "Note: Authenticated Scout/Pro scan + credit deduction checks require a Supabase session.",
);
console.log(
  "Run authenticated checks: node scripts/prod-smoke-authenticated.mjs",
);
