# Vintage Calibration Phase 2 — Planning Report

**Branch:** `phase2/vintage-research` (from `main` @ `26def17`)  
**Planning date:** 2026-06-14  
**Last updated:** 2026-06-14  
**Status:** Phase 2C **shipped**; Phase 2D **deferred**; Phase 2B **research complete** (implementation pending)  
**Authority:** Phase 1 frozen baselines only

### Phase 2 progress snapshot @ `8e8b81f`

| Workstream | Status | Vintage ±1 |
|------------|--------|------------|
| **2A** Cache refresh + re-baseline | Done | 40→41/72 |
| **2C** Mantle `gem_stain_relief` floor cap | **Shipped** (`8e8b81f`) | 41/72 |
| **2D** Martin writing severity (analyze) | **Deferred** — see `benchmarks/vintage-phase2d-deferred.md` | 41/72 unchanged |
| **2B** PSA 7–9 pillar clamp companion | **Research complete** — see pillar clamp report | TBD impl. |
| **Parallel** Gem Mint separation | Independent research branch | — |

**2D defer reason:** Analyze-only gate improves tags but not ±1 (Martin 2→3 only); writing inflation risk; revisit with compound-cap research.

**2B next step:** Implement vision-aware triad skip companion (not naive pillar lift — B1 counterfactual 0/12 reach ±1).

---

## Frozen Baselines (do not drift)

| Layer | Commit | Verification |
|-------|--------|--------------|
| **Vintage Phase 1** | **`fb4cf93`** | `git merge-base --is-ancestor fb4cf93 main` ✓ |
| **Modern production** | **`15a078c`** | `git merge-base --is-ancestor 15a078c main` ✓ |
| **Main merge** | `26def17` | Merge PR #2 — vintage/calibration-phase-1 → main |

### Expected metrics @ `fb4cf93`

| Gate | Baseline |
|------|----------|
| Engine tests | 166/166 pass |
| Vintage 72-card within ±1 | **33/72 (45.8%)** |
| PSA 3–6 within ±1 | 13/17 (76.5%) |
| MODERN 10 within ±1 | **31/32 (96.9%)** |
| `scratch_limiter_high_grade` gremlins | **11** |
| Mean error (Gem − PSA) | −1.61 |
| Inflated / Deflated | 8↑ · 50↓ |

**Verification commands (run before any Phase 2 implementation):**

```bash
npm run test:api
node benchmarks/run-vintage-calibration-phase1.mjs
node benchmarks/run-modern10-baseline-replay.mjs
```

**Hard constraints for Phase 2:**

- Do not modify modern production paths frozen at `15a078c`.
- Do not amend Phase 1 fixes (Fix 1, Fix 5, Fix 3) without explicit Phase 2 scope.
- Fix 2 and Fix 4 remain **deferred** until un-deferred by name in a Phase 2 implementation plan.
- Gem Mint bridge work stays on `research/gem-mint-separation` — not merged into vintage calibration without separate approval.

**Phase 1 artifacts:** `benchmarks/vintage-phase1-FREEZE.md`, `benchmarks/reports/vintage-phase1-final-summary.md`

---

## Phase 2 Objective

Improve **PSA 7–9 vintage accuracy** and **measurement reliability** without regressing PSA 4–6 guards or modern production. Phase 1 closed the NM scratch/triad/stain limiter hygiene gap; Phase 2 targets **pillar clamp stacks**, **benchmark cache drift**, and **isolated inflation/deflation outliers**.

---

## 1. Benchmark Cache Refresh Strategy

### Problem

Multiple Phase 1 research scripts show **cache vs snapshot drift** inflating gremlin counts and obscuring true calibration impact:

| Research | Drift finding |
|----------|---------------|
| Fix 3 remaining gremlins | **8/11** scratch gremlins score higher on cache than snapshot |
| Fix 2 crease (deferred) | Spahn, Yount, Young — crease tag in cache only |
| Fix 5 triad | Kennedy cache Gem 3 vs snapshot Gem 6 |

Cache-first replay (`run-vintage-calibration-phase1.mjs`) prefers `benchmarks/cache/{card-id}.json` over `benchmarks/live-runs/vision-snapshots/{card-id}.json`. Stale cache preserves pre–Fix 1/3 vision tags and pessimistic subgrades.

### High-priority drift cards (refresh first)

| Card | PSA | Cache Gem | Snapshot Gem | Issue |
|------|----:|----------:|-------------:|-------|
| 1953 T Kennedy | 8 | 3 | 6 | Triad + scratch; Fix 3 strips on snapshot |
| 1983 T Boggs | 7 | 5 | 7 | Scratch stripped on snapshot |
| 1974 T Parker | 7 | 5 | 7 | Pillar clamp; no scratch on snapshot |
| 1975 T Luzinski | 8 | 5 | 7 | Same pattern |
| 1983 T Seaver | 9 | 5 | 5* | Scratch removed on snapshot |
| 1978 T Eckersley | 9 | 5 | 7 | Ryan guard + pillar clamp |
| 1971 T Cash | 7 | 2 | 6 | Poor-band cluster; cache harsh |
| 1960 T Spahn | 8 | — | — | Crease cache drift (Fix 2 research) |

\*Seaver snapshot still Gem 5 but different limiter mix — refresh still needed for consistent measurement.

### Recommended strategy

**Phase 2A — Infrastructure (no grading logic)**

1. **Inventory** — Script: compare cache vs snapshot for all 72 vintage cards; output diff report (gem, limiter, defect tags, category scores).
2. **Snapshot-prefer mode** — Add `--prefer-snapshot` flag to `run-vintage-calibration-phase1.mjs` for research replay when both exist; keep cache-first as default until refresh complete.
3. **Refresh policy** — Regenerate cache from live vision OR promote snapshot `rawVision` into cache format when:
   - Snapshot exists and |Δ cache − Δ snapshot| ≥ 2 vs PSA, **or**
   - Cache contains tags removed by Fix 1/3 on snapshot replay, **or**
   - Card listed in Fix 2/3 gremlin reports with `cacheSnapshotDrift: true`.
4. **Freeze refreshed cache** — Commit updated `benchmarks/cache/*.json` with metadata field `visionSource`, `refreshedAt`, `engineCommit: fb4cf93`.
5. **Re-baseline** — Re-run Phase 1 verification gates; document new ±1 count **before** any Phase 2 code.

### Expected impact (measurement only)

- Gremlin count may drop **11 → ~6–8** without code changes.
- Vintage ±1 may rise **33 → 34–36/72** from measurement correction alone.
- **Do not** treat cache refresh gains as calibration wins in Phase 2 implementation acceptance.

### Deliverables (Phase 2A)

| Artifact | Purpose |
|----------|---------|
| `benchmarks/analyze-vintage-cache-drift.mjs` | Automated cache vs snapshot diff |
| `benchmarks/reports/vintage-cache-drift-report.md` | Per-card drift classification |
| Updated cache files | Committed fixtures @ post-refresh |

### Risk

- Low — no engine changes.
- Live API re-runs may introduce new vision variance; prefer **frozen snapshots** where available.

---

## 2. PSA 7–9 Pillar Clamp Companion Opportunities

### Problem (post–Fix 3)

Fix 3 removed false scratch primaries but **0/11 remaining scratch gremlins** reach ±1 if scratch tags are removed. Effective binder is **`categoryFloor` ~5.5** (triad normalize clamp) or vintage band caps — not `defect:surface_scratch_light` @ 7.5.

| Binding family | Gremlin cards | Scratch removal helps? |
|----------------|-------------:|:----------------------:|
| Triad / pillar clamp (~5.5) | Eckersley, Seaver, Luzinski, Parker, Boggs, McGwire | **No** |
| `vintage:uniform_optimistic_light_wear` | Dawson | **No** |
| `vintage:poor_band_notes_cluster` | Carew, Cash | Partial only |
| `vintage:triad_light_wear_notes` | Kennedy (cache) | Partial only |
| `ex_band:back_stain_only_ceiling` | Superman | **No** |

### Root mechanism

Two-layer stack on NM vintage presentations:

1. **Normalize:** `reconcileTriadLightWearProfile` clamps pillars to **5.5** when triad wear notes on ≥3 pillars and NM skip fails.
2. **Calibration:** `vintage:triad_light_wear_notes`, `vintage:uniform_optimistic_light_wear`, or multi-pillar wear caps bind below vision floor.
3. **Fix 5** NM triad skip helps when vision floor ≥ 6.5 and NM gates pass — but **post-normalize** wear floor still ≤ 5.5 on many cards, blocking skip.

Scratch cap at 7.5 is often **non-binding** — primary limiter label is misleading.

### Phase 2B research targets (before implementation)

| Workstream | Hypothesis | Candidate cards |
|------------|------------|-----------------|
| **B1 — Post-clamp NM floor** | When vision min ≥ 6.5 and Fix 3 stripped scratch, categoryFloor should not stay 5.5 | Boggs, Parker, Luzinski, Eckersley |
| **B2 — Uniform optimism ceiling** | `vintage:uniform_optimistic_light_wear` @ 5.5 binds when corner+scratch pair removed | Dawson |
| **B3 — Ryan guard interaction** | Isolating corner_wear_light after scratch strip triggers optimism ceiling | Eckersley (Fix 3 Ryan guard) |
| **B4 — EX slab recovery expansion** | `applyVintageExSlabBandRecovery` blocked when poor-band caps already in audit | Kennedy, Carew |

### Proposed implementation scope (future — not Phase 2A)

**Conservative companion to Fix 3/5** — not a blanket cap removal:

1. After Fix 3 scratch strip + Fix 5 NM skip, re-evaluate categoryFloor using **visionCategoryScores** when normalized floor ≤ 5.5 but vision min ≥ 6.5 and no moderate+ defects.
2. Extend uniform optimism ceiling skip when EX/VG protected and light-only defect set.
3. Hard exclude: Carew/Cash poor-band cluster, Bird low-PSA inflation path, Mantle stain relief interaction.

### Estimated impact (after cache refresh + implementation)

| Scenario | Vintage ±1 estimate |
|----------|-------------------|
| Research counterfactual only | +2–4 cards |
| Conservative implementation | +2–3 cards |
| Combined with cache refresh | **36–38/72** (target band) |

### Acceptance gates (implementation)

- No regression on PSA 4–6 (13/17 or 12/15 maintained).
- MODERN 10: 31/32 unchanged.
- Scratch gremlins ≤ 11 (prefer lower after cache refresh).
- Bird PSA 4 must not inflate; Mantle PSA 6 must not inflate further.

### Deliverables (Phase 2B research) — **complete**

| Artifact | Purpose |
|----------|---------|
| `benchmarks/analyze-phase2b-pillar-clamp-research.mjs` | Binding classification + B1 counterfactual |
| `benchmarks/reports/vintage-pillar-clamp-companion-report.md` | Per-card binding + workstream analysis |
| `benchmarks/reports/vintage-pillar-clamp-companion-regression-plan.md` | F2B-1…F2B-14 before code |
| `benchmarks/reports/vintage-pillar-clamp-root-cause-summary.json` | Machine-readable summary |

---

## 3. Mantle `nm_band:gem_stain_relief` Follow-Up

### Context

**1962 T Mantle PSA 7** (vintage benchmark, TEST 7 suite — cross-band reference) overshoots to **Gem 9** after Fix 1 + Fix 5 stack. Documented in `benchmarks/vintage-fix5-mantle-stain-relief-followup.md`.

| Stage | GemGrade | Mechanism |
|-------|--------:|-----------|
| Pre–Fix 5 | 5 | Triad normalize clamp → 5.5 |
| Fix 5 only | **7** | Triad skip preserves vision 8/7.5/7.5 |
| Fix 1 + Fix 5 | **9** | `nm_band:gem_stain_relief` floor **9** |

Mantle is the **only PSA 7–8 vintage card** with Gem > PSA + 1 and the **only** PSA 7–8 card graded **9**.

**Note:** 1968 T Mantle PSA 6 (TEST 6) grades Gem 7 (+1 within ±1) via scratch cap — separate card, Mantle follow-up logic explicitly **out of scope** for Phase 2 unless separately scoped.

### Recommended fix (Phase 2C — narrow engine change)

Tighten `nm_band:gem_stain_relief` in `psa-calibration.js` (~L1977):

- Cosmetic back-stain relief **cannot floor above 8** unless:
  - `surface >= 8.5`, **and**
  - all wear pillars (`corners`, `edges`, `surface`) **>= 8**
- Preserve Fix 1 demotion path and Fix 5 triad skip.

### Verification targets

| Card | PSA | Current Gem | Target Gem |
|------|----:|------------:|-----------:|
| 1962 T Mantle | 7 | 9 | **7–8** |
| 1978 T Eckersley | 9 | 5–7* | no regression |
| 1981 T Gibson | 9 | 5–7* | no regression |

\*Depends on cache refresh.

### Risk

- **Low** if floor cap is isolated to `nm_band:gem_stain_relief`.
- **Do not** add Fix 5 triad upper ceiling — triad skip alone yields Gem 7 on Mantle.
- **Do not** revert Fix 1 cosmetic back-stain demotion.

### Phase 2 ordering

Implement **after** cache refresh (2A) and **before or parallel with** pillar clamp (2B) — inflation guard should land early.

---

## 4. Martin Writing Severity Analysis

### Context (Fix 4 research — deferred engine caps)

**1953 T Martin PSA 5** → Gem **2** (Δ −3). Primary miss on dedicated PSA 4–6 cohort after Phase 1 review.

| Field | Value |
|-------|-------|
| PSA | 5 |
| GemGrade | 2 |
| Primary limiter | `writing_mark_severe` |
| Effective binder | `defect:writing_mark_severe` (cap 2) |
| categoryFloor | 2.5 |
| EX/VG protected | No |

**Defect tags:** `writing_mark`, `writing_mark_severe`, `edge_fraying_major`, `corner_wear_moderate`

**Category notes (contradiction):**

| Pillar | Note excerpt |
|--------|--------------|
| Surface | "clean with mild imperfections; noticeable writing on the back" |
| Edges | "visible fraying … moderate wear" |
| Corners | "light wear … some rounding" |

### Classification

**Unnecessary deflation** — engine cap is correct **given tags**; vision/analyze over-promotes severity:

- `writing_mark_severe` + `edge_fraying_major` drive compound/severe caps.
- Surface note language does not support **severe** writing on front.
- Slab PSA 5 implies allowance-level back writing, not poor-band severe stack.

### Phase 2D approach (analyze-first)

**Prefer analyze.js severity gate over engine cap relaxation** (Fix 4 deferred rationale):

1. **Writing severity reconcile** — Downgrade `writing_mark_severe` → `writing_mark` when:
   - Writing localized to back in notes,
   - Surface note denies front ink / describes clean surface,
   - No "heavy ink", "large marking", "pen through" language.
2. **Edge fraying guard** — Apply Rhodes-class note guard before promoting `edge_fraying_major` when edge note denies severe fraying.
3. **Re-run EX paths** — `back_only_writing:surface_relief` should bind ~5 for PSA 5 slab after downgrade.

### Counterfactual

If `writing_mark_severe` removed and `edge_fraying_major` downgraded: est. Gem **5** (matches PSA).

### Estimated impact

| Cohort | Lift |
|--------|------|
| PSA 4–6 dedicated | **+1 within ±1** (Martin) |
| Full 72-card | +0 to +1 |
| Cross-band writing false positives | TBD — research McCovey, Cochrane patterns |

### Out of scope

- McCovey PSA 4 (legitimate severe compound — uncertain/manual review).
- Bird PSA 4 inflation — separate low-PSA ceiling guard.

### Deliverables (Phase 2D research) — **complete, implementation deferred**

| Artifact | Purpose |
|----------|---------|
| `benchmarks/analyze-phase2d-martin-writing.mjs` | Tag vs note contradiction scan |
| `benchmarks/reports/vintage-martin-writing-report.md` | Martin + cohort analysis |
| `benchmarks/reports/vintage-martin-writing-regression-plan.md` | F2D test plan |
| `benchmarks/reports/vintage-martin-writing-root-cause-summary.json` | Machine-readable summary |
| `benchmarks/vintage-phase2d-deferred.md` | Defer record + revisit criteria |

---

## 5. Gem Mint Bridge Research Scope

### Separation from vintage Phase 2

Gem Mint work targets **MODERN PSA 9 vs PSA 10 separation** — not vintage calibration. It runs on branch `research/gem-mint-separation` with engine frozen per `benchmarks/gem-mint-research/FREEZE.md`.

| | Vintage Phase 2 | Gem Mint bridge |
|--|-----------------|-----------------|
| **Era** | Vintage pre-1990 | Modern ≥ 1990 |
| **Branch** | `phase2/vintage-research` | `research/gem-mint-separation` |
| **Production freeze** | `15a078c` modern + `fb4cf93` vintage | `15a078c` engine |
| **Goal** | PSA 7–9 vintage ±1 | PSA 10 precision > recall |
| **Production bridge** | **Rejected until proven** | **Rejected until proven** |

### Current state

| Item | Status |
|------|--------|
| Seed benchmark | 60 cards (30 PSA 9 + 30 PSA 10) |
| Target expansion | 50–100 cards |
| Bridge A–E simulations | Analysis only in `benchmarks/reports/` |
| Bridge A false positive | 2024 B MCCOLLUM PSA 9 |
| Bridge A recovery | 3/4 known PSA 10 near-misses |

### Research scope (unchanged — parallel track)

**In scope:**

- Offline signal analysis: note phrases, pillar distributions, centering variance, defect absence patterns.
- Scripts: `build-gem-mint-manifest.mjs`, `export-gem-mint-profiles.mjs`, `analyze-gem-mint-separation.mjs`.
- Expansion to 50–100 cards across chrome/refractor, dark-border, base stock.

**Out of scope:**

- Wiring bridge logic into `lib/grading/` or production API.
- Combining Gem Mint promotion with vintage Phase 2 commits.
- Modifying `nm_band:gem_stain_relief` in same PR as Gem 10 bridge experiments.

### Interaction with vintage Phase 2

- **Mantle `gem_stain_relief`** is vintage-only — implement on `phase2/vintage-research`, not gem-mint branch.
- **Bird `nm_band:mint_floor`** inflation is vintage/low-PSA — not Gem Mint bridge.
- If Gem Mint research produces generic "NM floor ceiling" patterns, evaluate for vintage **only** through separate Phase 2 scope doc.

### Gem Mint Phase 2 milestones (parallel)

1. Expand manifest to 80+ cards with live vision cache.
2. Re-run separation analysis — document phrases present on PSA 10 only.
3. Re-evaluate Bridge A with MCCOLLUM guard — still require 0 FP on PSA 9 cohort.
4. Publish go/no-go for production bridge — expect **no-go** until FP = 0 on expanded set.

---

## Recommended Phase 2 Sequence

| Phase | Workstream | Grading logic? | Depends on |
|-------|------------|:--------------:|------------|
| **2A** | Cache refresh + drift report | **No** | — | **Done** |
| **2A′** | Re-baseline metrics post-refresh | **No** | 2A | **Done** (41/72) |
| **2C** | Mantle `gem_stain_relief` floor cap | Yes (narrow) | 2A′ | **Shipped** |
| **2D** | Martin writing severity (analyze) | Yes (analyze) | 2A′ | **Deferred** |
| **2B** | PSA 7–9 pillar clamp companion | Yes (calibration) | 2A′, 2C | **Research done → impl. next** |
| **Parallel** | Gem Mint separation research | **No** (modern research branch) | Independent | Ongoing |

**Explicitly not in Phase 2 initial sequence:**

- Fix 4 EX/VG engine caps (deferred)
- Fix 2 crease gate (deferred)
- Blanket poor-band / triad cap removal
- 1968 Mantle PSA 6 follow-up (unless separately scoped)

---

## Success Criteria (Phase 2 exit)

| Metric | Phase 1 @ `fb4cf93` | Phase 2 target |
|--------|--------------------:|---------------:|
| Vintage within ±1 | 33/72 | **≥ 36/72** |
| MODERN 10 within ±1 | 31/32 | **31/32** (no regression) |
| Engine tests | 166 | **≥ 166** pass |
| Scratch gremlins | 11 | **≤ 8** |
| 1962 Mantle PSA 7 Gem | 9 | **7–8** |
| 1953 Martin PSA 5 Gem | 2 | **4–5** |
| PSA 4–6 within ±1 | 13/17 | **≥ 13/17** (no regression) |

---

## Artifact Index

| Phase 1 (frozen reference) | Phase 2 (this plan) |
|----------------------------|---------------------|
| `benchmarks/vintage-phase1-FREEZE.md` | `benchmarks/reports/vintage-phase2-planning-report.md` |
| `benchmarks/reports/vintage-phase1-final-summary.md` | 2A: cache drift script + report (TBD) |
| `benchmarks/reports/fix3-remaining-scratch-gremlins.md` | 2B: pillar clamp companion report ✓ |
| `benchmarks/vintage-fix5-mantle-stain-relief-followup.md` | 2C: shipped @ `8e8b81f` |
| `benchmarks/vintage-phase2d-deferred.md` | 2D: deferred + preserved artifacts |
| `benchmarks/reports/vintage-martin-writing-report.md` | 2D: research complete |
| `benchmarks/gem-mint-research/README.md` | Parallel: gem-mint separation |

---

## Phase 2 Kickoff Checklist

- [x] `main` contains Vintage Phase 1 merge (`fb4cf93` ancestor)
- [x] `main` preserves Modern production freeze (`15a078c` ancestor)
- [x] Branch `phase2/vintage-research` created from `main`
- [x] Run frozen baseline verification (171 tests @ 2C, 41/72, 31/32)
- [x] Execute Phase 2A cache drift inventory + re-baseline
- [x] Phase 2C Mantle stain relief shipped
- [x] Phase 2D research complete — **deferred** (no implementation)
- [x] Phase 2B research complete — **implementation next**
- [ ] Phase 2B implementation PR + acceptance gates (≥ 43/72)

**Next implementation:** Phase 2B vision-aware triad skip companion — not Phase 2D.

---

## Phase 2A Baseline (post–cache refresh)

**Updated:** 2026-06-14T03:10:27.844Z

| Metric | Pre-refresh (Phase 1 @ `fb4cf93`) | Post–2A refresh |
|--------|-----------------------------------:|----------------:|
| Within ±1 | 33/72 | **40/72** |
| Mean error | -1.61 | -1.13 |
| Scratch gremlins | 11 | **7** |
| Crease tag count | 6 | 5 |
| Triad cap count | 3 | 2 |
| Pillar-clamp gremlins | 28 | 19 |

**28** cache files refreshed from snapshots; backups in `benchmarks/cache/_archive/pre-phase2a/`.

**Phase 2 implementation gates** should use post–2A metrics, not pre-refresh Phase 1 headline (33/72).

See `benchmarks/reports/vintage-cache-refresh-report.md` for full before/after.
