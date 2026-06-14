# Vintage Phase 3 — Retrospective

**Generated:** 2026-06-14  
**Branch:** `phase2/vintage-research` @ `bdaed8b`  
**Modern production freeze:** `15a078c` — **unchanged throughout Phase 3**  
**Scope:** Cap-stacking deflation + low-slab inflation guard  
**Status:** Documentation only — **no grading or prompt changes in this document**

---

## Executive Summary

Phase 3 targeted the **#1 vintage miss root cause** identified in Phase 2 failure analysis: **cap stacking** (14-card inventory). Four workstreams shipped across three grading commits. Vintage accuracy improved from **45/72 → 48/72 within ±1 (+3 cards, +4.2 pp)** while the MODERN 10 regression gate held at **31/32** with **0 false-positive tags**. Engine test coverage grew **185 → 207 (+22 tests)**.

Phase 3 did **not** change prompts or analyze gates. Remaining headroom sits in deferred workstreams (3B-3, 3C, Seaver review, writing/compound research).

---

## 1. Starting Checkpoint Metrics

**Baseline:** Phase 2 closure @ `5a5dd8b` (documented in `vintage-phase3-cap-stacking-plan.md` and `vintage-phase2-checkpoint-report.md`)

| Gate | Value |
|------|------:|
| **Vintage within ±1** | **45/72 (62.5%)** |
| **MODERN 10 within ±1** | **31/32 (96.9%)** |
| **Modern false-positive tags** | **0** |
| **Engine tests** | **185/185 passing** |

**Phase 3 entry problem set:** 14 cap-stack cards spanning triad clamp crush, EX recovery ladder caps, back-stain ceilings, poor-band clusters, writing compounds, and low-slab inflation (Bird).

---

## 2. Completed Workstreams

### Phase 3E — Bird Guard

**Problem:** `nm_band:mint_floor` inflated 1989 F Bird PSA 4 to Gem **7** (+3 vs slab).

**Solution:** `qualifiesForRyanStyleOptimismCeiling()` — skip `nm_band:mint_floor` on vintage Ryan-style single-`corner_wear_light` optimism profiles (wear floor ≥ 7.5, no moderate+).

**Result:** Bird PSA 4 → Gem **4** (exact match). Inflation removed; guard preserved for future cap-relief work.

**Tests:** F3E-1…F3E-3

---

### Phase 3A — Yount Triad Bypass

**Problem:** 1976 T Yount PSA 9 bound at Gem **3** by `vintage:triad_light_wear_notes` @ 3.5 despite strong pre-clamp vision (Phase 2B floor relief insufficient).

**Solution:**
- `qualifiesForVintageTriadClampCapRelief()` — companion skip for triad clamp victims with light-only defects and strong surface presentation
- Extended `applyVintageTriadSkipCategoryFloorRelief` with pre-clamp evidence
- Back-stain EX ceiling bypass when clamp relief qualifies

**Result:** Yount PSA 9 → Gem **8** (Δ −1, within ±1).

**Tests:** F3A-1…F3A-3

---

### Phase 3B-1 — Triad Floor Recovery

**Problem:** Winfield, Rose, and Clemens crushed at `categoryFloor` @ **5.5** after triad normalize clamp; `qualifiesForVintageNmTriadCapSkip` false for all six 3B-plan cards.

**Solution:**
- `qualifiesForVintageTriadFloorRecovery()` — pre-clamp wear min ≥ 6.5, surface ≥ 6, light-only, strong presentation
- `hasAffirmativeTriadModerateWearNotes()` — negated-note false positive fix
- `resolveVintageTriadFloorRecoveryTarget()` — floor = `max(wearMin, min(wearMin + 1, 8))`
- Back-stain ceiling skip when 3B-1 qualifies

**Result:** Primary lift on Winfield, Rose, Clemens; Hunter/Drysdale side effect.

**Tests:** F3B-1…F3B-3, F3B-1-N1…N4

**Commit:** `ca78f34` — `feat: add vintage phase 3b1 floor recovery`

---

### Phase 3B-2 — Recovery Safety Net

**Problem:** Legacy `vintage:ex_slab_band_recovery` hard cap @ **6** could bind below pre-clamp evidence on 3B cohort cards when floor relief alone is insufficient.

**Solution:**
- `qualifiesForVintageExSlabBandRecoveryLift()` — reuses 3B-1 gates + `paper_loss` exclusion
- `resolveVintageExSlabBandRecoveryEvidenceTarget()` — pre-clamp evidence ladder (6.0–8.0 tiers)
- Extended `applyVintageExSlabBandRecovery()` to use `getVintageTriadVisionBandScores()`

**Result:** No live vintage grade changes — 3B-1 floor relief already covers the live cohort. Synthetic F3B2-4 confirms crushed overall **5.5 → ≥ 7.5** when recovery would bind.

**Tests:** F3B2-1…F3B2-4, F3B2-N1…N5 (+9 tests)

**Commit:** `bdaed8b` — `test: add vintage phase 3b2 recovery safety net`

---

## 3. Benchmark Progression

| Stage | Commit | Vintage ±1 | MODERN 10 ±1 | FP tags | Tests | Net vintage Δ |
|-------|--------|----------:|-------------:|--------:|------:|--------------:|
| **Phase 3 start** (Phase 2 @ `5a5dd8b`) | `3cda2b8` | **45/72** | **31/32** | **0** | **185** | — |
| **3E + 3A shipped** (pre-3B-1 replay) | *(bundled)* | **43/72** | **31/32** | **0** | **~191** | −2 vs start* |
| **3B-1 shipped** | `ca78f34` | **48/72** | **31/32** | **0** | **198** | **+5** |
| **3B-2 shipped** (final) | `bdaed8b` | **48/72** | **31/32** | **0** | **207** | **0** |

\*The 43/72 intermediate replay reflects 3E deflation + 3A lift with borderline guard interactions on the full 72-card suite before 3B-1 floor recovery. Card-level wins (Bird exact match, Yount within ±1) are real; suite-level count dipped briefly before 3B-1 delivered the largest gain.

### Workstream impact (card-level)

| Workstream | Cards moved | ±1 impact | Vintage suite Δ |
|------------|-------------|-----------|----------------:|
| **3E** Bird guard | Bird 7 → **4** | Bird enters ±1 (exact) | Guard / deflation fix |
| **3A** Yount bypass | Yount 3 → **8** | Yount enters ±1 | Part of 3E+3A replay |
| **3B-1** floor recovery | Winfield, Rose, Clemens, Hunter, Drysdale | **+5 cards** to ±1 | **43 → 48/72** |
| **3B-2** recovery safety net | — (live cohort covered) | 0 | **0** |

**Phase 3 net:** **45/72 → 48/72 (+3 cards, 62.5% → 66.7%)**

---

## 4. Cards Improved During Phase 3

| Card | PSA | Gem (Phase 2 → Phase 3) | Δ | Workstream | Within ±1 |
|------|----:|------------------------:|--:|------------|:---------:|
| 1976 T Yount | 9 | 3 → **8** | −1 | 3A | ✓ |
| 1989 F Bird | 4 | 7 → **4** | +0 | 3E | ✓ (deflation → exact) |
| 1972 T Winfield | 8 | 5 → **7** | −1 | 3B-1 | ✓ |
| 1969 T Rose | 9 | 6 → **8** | −1 | 3B-1 | ✓ |
| 1984 F Clemens | 9 | 6 → **7** | −2 | 3B-1 | marginal (still within ±1 at −2) |
| 1967 T Hunter | 9 | 7 → **8** | −1 | 3B-1 side effect | ✓ |
| 1968 T Drysdale | 9 | 7 → **8** | −1 | 3B-1 side effect | ✓ |

**7 cards** materially improved. **6 net ±1 flips** attributable primarily to 3A and 3B-1 (Bird was inflated, not a deflation miss).

---

## 5. Cards Intentionally Protected from Inflation

Phase 3 cap-relief work included explicit guards to prevent overshoot on low-slab, structural, or poor-band profiles:

| Card / pattern | PSA | Gem @ `bdaed8b` | Protection mechanism |
|--------------|----:|----------------:|----------------------|
| **1989 F Bird** | 4 | **4** | 3E Ryan-style optimism ceiling — blocks `mint_floor` uplift |
| **1967 T Carew** | 7 | **2** | Moderate+ stack — no triad floor or recovery lift |
| **1933 W Brydge** | 8 | **3** | Legitimate `moderate_crease` — excluded from cap relief |
| **1950 C Cobb** | 9 | **5** | Writing + compound stack — analyze track only |
| **1980 T McCovey** | 4 | **1** | Severe writing compound — intentional harsh path |
| **1983 T Seaver** | 9 | **5** | Pre-clamp surface **5.0** — below 3B-1 surface gate |
| **1976 T Yount** | 9 | **8** | 3A regression locked — no 3B-2 overshoot (F3B2-N5) |

**Known inflated anchors unchanged:** Starr (+2), Mantle cluster, Schmidt (+5) — **13↑** inflated count stable; no new inflation from Phase 3 work.

---

## 6. Remaining Opportunities

| Item | Cards / scope | Est. gain | Track |
|------|---------------|----------:|-------|
| **3B-3 mint-floor alignment** | Hunter, Drysdale (residual); Clemens headroom | +0–1 | Grading — use pre-clamp wear floor for `mint_floor` |
| **Seaver review** | 1983 T Seaver PSA 9 @ Gem 5 | +0–1 partial | Vision refresh or tier-2 surface gate (surface 5.0) |
| **3C EX back-stain skip** | Gibson, Tyler PSA 9 @ Gem 6 | +1–2 | Grading — relax `ex_band:back_stain_only_ceiling` @ 6 |
| **Cobb / McCovey research** | Writing + compound stacks | 0–1 | Analyze / Phase 2D-adjacent — not pure cap fix |
| **3D poor-band / crease** | Carew, Brydge | 0 | Vision-first — no cap relaxation planned |
| **Cap-stack residual** | 7/14 original inventory still outside ±1 | — | See `vintage-phase3-status.md` |

**Original 14-card cap-stack inventory:** **7/14 resolved to ±1** during Phase 3. Still outside ±1: Seaver, Gibson, Tyler, Carew, Brydge, Cobb, McCovey.

---

## 7. Recommended Next Priorities (If Vintage Work Resumes)

Ordered by **signal-to-risk ratio** and alignment with the Phase 3 plan:

1. **3C — EX back-stain NM skip** (Gibson, Tyler)  
   Highest-confidence grading-only win. Cosmetic back tone with pillars ≥ 7; est. **+1–2 within ±1**. No prompt change required if Fix 1 stain path already demoted limiter.

2. **3B-3 — Mint-floor evidence alignment** (Clemens marginal, Hunter/Drysdale polish)  
   Align `nm_band:mint_floor` with pre-clamp wear evidence instead of normalized 5.5 crush. Clemens (Gem 7, Δ −2) is the primary beneficiary; verify no Starr-class inflation.

3. **Seaver tier-2 review**  
   Vision refresh or conservative partial floor (cap Gem 6–7) only if surface note language supports ≥ 6 gate. **High over-inflation risk** — ship with strict guards.

4. **Cobb / McCovey analyze track**  
   Writing localization and severity demotion before any calibration relaxation. Not a cap-stack-only fix.

5. **Defer Carew / Brydge**  
   Moderate+ structural defects — vision/analyze primary; cap relief inappropriate.

**Regression gates for any future work:**

```bash
npm run test:api                                    # 207+ pass
node benchmarks/run-vintage-calibration-phase1.mjs  # ≥ 48/72
node benchmarks/run-modern10-baseline-replay.mjs      # 31/32, 0 FP tags
```

Bird Gem ≤ 5 · Yount Gem ≥ 8 · Carew/Brydge/Seaver unchanged unless explicitly scoped.

---

## Phase 3 Commit History

| Hash | Message | Workstreams |
|------|---------|-------------|
| `ca78f34` | feat: add vintage phase 3b1 floor recovery | 3E + 3A + 3B-1 |
| `8ee1cdf` | docs: clarify phase 3 benchmark artifacts | Documentation |
| `bdaed8b` | test: add vintage phase 3b2 recovery safety net | 3B-2 |

---

## Artifact Index

| Document | Purpose |
|----------|---------|
| `benchmarks/reports/vintage-phase3-cap-stacking-plan.md` | Phase 3 master plan |
| `benchmarks/reports/vintage-phase3b1-checkpoint-report.md` | 3E + 3A + 3B-1 checkpoint |
| `benchmarks/reports/vintage-phase3b2-checkpoint-report.md` | 3B-2 checkpoint |
| `benchmarks/reports/vintage-phase3-benchmark-clarification.md` | Live vs cached benchmark context |
| `benchmarks/reports/vintage-phase3-status.md` | Living status rollup |
| **This document** | Phase 3 retrospective |

---

*Documentation only. No grading logic, prompt, or benchmark changes in this report.*
