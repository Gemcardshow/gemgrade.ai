# Vintage Phase 1 Fix 3 — NM Scratch Skepticism Regression Plan

**Fix name:** Vintage NM Scratch Skepticism  
**Prerequisite research:** `vintage-scratch-investigation-report.md`  
**Status:** Plan only — **no code implemented**  
**Fix 2 status:** Deferred — `benchmarks/vintage-fix2-deferred.md`

---

## Goals

1. Reduce false `surface_scratch_light` primary limiters on PSA 7–9 vintage cards without stripping confirmed scratches.
2. Mirror modern `hasConfirmedSurfaceScratchEvidence` on a **vintage-only** code path — do not modify modern production or `filterUnconfirmedSurfaceScratchDefects` behavior.
3. Preserve Fix 1, Fix 5, and EX-band scratch/moderate behavior on PSA 4–6.
4. Do not implement deferred Fix 2 (crease).

---

## Baseline Metrics (pre–Fix 3)

| Gate | Value |
|------|------:|
| Vintage PSA 7–9 within ±1 | 15/48 investigation cards |
| `scratch_limiter_high_grade` gremlins | 17 |
| Direct `defect:surface_scratch_light` binds on gremlin misses | 10 |
| Vintage 72-card within ±1 | 32/72 |

---

## Test Cases (`engine.test.js`)

### F3-A — Strip unconfirmed scratch on NM vintage

| ID | Scenario | Expected |
|----|----------|----------|
| **F3-1** | PSA 9, clean surface note + generic "few minor scratches", scratch tag | No `surface_scratch_light` after normalize |
| **F3-2** | Boggs-like: "Surface is clean with minimal visible issues" + scratch tag | Tag stripped; limiter ≠ scratch |
| **F3-3** | Rose-like: "do not detract significantly" + generic scratch | Tag stripped or reclassified to `print_line` |
| **F3-4** | Hunter-like: "Light scratches; otherwise clean surface" | Tag stripped on vintage NM path |

### F3-B — Preserve confirmed scratch

| ID | Scenario | Expected |
|----|----------|----------|
| **F3-5** | Linear/hairline scratch in surface note + tag | `surface_scratch_light` retained |
| **F3-6** | Scratch crossing artwork language + tag | Retained |
| **F3-7** | Ripken PSA 7-like: light scratches, corners/edges wear, within-band | Retained OR cap 7.5 acceptable (within ±1) |
| **F3-8** | PSA 5 EX, confirmed moderate scratch | `surface_scratch_moderate` not stripped |

### F3-C — Era isolation

| ID | Scenario | Expected |
|----|----------|----------|
| **F3-9** | Modern glossy card, generic scratch | Existing modern strip unchanged |
| **F3-10** | Vintage card through normalize | New gate runs; modern path untouched |
| **F3-11** | `filterUnconfirmedSurfaceScratchDefects` still modern-only | Assert no vintage defects filtered by that function |

### F3-D — Cap / limiter interaction

| ID | Scenario | Expected |
|----|----------|----------|
| **F3-12** | After strip, primary limiter recalculates to next-worst defect | No orphan scratch limiter |
| **F3-13** | Scratch stripped, stain/back-only remains | `ex_band:back_stain_only_ceiling` unchanged |
| **F3-14** | Triad cap card (Marshall) | Triad behavior unchanged; scratch strip optional |

### F3-E — Negative regressions

| ID | Scenario | Expected |
|----|----------|----------|
| **F3-N1** | Fix 1 stain reconcile (Cobb/Marshall back toning) | Unchanged |
| **F3-N2** | Fix 5 NM triad skip (Hunter with triad if applicable) | Unchanged |
| **F3-N3** | Howe PSA 4 | No scratch relief |
| **F3-N4** | MODERN 910 benchmark | Zero change |
| **F3-N5** | Carew PSA 7 `surface_scratch_moderate` | Not downgraded to light without evidence |
| **F3-N6** | Kennedy snapshot profile (no scratch tag) | Gem ≥ 6, no scratch limiter |

---

## Benchmark Acceptance Criteria

```bash
npm test
node benchmarks/analyze-fix3-scratch-research.mjs
node benchmarks/run-vintage-calibration-phase1.mjs
```

| Gate | Target |
|------|--------|
| Gremlin `scratch_limiter_high_grade` count | ≤ 8 (≥ 50% reduction from 17) |
| PSA 9 cards bound only by `defect:surface_scratch_light` | ≤ 3 |
| Boggs PSA 7 (snapshot) | Gem ≥ 7, no scratch limiter |
| Rose/Clemens/Seaver PSA 9 | Gem ≥ 7 OR within ±1 |
| Ripken PSA 7 | Within ±1 (scratch may remain) |
| Vintage 72-card within ±1 | ≥ 34/72 (no regression) |
| MODERN 910 | 31/32 unchanged |

---

## Implementation Touchpoints (reference — do not edit yet)

| File | Area |
|------|------|
| `lib/grading/analyze.js` | New `reconcileVintageNmScratchSkepticism(defects, raw, categoryScores)` — vintage era only |
| `lib/grading/analyze.js` | Reuse `hasConfirmedSurfaceScratchEvidence`, `SURFACE_CLEAN_SCRATCH_CONTRADICTION`, generic scratch patterns |
| `lib/grading/analyze.js` | Do **not** widen `filterUnconfirmedSurfaceScratchDefects` to vintage — separate function |
| `lib/grading/engine.test.js` | F3-1…F3-N6 |
| `benchmarks/analyze-fix3-scratch-research.mjs` | Snapshot-preferred replay option |

---

## Rollout Order

1. Add F3 tests (red).
2. Implement vintage-only scratch skepticism reconcile step in `normalizeAnalysis` (after vision defects, before grade caps).
3. Re-run Fix 3 research + full vintage phase 1.
4. Verify MODERN 910 frozen.
5. Document before/after in commit (when user requests commit).

---

## Out of Scope

- Fix 2 crease gate (deferred).
- Triad cap rework (Fix 5 follow-up).
- Changing `capVintage: 7.5` globally — prefer tag strip over cap inflation.
- Full cache regeneration (recommended hygiene follow-up).
