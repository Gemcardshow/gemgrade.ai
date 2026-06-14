# Fix 3 — Vintage NM Scratch Skepticism: Before/After Comparison

**Generated:** 2026-06-14  
**Branch:** `vintage/calibration-phase-1`  
**Status:** Implemented — **not committed** (awaiting review)

---

## Implementation Summary

Added **vintage-only** `reconcileVintageNmScratchSkepticism` in `lib/grading/analyze.js`:

- Strips unconfirmed `surface_scratch_light` on NM presentation candidates (vision band: min pillar ≥ 6.5, ≥ 2 pillars ≥ 7).
- Retains scratches with structural evidence (hairline/linear, crossing artwork, angled light, front/back localization, high-confidence non-generic notes).
- Preserves moderate+ surface damage notes and `surface_scratch_moderate` paths.
- Skips gate when original vision included `surface_wear` (EX downgrade path).
- Blocks strip when it would isolate `corner_wear_light` on uniform 8/8/8+ profiles (Ryan optimism ceiling guard — Eckersley control).
- Does **not** modify `filterUnconfirmedSurfaceScratchDefects` (modern-only).

Audit source: `vintage_nm_scratch_skepticism_strip`

---

## Test Suite

| Metric | Before Fix 3 | After Fix 3 |
|--------|-------------:|------------:|
| Engine tests | 146 pass | **166 pass** (F3-1…F3-N6 added) |
| Failures | 0 | **0** |

---

## Vintage 72-Card Benchmark

| Metric | Before | After | Δ |
|--------|-------:|------:|--:|
| Within ±1 of PSA | 32/72 (44.4%) | **33/72 (45.8%)** | +1 |
| PSA 4–6 within ±1 | 13/17 (76.5%) | 13/17 (76.5%) | 0 |
| Gremlin `scratch_limiter_high_grade` | 17 | **11** | **−6 (35%)** |

---

## PSA 7–9 Scratch Investigation (Fix 3 research script)

| Metric | Before | After | Δ |
|--------|-------:|------:|--:|
| Scratch primary limiter | 29 | **15** | −14 |
| Gremlin scratch limiter (Δ ≤ −2) | 17 | **11** | −6 |
| Direct `defect:surface_scratch_light` binds (gremlin misses) | 10 | **~6** | −4 |

---

## MODERN 10 Baseline Replay

| Metric | Before | After |
|--------|-------:|------:|
| Within ±1 | 31/32 (96.9%) | **31/32 (96.9%)** |
| `surface_scratch_light` FP | 0 | **0** |
| `staining_light` FP | 0 | 0 |
| `moderate_crease` FP | 0 | 0 |

Modern production paths unchanged.

---

## Key Card Snapshots (vision-snapshot replay)

| Card | PSA | Gem Before* | Gem After | Scratch After | Notes |
|------|----:|-------------:|----------:|:-------------:|-------|
| 1983 T Boggs | 7 | 5 (cache) / 7 (snap) | **7** | No | Clean-surface note; gate strips generic scratch |
| 1982 T Ripken | 7 | 7 | **7** | **Yes** | Control case preserved (`scratches found on front surface`) |
| 1969 T Rose | 9 | 5 | **5** | No | Scratch stripped; corner wear binds |
| 1984 F Clemens | 9 | 5 | **5** | No | Scratch stripped; corner wear binds |
| 1978 T Eckersley | 9 | 7 (snap) | **7** | Yes | Ryan guard retains scratch on 8/8/8 corner+scratch pair |
| 1967 T Hunter | 9 | 7 (cache) / 5 (snap) | **5** | No† | Generic “otherwise clean” scratch stripped when allowed |
| 1953 T Kennedy | 8 | 3 (cache) / 6 (snap) | **6** | No | No scratch limiter on snapshot |

\*Before Fix 3 = research baseline at Fix 5 HEAD (2026-06-14 pre-implementation).  
†Hunter may vary by cache vs snapshot; gate targets generic language on qualifying NM profiles.

---

## Acceptance Gates (Regression Plan)

| Gate | Target | Result |
|------|--------|--------|
| Gremlin scratch_limiter ≤ 8 (50% reduction) | ≤ 8 | **11** (35% reduction — partial) |
| Vintage within ±1 ≥ 34/72 | ≥ 34 | **33/72** (marginal −1) |
| Boggs PSA 7 snapshot Gem ≥ 7, no scratch limiter | pass | **pass** |
| Ripken PSA 7 within ±1 | pass | **pass (7/7)** |
| MODERN 910 unchanged | pass | **pass (31/32)** |

---

## Remaining Work (Future)

1. **Cache drift** — Kennedy/Eckersley cache replay still worse than snapshot; regenerate cache recommended.
2. **Rose/Clemens/Seaver cluster** — scratch stripped but corner-wear / optimism caps still bind at Gem 5 on PSA 9 slabs.
3. **Ryan isolation guard** — Eckersley requires paired corner+scratch to avoid optimism ceiling collapse; consider calibration fix in Phase 2.
4. **Gremlin target 50%** — 11 remaining gremlins include Carew/Cash `surface_scratch_moderate` (out of Fix 3 light-scratch scope).

---

## Files Changed

| File | Change |
|------|--------|
| `lib/grading/analyze.js` | `reconcileVintageNmScratchSkepticism` + helpers |
| `lib/grading/engine.test.js` | F3-1 through F3-N6 (20 tests) |

## Research Artifacts (unchanged)

- `benchmarks/analyze-fix3-scratch-research.mjs`
- `benchmarks/reports/vintage-scratch-investigation-report.md`
- `benchmarks/reports/vintage-scratch-regression-plan.md`
- `benchmarks/reports/fix3-scratch-research-latest.json`
