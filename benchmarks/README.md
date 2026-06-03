# GemGrade Benchmark Calibration

Repeatable PSA slab comparison set for tuning GemGrade projections.

## Layout

```
benchmarks/
  manifest.json          # Generated card index (commit this)
  psa-1-3/               # Suite: poor-band PSA 1–3 cards
  TEST 4 TO 6/           # Suite: PSA 4–6 (flat filename layout)
  psa7-8/                # Suite: PSA 7–8 (near mint) — see suite README
  psa9/                  # Suite: PSA 9 (mint)
  psa10/                 # Suite: PSA 10 (gem mint)
  reports/               # Run output (gitignored)
  lib/                   # Scan + pattern helpers
  scan-manifest.js
  run-benchmark.js
```

Folder names must end with `-psa{N}` (e.g. `1967-mantle-psa1`). Each card folder needs `front.jpg` and `back.jpg`.

For **PSA 7–10** suites (`psa7-8/`, `psa9/`, `psa10/`), see each suite's `README.md` and `manifest.template.json` for card metadata (`set`, `notes`, cert #). Optional per-card metadata lives in `card.meta.json`.

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
