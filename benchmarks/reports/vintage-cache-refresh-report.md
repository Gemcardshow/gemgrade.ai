# Vintage Benchmark Cache Refresh — Phase 2A Report

**Generated:** 2026-06-14T03:10:27.844Z
**Branch:** phase2/vintage-research
**Vintage freeze:** `fb4cf93` | **Modern freeze:** `15a078c`
**Dry run:** no

## Summary

Phase 2A refreshes stale `benchmarks/cache/` vision inputs from `live-runs/vision-snapshots/` where they disagree. **No grading logic was modified.**

### Before / After (cache-first replay @ current engine)

| Metric | Before (stale cache) | After (refreshed cache) | Δ |
|--------|---------------------:|------------------------:|--:|
| Within ±1 | 33/72 (45.8%) | **40/72 (55.6%)** | **+7** |
| Exact match | 14 | 18 | +4 |
| Mean error (Gem − PSA) | -1.61 | -1.13 | 0.49 |
| Mean \|error\| | 2.14 | 1.74 | -0.40 |
| Scratch gremlins | 11 | **7** | -4 |
| `moderate_crease` tag count | 6 | 5 | -1 |
| Crease-related gremlins | 4 | 3 | -1 |
| Triad cap (`vintage:triad_light_wear_notes`) | 3 | 2 | -1 |
| Pillar-clamp gremlins | 28 | 19 | -9 |
| categoryFloor ≤ 5.5 | 38 | 28 | -10 |

### Drift inventory

| | Count |
|--|------:|
| Vintage manifest cards | 73 |
| Cache + snapshot comparable | 29 |
| Disagree (refresh candidates) | **28** |
| Refreshed this run | **28** |
| Priority cards refreshed | 9/9 |

## Priority drift cards

| Card | PSA | Cache Gem | Snap Gem | Δ | Cache limiter | Snap limiter | Refreshed |
|------|----:|----------:|---------:|--:|---------------|--------------|:---------:|
| 1974 T PARKER | 7 | 5 | 7 | -2 | surface_scratch_light | staining_light | ✓ |
| 1983 T BOGGS | 7 | 5 | 7 | -2 | surface_scratch_light | corner_wear_light | ✓ |
| 1953 T KENNEDY | 8 | 3 | 6 | -3 | surface_scratch_light | — | ✓ |
| 1960 T SPAHN | 8 | 3 | 7 | -4 | moderate_crease | corner_wear_light | ✓ |
| 1975 T LUZINSKI | 8 | 5 | 7 | -2 | surface_scratch_light | corner_wear_light | ✓ |
| T206 YOUNG | 8 | 3 | 5 | -2 | moderate_crease | — | ✓ |
| 1976 T YOUNT | 9 | 5 | 3 | 2 | moderate_crease | surface_scratch_light | ✓ |
| 1978 T ECKERSLEY | 9 | 5 | 7 | -2 | surface_scratch_light | surface_scratch_light | ✓ |
| 1983 T SEAVER | 9 | 5 | 5 | 0 | surface_scratch_light | corner_wear_light | ✓ |

## All disagreeing cards (refreshed)

| Card | PSA | Before Gem | After Gem | Before limiter | After limiter |
|------|----:|-----------:|----------:|----------------|---------------|
| 1950 C COCHRANE | 7 | 5 | 7 | edge_fraying_major | corner_wear_light |
| 1952 T MEYER | 7 | 5 | 5 | corner_wear_moderate | corner_wear_light |
| 1953 T GROTH | 7 | 2 | 4 | writing_mark_severe | writing_mark_severe |
| 1956 T MOON | 7 | 6 | 2 | corner_wear_moderate | severe_crease |
| 1958 T TURLEY | 7 | 4 | 6 | writing_mark_severe | corner_wear_light |
| 1960 T STARR | 7 | 5 | 9 | edge_fraying_major | corner_wear_light |
| 1964 T BEATLES | 7 | 5 | 6 | corner_wear_moderate | moderate_crease |
| 1971 T CASH | 7 | 2 | 6 | surface_scratch_moderate | corner_wear_light |
| 1974 T PARKER | 7 | 5 | 7 | surface_scratch_light | staining_light |
| 1978 T MORRIS | 7 | 5 | 5 | corner_wear_light | surface_scratch_light |
| 1981 T HENDERSON | 7 | 5 | 5 | corner_wear_moderate | corner_wear_light |
| 1983 T BOGGS | 7 | 5 | 7 | surface_scratch_light | corner_wear_light |
| 1985 T MCGWIRE | 7 | 5 | 7 | surface_scratch_light | staining_light |
| 1933 W BRYDGE | 8 | 5 | 3 | corner_wear_moderate | moderate_crease |
| 1953 T KENNEDY | 8 | 3 | 6 | surface_scratch_light | — |
| 1957 T HOWTON | 8 | 5 | 9 | writing_mark | corner_wear_light |
| 1960 T SPAHN | 8 | 3 | 7 | moderate_crease | corner_wear_light |
| 1970 T WERT | 8 | 7 | 7 | — | corner_wear_light |
| 1972 T WINFIELD | 8 | 5 | 5 | staining_light | corner_wear_light |
| 1975 T LUZINSKI | 8 | 5 | 7 | surface_scratch_light | corner_wear_light |
| T206 YOUNG | 8 | 3 | 5 | moderate_crease | — |
| 1950 C COBB | 9 | 3 | 5 | surface_wear | writing_mark |
| 1959 T MARSHALL | 9 | 3 | 6 | staining_light | surface_scratch_light |
| 1967 T HUNTER | 9 | 8 | 5 | corner_wear_light | corner_wear_light |
| 1971 T EXPOS | 9 | 4 | 7 | corner_wear_moderate | surface_scratch_light |
| 1976 T YOUNT | 9 | 5 | 3 | moderate_crease | surface_scratch_light |
| 1978 T ECKERSLEY | 9 | 5 | 7 | surface_scratch_light | surface_scratch_light |
| 1983 T SEAVER | 9 | 5 | 5 | surface_scratch_light | corner_wear_light |

## Primary limiter shifts (before → after)

| Limiter | Before | After | Δ |
|---------|-------:|------:|--:|
| `(none)` | 3 | 4 | +1 |
| `corner_wear_light` | 19 | 32 | +13 |
| `corner_wear_moderate` | 8 | 2 | -6 |
| `edge_fraying_major` | 3 | 1 | -2 |
| `moderate_crease` | 5 | 4 | -1 |
| `severe_crease` | 0 | 1 | +1 |
| `surface_scratch_light` | 17 | 14 | -3 |
| `surface_scratch_moderate` | 2 | 1 | -1 |
| `surface_wear` | 2 | 1 | -1 |
| `writing_mark_severe` | 5 | 4 | -1 |

## Phase 2 baseline recommendation

Adopt **40/72 (55.6%)** within ±1 as the Phase 2 implementation baseline (was 33/72 pre-refresh).

Scratch gremlins: **7** (was 11).

Mean error: **-1.13** (was -1.61).

Proceed to Phase 2C (Mantle guard) and 2D (Martin writing) only after confirming refreshed cache replay matches this report.

MODERN 10 control remains 31/32 — unchanged by cache refresh.

## Artifacts

| File | Purpose |
|------|---------|
| `benchmarks/reports/vintage-cache-refresh-latest.json` | Machine-readable full report |
| `benchmarks/cache/_archive/pre-phase2a/` | Pre-refresh cache backups |
| `benchmarks/run-vintage-cache-refresh-phase2a.mjs` | Reproducible refresh script |

## Verification

```bash
npm run test:api
node benchmarks/run-vintage-calibration-phase1.mjs
node benchmarks/run-modern10-baseline-replay.mjs
```

**Do not attribute post-refresh ±1 gains to Phase 2B/C/D implementation.** Measurement correction only.
