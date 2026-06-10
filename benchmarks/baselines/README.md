# Grading baselines

Frozen benchmark references for regression comparison. Do not overwrite without a new tag.

## Current baseline: `recovery-gating-baseline-v1`

**Git tag:** `recovery-gating-baseline-v1`

**Primary path:** Recovery gating in `api/grading/analyze.js` (NM/GEM pillar recovery + gem-mint vs mint slab profiles).

**Analyze snapshot:** `benchmarks/snapshots/analyze-recovery-baseline.js`

**Metrics file:** `benchmarks/baselines/recovery-gating-v1.json`

| Suite | Source | Cards | Mean error | Within ±1 | Exact | Over-slabs |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| PSA 4–6 | cache replay | 15 | −0.67 | 10/15 | 6/15 | 2/15 |
| PSA 7–10 | live vision snapshots | 78 | −2.73 | 22/78 | 7/78 | 2/78 |

PSA 9+ and PSA 10 bands are tracked in the JSON for PSA 9/10 validation work.

### Regenerate metrics (same logic, new run)

Requires `benchmarks/cache/` (PSA 4–6) and `benchmarks/live-runs/vision-snapshots/` (PSA 7–10):

```bash
node benchmarks/build-recovery-gating-baseline.js
```

### Compare future changes

Replay grades through current `analyze.js` and diff against `recovery-gating-v1.json` before merging further PSA 9/10 tuning.
