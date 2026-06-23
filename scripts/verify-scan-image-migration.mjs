#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!value.trim()) {
      continue;
    }
    if (!process.env[key]?.trim()) {
      process.env[key] = value;
    }
  }
}

for (const file of [".env", ".env.production.local", ".env.vercel.production"]) {
  loadEnvFile(path.join(ROOT, file));
}

function pass(label, detail = "") {
  console.log(`✓ ${label}${detail ? `: ${detail}` : ""}`);
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const url =
  process.env.SUPABASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  fail("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env");
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { error: columnError } = await supabase
  .from("scans")
  .select("id, front_image_path, back_image_path")
  .limit(1);

if (columnError) {
  fail(`Migration columns missing or unreadable: ${columnError.message}`);
}
pass("scans.front_image_path and scans.back_image_path exist");

const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
if (bucketError) {
  fail(`Storage bucket list failed: ${bucketError.message}`);
}
const scanBucket = buckets?.find((bucket) => bucket.id === "scan-images");
if (!scanBucket) {
  fail("scan-images bucket not found");
}
pass("scan-images bucket exists", scanBucket.public ? "public" : "private");

const { data: recentWithPaths, error: recentError } = await supabase
  .from("scans")
  .select("id, front_image_path, back_image_path, created_at")
  .not("front_image_path", "is", null)
  .order("created_at", { ascending: false })
  .limit(1);

if (recentError) {
  fail(`Could not query scans with paths: ${recentError.message}`);
}

if (!recentWithPaths?.length) {
  console.log("  (no scans with front_image_path yet — expected until post-deploy grades)");
} else {
  const row = recentWithPaths[0];
  pass("Latest scan with image paths", `id ${row.id}`);
  for (const [label, objectPath] of [
    ["front", row.front_image_path],
    ["back", row.back_image_path],
  ]) {
    if (!objectPath) {
      console.log(`  (${label} path null — ok for scout-only rows)`);
      continue;
    }
    const { data, error } = await supabase.storage.from("scan-images").download(objectPath);
    if (error || !data) {
      fail(`${label} object missing at ${objectPath}: ${error?.message ?? "empty"}`);
    }
    pass(`${label} object in bucket`, `${objectPath} (${data.size} bytes)`);
  }
}

const { data: legacyRows, error: legacyError } = await supabase
  .from("scans")
  .select("id, front_image_path, front_image")
  .is("front_image_path", null)
  .order("created_at", { ascending: false })
  .limit(1);

if (legacyError) {
  fail(`Could not query legacy scans: ${legacyError.message}`);
}
if (legacyRows?.length) {
  pass("Legacy scan without storage path still readable", `id ${legacyRows[0].id}`);
}

console.log("\nStorage migration verification passed.");
