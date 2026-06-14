# Vintage Calibration Phase 2 — Checkpoint Report

**Generated:** 2026-06-14  
**Branch:** `phase2/vintage-research` @ **`5a5dd8b`**  
**Modern production freeze:** `15a078c` — **unchanged throughout Phase 2**  
**Vintage Phase 1 freeze:** `fb4cf93` — ancestor preserved  
**Status:** Phase 2 implementation checkpoint — **2A, 2B, 2C shipped**; **2D and residual high-grade stack deferred**

---

## Summary

Phase 2 improved vintage 72-card accuracy from **33/72 → 45/72 within ±1 (+12 cards, +16.7 pp)** relative to Phase 1 @ `fb4cf93`, while MODERN 10 remained **31/32**, engine tests grew **166 → 185**, and inflation anchors (Mantle, Bird, Ryan, Martin, Smith, Williams, Howe, McCovey) were preserved.

Primary gains came from **benchmark cache refresh (2A)**, **Mantle stain-relief inflation guard (2C)**, and **vision-aware triad floor relief companion (2B)** on PSA 7–9 pillar-clamp stacks.

Remaining accuracy gaps on PSA 7–9 are dominated by **residual triad/calibration binds (Yount, Winfield, Seaver)**, **scratch gremlins with non-scratch effective binders**, **crease/writing outliers**, and **EX stain ceiling cards** — not by unimplemented Phase 2D writing severity.

---

## Checkpoint Metrics @ `5a5dd8b`

| Gate | Value |
|------|------:|
| **Engine tests** | **185/185 pass** |
| **Vintage within ±1** | **45/72 (62.5%)** |
| **PSA 7+ within ±1** | **30/52 (57.7%)** |
| **PSA 3–6 within ±1** | **13/17 (76.5%)** — unchanged vs Phase 1 |
| **MODERN 10 within ±1** | **31/32 (96.9%)** |
| **Modern false-positive tags** | **0** (`surface_scratch_light`, `staining_light`, `moderate_crease`) |
| **Mean error (Gem − PSA)** | −0.94 |
| **Inflated / Deflated** | 11↑ · 42↓ |
| **Exact match** | 19/72 (26.4%) |

### Inflation anchors (unchanged @ checkpoint)

| Card | PSA | Gem | Δ |
|------|----:|----:|--:|
| 1962 T Mantle (TEST 7) | 7 | 8 | +1 |
| 1989 F Bird | 4 | 7 | +3 |
| 1975 T Ryan | 4 | 4 | +0 |
| 1953 T Martin | 5 | 2 | −3 |
| 1951 P Smith | 6 | 6 | +0 |
| 1951 B Williams | 6 | 6 | +0 |
| 1965 T Howe | 4 | 3 | −1 |
| 1980 T McCovey | 4 | 1 | −3 |

---

## Benchmark Progression

Replay: `node benchmarks/run-vintage-calibration-phase1.mjs` (72 vintage cards, cache-first).  
MODERN 10: `node benchmarks/run-modern10-baseline-replay.mjs` (frozen `visionRaw`, modern pipeline).

| Checkpoint | Commit | Vintage ±1 | PSA 3–6 ±1 | MODERN 10 ±1 | Tests |
|------------|--------|----------:|-----------:|-------------:|------:|
| Phase 1 final | `fb4cf93` | 33/72 (45.8%) | 13/17 | 31/32 | 166 |
| Phase 2A refresh + re-baseline | `a86268c` | **40/72** → **41/72** | 13/17 | 31/32 | 166 |
| Phase 2C Mantle stain relief cap | `8e8b81f` | 41/72 | 13/17 | 31/32 | 171 |
| **Phase 2B triad floor relief** | **`5a5dd8b`** | **45/72 (62.5%)** | **13/17** | **31/32** | **185** |

**Phase 2 net (implementation only, excl. 2A measurement):** +4 within ±1 (41 → 45/72) from 2B; 2C fixed Mantle PSA 7 Gem 9 → 8 without moving ±1 headline.

### Per-suite within ±1 @ `5a5dd8b`

| Suite | Cards | Within ±1 |
|-------|------:|----------:|
| psa-1-3 | 5 | 3/5 |
| TEST 4 | 5 | 3/5 |
| TEST 5 | 5 | 4/5 |
| TEST 6 | 5 | 5/5 |
| TEST 7 | 23 | 18/23 |
| TEST 8 | 13 | 8/13 |
| TEST 9 | 16 | 4/16 |

---

## Commit History — Shipped Phase 2 Work

| Phase | Commit | Message | Grading logic? | Outcome |
|-------|--------|---------|:--------------:|---------|
| **2A** | `a86268c` | chore: establish refreshed vintage phase 2 benchmark baseline | **No** | Cache refresh + drift inventory; measurement 33 → 41/72 |
| **2C** | `8e8b81f` | fix: cap vintage gem stain relief floor | Yes (narrow) | Mantle PSA 7 Gem 9 → 8; stain floor ≤ 8 unless surface ≥ 8.5 + all wear ≥ 8 |
| **2B** | `5a5dd8b` | fix: add vision-aware vintage triad floor relief | Yes (calibration) | +4 within ±1; PSA 7+ 26 → 30/52; triad skip uses pre-clamp vision evidence |

### 2A — Benchmark cache refresh (infrastructure)

- Compared cache vs snapshot drift; refreshed high-drift fixtures.
- **Impact:** +8 cards within ±1 from measurement correction alone (33 → 41/72).
- **Artifacts:** cache drift script + report (see Phase 2 planning doc).

### 2C — Mantle `nm_band:gem_stain_relief` floor cap

- Cosmetic back-stain relief cannot floor above **8** unless surface ≥ 8.5 and all wear pillars ≥ 8.
- **Outcome:** 1962 T Mantle PSA 7 → Gem **8** (was 9); Starr and other stain-relief paths preserved per F2C tests.
- **Files:** `lib/grading/psa-calibration.js` (`qualifiesForFullGemStainReliefFloor`)

### 2B — Vision-aware triad skip companion

- `analyze.js`: records `vintageTriadNormalizeClamp` + `preTriadClampWearScores` when triad normalize crushes pillars to 5.5.
- `engine.js`: vision evidence for skip gates only; impacts/floors still from normalized scores; `applyVintageTriadSkipCategoryFloorRelief`.
- `psa-calibration.js`: vision-aware `qualifiesForVintageNmTriadCapSkip`; uniform optimism skip for Dawson-class NM light-wear (no front stain).
- **Notable lifts:** Hunter PSA 9 5→7, Drysdale 5→7, Dawson PSA 7 5→7, Meyer/Cash/Henderson partial.
- **Tests:** F2B-1…F2B-14 added (185 total).

---

## Deferred Work

### Phase 2D — Martin writing severity (analyze gate)

| Field | Value |
|-------|-------|
| **Status** | **DEFERRED** — research complete, no implementation |
| **Record** | `benchmarks/vintage-phase2d-deferred.md` |
| **Reason** | Simulated gate: 41/72 unchanged; Martin 2→3 only (still outside ±1); writing demotion inflation risk on Ryan/McCovey without compound-cap guard |
| **Artifacts** | `analyze-phase2d-martin-writing.mjs`, `vintage-martin-writing-report.md`, regression plan, root-cause JSON |

### Yount / Winfield / Seaver — residual high-grade stack

| Card | PSA | Gem @ `5a5dd8b` | Δ | Effective binder |
|------|----:|----------------:|--:|------------------|
| 1976 T Yount | 9 | 3 | −6 | `vintage:triad_light_wear_notes` @ 3.5 |
| 1972 T Winfield | 8 | 5 | −3 | `defect:corner_wear_light` + crushed floor |
| 1983 T Seaver | 9 | 5 | −4 | `defect:corner_wear_light` + crushed floor |

**Status:** **DEFERRED** — not in Phase 2B scope; 2B B1 counterfactual showed naive pillar lift insufficient for this cluster. Requires separate research on triad cap bypass when scratch + multi-pillar notes co-bind.

### Phase 1 deferred (still open)

| Fix | Topic | Record |
|-----|-------|--------|
| Fix 2 | Crease evidence gate | `benchmarks/vintage-fix2-deferred.md` |
| Fix 4 | EX/VG band gate | `benchmarks/vintage-fix4-deferred.md` |

### Parallel (not vintage Phase 2)

- **Gem Mint bridge** — `research/gem-mint-separation` / `benchmarks/gem-mint-research/` (modern PSA 9 vs 10 separation, research-only).

---

## Remaining Gremlin Inventory @ `5a5dd8b`

Source: `node benchmarks/run-vintage-calibration-phase1.mjs` → `vintage-gremlin-report.md`  
Ranked by total |Δ| impact across flagged cards.

| Rank | Gremlin ID | Label | Cards | Total \|Δ\| | Avg impact |
| ---: | --- | --- | ---: | ---: | ---: |
| 1 | `min_pillar_category_floor` | Min-pillar categoryFloor crush | 19 | 62 | 3.26 |
| 2 | `high_grade_severe_deflation` | High-grade severe deflation (PSA 7+) | 12 | 47 | 3.92 |
| 3 | `vintage_calibration_cap` | Vintage note-cluster calibration cap | 13 | 37 | 2.85 |
| 4 | `scratch_limiter_high_grade` | Scratch limiter on NM+ slab | 6 | 19 | 3.17 |
| 5 | `poor_band_inflation` | Poor-band inflation | 4 | 12 | 3.00 |
| 6 | `moderate_crease_limiter` | moderate_crease primary limiter | 2 | 6 | 3.00 |
| 7 | `ex_band_compound_deflation` | EX/VG compound cap deflation | 2 | 6 | 3.00 |
| 8 | `ex_band_inflation` | EX/VG optimism inflation | 1 | 3 | 3.00 |

### Gremlin detail — top impact cards

**Min-pillar categoryFloor crush (19 cards):** Brydge, Cobb, Groth, Martin, Moon, Carew, Hunter, Drysdale, Rose, Expos, Winfield…

**High-grade severe deflation — PSA 7+ (12 cards):** Brydge, Cobb, Groth, Moon, Carew, Rose, Winfield, **Yount**, Gibson, Tyler, Seaver, Clemens

**Vintage calibration cap (13 cards):** Brydge, Meyer, Moon, Carew, Hunter, Drysdale, Rose, Cash, **Yount**, Clemens…

**Scratch limiter on NM+ (6 cards, down from 11 @ Phase 1):** Superman, Carew, Expos, **Yount**, Eckersley, Morris

**Poor-band inflation (4 cards):** Gehrig, Maris, 1967 Mantle (PSA 1), 1980 Schmidt

**EX/VG optimism inflation (1 card):** 1989 F Bird (PSA 4 → Gem 7)

### Phase 2B residual gremlin notes

- **`scratch_limiter_high_grade`:** 6 cards remain; effective binder often non-scratch (companion caps/floors). Fix 3 hygiene retained.
- **`vintage_calibration_cap`:** 4 cards on PSA 7+ misses post-2B; Yount triad cap is primary outlier.
- **`min_pillar_category_floor`:** Count unchanged in gremlin ranker; many cards now within ±1 despite floor crush label.

---

## Tests Progression

Command: `npm run test:api`

| Checkpoint | Tests | Δ | New suites |
|------------|------:|--:|------------|
| Phase 1 final (`fb4cf93`) | 166 | — | F1, F3, F5 |
| Post–2C (`8e8b81f`) | 171 | +5 | 2C-1…2C-5 |
| **Post–2B (`5a5dd8b`)** | **185** | **+14** | **F2B-1…F2B-14** |
| **Final** | **185 pass / 0 fail** | **+19 vs Phase 1** | |

---

## Verification Commands (Phase 2 checkpoint state)

```bash
npm run test:api
node benchmarks/run-vintage-calibration-phase1.mjs
node benchmarks/run-modern10-baseline-replay.mjs
node benchmarks/analyze-phase2b-pillar-clamp-research.mjs
```

| Gate | Expected @ `5a5dd8b` |
|------|----------------------|
| Engine tests | **185/185 pass** |
| Vintage within ±1 | **45/72** |
| PSA 7+ within ±1 | **30/52** |
| PSA 3–6 within ±1 | **13/17** |
| MODERN 10 within ±1 | **31/32** |
| Modern FP tags | **0** |
| Scratch gremlins | **6** (down from 11 @ Phase 1) |

---

## Phase 2 Closure Statement

Phase 2 **implementation scope is complete** for workstreams 2A, 2B, and 2C. Vintage accuracy target band (**≥ 43/72**) was exceeded at **45/72**. Modern production and PSA 4–6 guards held.

**Do not extend Phase 2 grading logic** without a new scoped plan. Next research (if any) should address:

1. **Yount / Winfield / Seaver** residual triad + corner-wear stack (separate from 2B companion).
2. **Phase 2D** writing severity — only with compound-cap / low-PSA ceiling guard.
3. **EX stain recovery** (Gibson, Tyler) — optional B4 follow-up from pillar clamp research.
4. **Fix 2 / Fix 4** — remain deferred from Phase 1.

---

## Artifact Index

| Topic | Path |
|-------|------|
| Phase 2 planning | `benchmarks/reports/vintage-phase2-planning-report.md` |
| Phase 2B research | `benchmarks/reports/vintage-pillar-clamp-companion-report.md` |
| Phase 2D deferred | `benchmarks/vintage-phase2d-deferred.md` |
| Phase 1 freeze | `benchmarks/vintage-phase1-FREEZE.md` |
| Phase 1 checkpoint | `benchmarks/reports/vintage-phase1-checkpoint-report.md` |
| Latest vintage replay | `benchmarks/reports/vintage-benchmark-report.md` |
| Gremlin inventory | `benchmarks/reports/vintage-gremlin-report.md` |
