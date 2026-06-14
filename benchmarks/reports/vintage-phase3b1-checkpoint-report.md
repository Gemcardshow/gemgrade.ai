# Vintage Phase 3 — Checkpoint Report (3E + 3A + 3B-1)

**Generated:** 2026-06-14  
**Branch:** `phase2/vintage-research`  
**Modern production freeze:** `15a078c` — **unchanged**  
**Prior vintage checkpoint:** `3cda2b8` (Phase 2 @ `5a5dd8b`)  
**Status:** Phase 3 cap-stacking work through **3B-1 shipped**; **3B-2 / 3B-3 deferred**

---

## Summary

Phase 3 addresses cap-stacking deflation and low-slab inflation identified in `vintage-phase3-cap-stacking-plan.md`. Three workstreams shipped in grading logic (no prompt changes):

| Workstream | Focus | Primary cards |
|------------|-------|---------------|
| **3E** | Low-slab `nm_band:mint_floor` guard | 1989 F Bird PSA 4 |
| **3A** | Triad clamp cap bypass + floor relief | 1976 T Yount PSA 9 |
| **3B-1** | Triad clamp floor recovery companion | Winfield, Rose, Clemens (+ Hunter/Drysdale side effect) |

Vintage 72-card replay improved from **43/72 → 48/72 within ±1 (+5 cards)**. MODERN 10 baseline unchanged. Engine tests **198/198 pass**.

---

## Before / After Benchmark Table

| Gate | Before Phase 3 (through 3A) | After 3B-1 |
|------|----------------------------:|-----------:|
| **Vintage within ±1** | **43/72 (59.7%)** | **48/72 (66.7%)** |
| **MODERN 10 within ±1** | **31/32 (96.9%)** | **31/32 (96.9%)** |
| **Modern false-positive tags** | **0** | **0** |
| **Engine tests** | 191/191 (pre-3B-1 tests) | **198/198** |

Replay commands:

```bash
npm run test:api
node benchmarks/run-vintage-calibration-phase1.mjs
node benchmarks/run-modern10-baseline-replay.mjs
```

---

## Phase 3E — Bird Guard Summary

**Problem:** `nm_band:mint_floor` lifted 1989 F Bird PSA 4 to Gem **7**, overriding `ex_band:uniform_light_optimism_ceiling` @ 4.

**Change:** Extract `qualifiesForRyanStyleOptimismCeiling`; skip `nm_band:mint_floor` when vintage cards match the Ryan-style single-`corner_wear_light` inflation pattern (wear floor ≥ 7.5, no moderate+).

**Result:** Bird PSA 4 → Gem **4** (exact match, Δ +0). Inflation removed; guard preserved on future cap-relief work.

**Tests:** F3E-1…F3E-3; F2B-13 Bird assertion updated.

---

## Phase 3A — Yount Triad Bypass Summary

**Problem:** 1976 T Yount PSA 9 bound at Gem **3** by `vintage:triad_light_wear_notes` @ 3.5 despite strong pre-clamp vision evidence (Phase 2B floor relief insufficient — full NM triad skip failed band gate).

**Change:**
- `qualifiesForVintageTriadClampCapRelief` — companion skip for clamp victims with light-only defects and strong surface presentation (“presents well”)
- Extended `applyVintageTriadSkipCategoryFloorRelief` and `resolveNmVintageDefectCap` with pre-clamp evidence
- Reconciled back-stain EX ceiling bypass when clamp relief qualifies

**Result:** Yount PSA 9 → Gem **8** (Δ −1, within ±1).

**Tests:** F3A-1…F3A-3; F2B-5 updated.

---

## Phase 3B-1 — Triad Floor Recovery Summary

**Problem:** Winfield, Rose, and Clemens remained crushed at `categoryFloor` @ **5.5** after triad normalize clamp because `qualifiesForVintageNmTriadCapSkip` failed (2-defect light-wear profiles, band-gate misses, negated moderate note false positives).

**Change:**
- `qualifiesForVintageTriadFloorRecovery` — pre-clamp wear min ≥ **6.5**, surface ≥ **6** (excludes Seaver), light-only defects, affirmative moderate-note filter, strong presentation evidence
- `resolveVintageTriadFloorRecoveryTarget` — floor = `max(wearMin, min(wearMin + 1, 8))`
- Extended `applyVintageTriadSkipCategoryFloorRelief`; back-stain ceiling skip when 3B-1 qualifies

**Explicitly not changed:** `applyVintageExSlabBandRecovery` (3B-2), `nm_band:mint_floor` logic (3B-3), prompts, analyze gates.

**Tests:** F3B-1…F3B-3, F3B-1-N1…N4; F2B-4 / F3E-3 updated for Winfield and Hunter paths.

---

## Cards Improved

| Card | PSA | Gem (before → after) | Δ | Workstream | Within ±1 |
|------|----:|---------------------:|--:|------------|:---------:|
| 1976 T Yount | 9 | 3 → **8** | −1 | 3A | ✓ |
| 1989 F Bird | 4 | 7 → **4** | +0 | 3E | ✓ (deflation fix) |
| 1972 T Winfield | 8 | 5 → **7** | −1 | 3B-1 | ✓ |
| 1969 T Rose | 9 | 6 → **8** | −1 | 3B-1 | ✓ |
| 1984 F Clemens | 9 | 6 → **7** | −2 | 3B-1 | ✓ (marginal) |
| 1967 T Hunter | 9 | 7 → **8** | −1 | 3B-1 side effect | ✓ |
| 1968 T Drysdale | 9 | 7 → **8** | −1 | 3B-1 side effect | ✓ |

---

## Cards Intentionally Unchanged

| Card | PSA | Gem | Reason |
|------|----:|----:|--------|
| 1983 T Seaver | 9 | **5** | Deferred — pre-clamp surface **5.0**; 3B-1 min surface gate excludes |
| 1967 T Carew | 7 | **2** | Moderate+ defects; poor-band cluster — no cap relief |
| 1933 W Brydge | 8 | **3** | Legitimate `moderate_crease` bind |
| 1989 F Bird | 4 | **4** | 3E guard holds (was 7 pre-3E) |
| 1950 C Cobb | 9 | **5** | Writing + compound stack — analyze track |
| 1980 T McCovey | 4 | **1** | Severe writing compound — intentional harsh path |

---

## Code Touchpoints

| File | Changes |
|------|---------|
| `lib/grading/psa-calibration.js` | 3E Ryan guard; 3A clamp cap relief; 3B-1 floor recovery; back-stain companions |
| `lib/grading/engine.test.js` | F3E, F3A, F3B-1 test suites (+13 net tests vs Phase 2 @ 185) |

---

## Deferred (Not in This Checkpoint)

| Item | Plan reference |
|------|----------------|
| **3B-2** `ex_slab_band_recovery` ladder lift | Rose/Clemens/Hunter/Drysdale residual if floor-only insufficient |
| **3B-3** `mint_floor` evidence alignment | Hunter/Drysdale mint path |
| **3C** EX back-stain NM skip | Gibson, Tyler |
| **3D** Poor-band / crease defer | Carew, Brydge |
| **3F** Writing compound | Cobb, McCovey |
| **Seaver** tier-2 floor | Vision refresh or surface ≥ 6 gate review |

---

## Verification @ Checkpoint

| Check | Result |
|-------|--------|
| `npm run test:api` | **198/198 pass** |
| Vintage replay | **48/72 within ±1** |
| MODERN 10 replay | **31/32**, 0 FP tags |
| Bird Gem ≤ 5 | **4** ✓ |
| Yount Gem ≥ 8 | **8** ✓ |
| Carew / Brydge unchanged | **2 / 3** ✓ |
| Seaver unchanged | **5** ✓ |

---

## Artifact Index

| Document | Purpose |
|----------|---------|
| `benchmarks/reports/vintage-phase3-cap-stacking-plan.md` | Phase 3 master plan |
| `benchmarks/reports/vintage-phase3b-floor-recovery-implementation-plan.md` | 3B planning |
| `benchmarks/reports/vintage-phase3e-comparison.md` | 3E before/after |
| `benchmarks/reports/vintage-phase2-checkpoint-report.md` | Phase 2 closure @ `5a5dd8b` |
| **This document** | Phase 3 checkpoint through 3B-1 |

---

*No prompt changes. No 3B-2 / 3B-3 implementation in this checkpoint.*
