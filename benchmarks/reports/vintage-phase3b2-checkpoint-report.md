# Vintage Phase 3 — Checkpoint Report (3B-2)

**Generated:** 2026-06-14  
**Branch:** `phase2/vintage-research`  
**Prior checkpoint:** `ca78f34` (3E + 3A + 3B-1 @ 48/72)  
**Grading baseline:** `ca78f34` — unchanged logic through 3B-1  
**Status:** Phase 3B-2 shipped; **3B-3 deferred**

---

## Summary

Phase 3B-2 adds **evidence-based `ex_slab_band_recovery` lift** using pre-clamp vision scores for the 3B floor-recovery cohort. The recovery ladder replaces the legacy hard cap @ **6** when `qualifiesForVintageExSlabBandRecoveryLift` passes.

**No live vintage grades changed** on the 72-card replay. Vintage and MODERN 10 regression gates are unchanged. Engine tests **198 → 207** (+9).

---

## What Shipped (3B-2)

| Component | Purpose |
|-----------|---------|
| `qualifiesForVintageExSlabBandRecoveryLift()` | Reuses 3B-1 floor-recovery gates + `paper_loss` exclusion |
| `resolveVintageExSlabBandRecoveryEvidenceTarget()` | Pre-clamp evidence ladder (wear min + centering tiers) |
| `applyVintageExSlabBandRecovery()` | Uses `getVintageTriadVisionBandScores()` when lift qualifies |

### Evidence recovery ladder

| Pre-clamp wear min | Centering | Legacy target | 3B-2 target |
|-------------------:|-----------|-------------:|------------:|
| ≥ 7.5 | ≥ 7 | 6 | **8** |
| ≥ 7.0 | ≥ 7 | 6 | **7.5** |
| ≥ 6.5 | ≥ 7 | 6 | **7** (Clemens tier capped at **7.5** via `min(wearMin+1, 7.5)`) |
| ≥ 6.0 | ≥ 7 | 5.5 | **6.5** |

### Safety gates (unchanged from 3B-1 intent)

- Pre-clamp evidence only (`getVintageTriadVisionBandScores`)
- Triad normalize clamp required
- Light-only defects
- No moderate+, crease, writing, paper loss, or PSA-1 triggers
- Strong presentation evidence required
- **Excluded:** Seaver (surface &lt; 6), Bird, Carew, Brydge, Cobb, McCovey

---

## Why No Live Grade Changes

Phase **3B-1** floor relief (`vintage:triad_skip_category_floor_relief`) already lifts `categoryFloor` above the legacy recovery cap on the live 3B cohort (Rose, Clemens, Hunter, Drysdale). When `overall >= recovery target`, recovery does not re-bind and no audit entry is written.

**3B-2 acts as a safety net** for future cases where:

- Triad normalize clamp crushes pillars to 5.5
- Floor relief is insufficient or not yet applied
- `ex_slab_band_recovery` @ 6 would still bind

Synthetic test **F3B2-4** confirms crushed overall **5.5 → ≥ 7.5** when evidence qualifies.

Winfield (PSA 8) remains unaffected — `isExVgBandProtected` is false for its multi-defect optimistic profile; recovery path does not run.

---

## Before / After Card Table (3B Cohort)

| Card | PSA | Gem (pre-3B-2) | Gem (post-3B-2) | Within ±1 | Notes |
|------|----:|---------------:|----------------:|:---------:|-------|
| 1969 T Rose | 9 | **8** | **8** | ✓ | Floor relief @ 8 |
| 1984 F Clemens | 9 | **7** | **7** | marginal (Δ −2) | Floor relief @ 7.5 → PSA snap 7 |
| 1967 T Hunter | 9 | **8** | **8** | ✓ | Floor relief @ 8 |
| 1968 T Drysdale | 9 | **8** | **8** | ✓ | Floor relief @ 8 |
| 1972 T Winfield | 8 | **7** | **7** | ✓ | No recovery path |
| 1983 T Seaver | 9 | **5** | **5** | ✗ | Excluded (surface 5.0) |

---

## Benchmark Gates

| Gate | @ `ca78f34` (3B-1) | Post 3B-2 | Delta |
|------|-------------------:|----------:|------:|
| **Vintage within ±1** | 48/72 (66.7%) | **48/72 (66.7%)** | **0** |
| **MODERN 10 within ±1** | 31/32 (96.9%) | **31/32 (96.9%)** | **0** |
| **Modern false-positive tags** | 0 | **0** | **0** |
| **Engine tests** | 198/198 | **207/207** | **+9** |

```bash
npm run test:api
node benchmarks/run-vintage-calibration-phase1.mjs
node benchmarks/run-modern10-baseline-replay.mjs
```

---

## Regression Guards (Unchanged)

| Card / check | Gem | Status |
|--------------|----:|--------|
| 1989 F Bird PSA 4 | **4** | 3E guard holds (F3B2-N3) |
| 1967 T Carew PSA 7 | **2** | No recovery inflation (F3B2-N2) |
| 1933 W Brydge PSA 8 | **3** | No recovery inflation (F3B2-N2) |
| 1950 C Cobb PSA 9 | **5** | Writing stack unchanged (F3B2-N4) |
| 1980 T McCovey PSA 4 | **1** | Compound stack unchanged (F3B2-N4) |
| 1983 T Seaver PSA 9 | **5** | Excluded from lift (F3B2-N1) |
| 1976 T Yount PSA 9 | **8** | 3A regression unchanged (F3B2-N5) |

**Inflated vintage count:** **13↑** — no new inflation (Starr, Mantle cluster, Schmidt unchanged).

---

## Tests Added

| ID | Assertion |
|----|-----------|
| **F3B2-1** | Rose PSA 9 — Gem ≥ 8; recovery floor ≥ 7.5 if audit present |
| **F3B2-2** | Clemens PSA 9 — Gem ≥ 7; floor relief ≥ 7 |
| **F3B2-3** | Hunter / Drysdale PSA 9 — Gem ≥ 8; recovery floor ≥ 7.5 if present |
| **F3B2-4** | Synthetic — crushed 5.5 lifts to ≥ 7.5 via evidence recovery |
| **F3B2-N1** | Seaver — no evidence recovery lift |
| **F3B2-N2** | Carew / Brydge unchanged |
| **F3B2-N3** | Bird — 3E guard preserved |
| **F3B2-N4** | Cobb / McCovey unchanged |
| **F3B2-N5** | Yount — 3A regression unchanged |

---

## Code Touchpoints

| File | Changes |
|------|---------|
| `lib/grading/psa-calibration.js` | 3B-2 lift qualification + evidence recovery target + `applyVintageExSlabBandRecovery` |
| `lib/grading/engine.test.js` | F3B2 positive + negative suites (+9 tests) |

---

## Explicitly Not in This Checkpoint

- **No prompt changes**
- **No analyze gate changes**
- **No 3B-3** (`mint_floor` evidence alignment — Hunter/Drysdale residual headroom)
- **No opportunistic refactors**

---

## Artifact Index

| Document | Purpose |
|----------|---------|
| `benchmarks/reports/vintage-phase3b1-checkpoint-report.md` | Prior checkpoint @ `ca78f34` |
| `benchmarks/reports/vintage-phase3b-floor-recovery-implementation-plan.md` | 3B master plan |
| `benchmarks/reports/vintage-phase3-status.md` | Living Phase 3 status |
| **This document** | 3B-2 checkpoint |

---

*3B-2 recovery safety net shipped. Live replay unchanged @ 48/72. 3B-3 deferred.*
