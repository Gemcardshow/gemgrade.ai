#!/usr/bin/env node
/**
 * Regenerate benchmarks/manifest.json from folder layout.
 * Usage: node benchmarks/scan-manifest.js
 */
import fs from "node:fs";
import { scanBenchmarkSuites } from "./lib/scan.js";
import { resolveBenchmarkPath } from "./lib/paths.js";

const manifest = scanBenchmarkSuites();
const outPath = resolveBenchmarkPath("manifest.json");

fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const cardCount = manifest.suites.reduce((sum, suite) => sum + suite.cardCount, 0);
console.log(`Wrote ${outPath}`);
console.log(`Suites: ${manifest.suites.length}, Cards: ${cardCount}`);
for (const suite of manifest.suites) {
  console.log(`  - ${suite.id}: ${suite.cardCount} cards`);
}
