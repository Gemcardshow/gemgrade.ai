# GemGrade Benchmark Calibration

Repeatable PSA slab comparison set for tuning GemGrade projections.

## Layout

```
benchmarks/
  manifest.json          # Generated card index (commit this)
  psa-1-3/               # Suite: poor-band PSA 1–3 cards
    1967-mantle-psa1/
      front.jpg
      back.jpg
  reports/               # Run output (gitignored)
  lib/                   # Scan + pattern helpers
  scan-manifest.js
  run-benchmark.js
```

Folder names must end with `-psa{N}` (e.g. `1967-mantle-psa1`). Each card folder needs `front.jpg` and `back.jpg`.

## Commands

From the repo root:

```bash
# Regenerate manifest.json after adding cards
npm run benchmark:scan

# Install dependencies first (repo root or api/)
npm install

# Run full benchmark (requires OPENAI_API_KEY in .env)
npm run benchmark:run

# Rebuild report from last cached vision results (no API calls)
node benchmarks/run-benchmark.js --from-cache

# Filter a suite or single card
node benchmarks/run-benchmark.js --suite psa-1-3
node benchmarks/run-benchmark.js --card 1967-mantle-psa1
```

Reports are written to `benchmarks/reports/latest.json` and `latest.md`.

## Interpreting results

| Column | Meaning |
| --- | --- |
| PSA | Known slab grade from folder name |
| GemGrade | Projected PSA from the grading engine |
| Diff | GemGrade − PSA (positive = inflation) |

Pattern flags (heuristic) highlight recurring calibration gaps: low-grade inflation, weak crease penalties, surface over-scoring, rounded-corner under-penalties, and centering inconsistencies.
