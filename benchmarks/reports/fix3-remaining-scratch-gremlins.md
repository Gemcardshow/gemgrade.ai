# Fix 3 — Remaining `scratch_limiter_high_grade` Gremlins

**Generated:** 2026-06-14  
**Branch:** `vintage/calibration-phase-1` (Fix 3 implemented locally, **not committed**)  
**Method:** Cache-first vintage replay (same as `run-vintage-calibration-phase1.mjs`) + counterfactual scratch removal (strip `surface_scratch_light` / `surface_scratch_moderate` from vision defects before `normalizeAnalysis`; no grading-logic changes).  
**Machine-readable:** `benchmarks/reports/fix3-remaining-scratch-gremlins.json`  
**Script:** `benchmarks/analyze-fix3-remaining-gremlins.mjs`

---

## Executive Summary

After Fix 3, **11** cards remain as `scratch_limiter_high_grade` gremlins (PSA ≥ 7, scratch primary limiter, GemGrade Δ ≤ −2).

| Counterfactual outcome | Count | Meaning |
|------------------------|------:|---------|
| **Scratch blocks within ±1** | **0** | Removing scratch would reach PSA ±1 |
| **Scratch blocks partial lift** | **3** | Grade improves but still Δ ≤ −2 |
| **Other cap dominates** | **8** | Removing scratch does **not** change grade |

**Conclusion:** Fix 3’s observed benchmark gain (+1 card within ±1, 17 → 11 gremlins) reflects **limiter hygiene**, not scratch being the sole grade binder on these remaining failures. **None** of the 11 would enter ±1 if scratch were fully removed today. Commit Fix 3 as a **safe limiter-cleanup prerequisite**; meaningful accuracy on this cohort requires **companion cap/floor fixes** (triad pillar clamp, poor-band cluster, uniform optimism ceiling, EX stain ceiling)—not additional scratch skepticism alone.

**Cache caveat:** 8/11 gremlins show **cache vs snapshot drift**. Stale cache replay inflates gremlin severity and keeps scratch tags Fix 3 would strip on fresh vision (e.g. Boggs, Seaver, Parker, Luzinski).

---

## Gremlin Definition

- PSA grade ≥ 7  
- Primary limiter ∈ `{ surface_scratch_light, surface_scratch_moderate }`  
- GemGrade − PSA ≤ −2  

---

## Per-Card Analysis

Legend:
- **Effective binder** = rule that sets final internal grade (from `capAudit` / `overall_derivation`), which may differ from primary limiter label.
- **Counterfactual** = remove both scratch defect tags from raw vision input; re-run full pipeline.
- **Scratch light / moderate** = tags present **after** Fix 3 on current replay path.

### 1. 1967 T CAREW — PSA 7 → Gem **2** (Δ −5)

| Field | Value |
|-------|-------|
| Primary limiter | `surface_scratch_moderate` |
| Scratch light | No |
| Scratch moderate | **Yes** (Fix 3 correctly skips) |
| Effective binder | `vintage:poor_band_notes_cluster` (cap **2**) |
| All defect tags | `corner_wear_moderate`, `surface_scratch_moderate`, `staining_light`, `edge_wear_light` |
| Replay | snapshot |

**Counterfactual (no scratch):** Gem **5** (+3), limiter → `corner_wear_moderate`, binder → `categoryFloor` (5). Still Δ −2 vs PSA 7.

**Verdict:** Poor-band cluster + moderate wear stack dominate. Scratch is primary label but cluster cap at 2 binds. Fix 3 out of scope (moderate scratch retained by design). Needs **wear/poor-band calibration**, not scratch cleanup.

---

### 2. 1971 T CASH — PSA 7 → Gem **2** (Δ −5)

| Field | Value |
|-------|-------|
| Primary limiter | `surface_scratch_moderate` |
| Scratch light | No |
| Scratch moderate | **Yes** |
| Effective binder | `vintage:poor_band_notes_cluster` (cap **2**) |
| Replay | cache (snapshot: Gem **6**, no scratch — **drift**) |

**Counterfactual (no scratch):** Gem **3** (+1), binder → `vintage:distributed_vg_wear` (3.5). Still Δ −4.

**Verdict:** Same poor-band cluster family as Carew. Snapshot already near ±1 without scratch gremlin; cache is stale/over-harsh.

---

### 3. 1953 T KENNEDY — PSA 8 → Gem **3** (Δ −5)

| Field | Value |
|-------|-------|
| Primary limiter | `surface_scratch_light` |
| Scratch light | **Yes** |
| Scratch moderate | No |
| Effective binder | `vintage:triad_light_wear_notes` (cap **3.5**) |
| Replay | cache (snapshot: Gem **6**, no scratch, limiter null — **drift**) |

**Counterfactual (no scratch):** Gem **5** (+2), binder → `defect:corner_wear_light` (cap 8). Triad note cap no longer binds; still Δ −3.

**Verdict:** Triad light-wear notes cap binds, not scratch defect cap (7.5). Removing scratch helps partially but **triad note cap** still blocks ±1 on cache. Snapshot path already much closer.

---

### 4. 1978 T ECKERSLEY — PSA 9 → Gem **5** (Δ −4)

| Field | Value |
|-------|-------|
| Primary limiter | `surface_scratch_light` |
| Scratch light | **Yes** (Ryan guard retains on uniform light-wear + scratch pair) |
| Scratch moderate | No |
| Effective binder | Pillar clamp → `overall_derivation` **5.5** (categoryFloor 5.5; scratch cap 7.5 is non-binding) |
| Replay | cache (snapshot: Gem **7**, scratch retained — **drift**) |

**Counterfactual (no scratch):** Gem **5** (Δ **0**), limiter → `corner_wear_light`.

**Verdict:** Scratch is primary **label** only; **triad/pillar clamp at 5.5** sets grade. Removing scratch does nothing on cache. Snapshot at Gem 7 suggests vision refresh + triad calibration, not more scratch stripping.

---

### 5. 1983 T SEAVER — PSA 9 → Gem **5** (Δ −4)

| Field | Value |
|-------|-------|
| Primary limiter | `surface_scratch_light` |
| Scratch light | **Yes** |
| Scratch moderate | No |
| Effective binder | Pillar clamp → `overall_derivation` **5.5** (scratch cap 7.5 non-binding) |
| Replay | cache (snapshot: Gem **5**, **no scratch**, limiter `corner_wear_light` — **drift**) |

**Counterfactual (no scratch):** Gem **5** (Δ **0**).

**Verdict:** Fix 3 already strips scratch on snapshot; cache still gremlin. Grade bound by pillar clamp, not scratch.

---

### 6. 1975 T LUZINSKI — PSA 8 → Gem **5** (Δ −3)

| Field | Value |
|-------|-------|
| Primary limiter | `surface_scratch_light` |
| Scratch light | **Yes** |
| Scratch moderate | No |
| Effective binder | Pillar clamp **5.5** (scratch cap 7.5 non-binding) |
| Replay | cache (snapshot: Gem **7**, no scratch — **drift**) |

**Counterfactual (no scratch):** Gem **5** (Δ **0**).

**Verdict:** Triad pillar stack binds. Snapshot without scratch reaches Gem 7 (within ±1).

---

### 7. 1974 T PARKER — PSA 7 → Gem **5** (Δ −2)

| Field | Value |
|-------|-------|
| Primary limiter | `surface_scratch_light` |
| Scratch light | **Yes** |
| Scratch moderate | No |
| Effective binder | Pillar clamp **5.5** |
| Replay | cache (snapshot: Gem **7**, no scratch — **drift**) |

**Counterfactual (no scratch):** Gem **5** (Δ **0**).

**Verdict:** Gremlin on stale cache only; snapshot is within ±1 with scratch stripped.

---

### 8. 1977 T DAWSON — PSA 7 → Gem **5** (Δ −2)

| Field | Value |
|-------|-------|
| Primary limiter | `surface_scratch_light` |
| Scratch light | **Yes** |
| Scratch moderate | No |
| Effective binder | `vintage:uniform_optimistic_light_wear` (cap **5.5**) |
| Replay | cache & snapshot agree |

**Counterfactual (no scratch):** Gem **5** (Δ **0**), same optimism ceiling binds.

**Verdict:** **Uniform optimism ceiling** is the binder—not scratch. Needs companion cap fix (Ryan/optimism family), not scratch removal.

---

### 9. 1983 T BOGGS — PSA 7 → Gem **5** (Δ −2)

| Field | Value |
|-------|-------|
| Primary limiter | `surface_scratch_light` |
| Scratch light | **Yes** on cache |
| Scratch moderate | No |
| Effective binder | Pillar clamp **5.5** on cache |
| Replay | cache (snapshot: Gem **7**, no scratch — **drift**) |

**Counterfactual (no scratch):** Gem **5** (Δ **0**) on cache.

**Verdict:** Fix 3 works on snapshot (Gem 7). Cache gremlin is **stale vision + triad clamp**, not missing Fix 3 logic.

---

### 10. 1985 T MCGWIRE — PSA 7 → Gem **5** (Δ −2)

| Field | Value |
|-------|-------|
| Primary limiter | `surface_scratch_light` |
| Scratch light | **Yes** |
| Scratch moderate | No |
| Effective binder | Pillar clamp **5.5** |
| Replay | cache (snapshot: Gem **7**, scratch still present — **drift**) |

**Counterfactual (no scratch):** Gem **5** (Δ **0**).

**Verdict:** Pillar clamp binds on cache. Snapshot reaches ±1 via different defect mix (stain limiter).

---

### 11. 1966 T SUPERMAN — PSA 8 → Gem **6** (Δ −2)

| Field | Value |
|-------|-------|
| Primary limiter | `surface_scratch_light` |
| Scratch light | **Yes** |
| Scratch moderate | No |
| Effective binder | `ex_band:back_stain_only_ceiling` → `overall_derivation` **6** |
| Replay | snapshot |

**Counterfactual (no scratch):** Gem **6** (Δ **0**). Scratch **re-inferred** from surface notes after tag removal; stain ceiling still binds.

**Verdict:** EX back-stain ceiling is the grade binder. Scratch skepticism alone cannot lift this card.

---

## Binding-Cap Taxonomy (11 gremlins)

| Binding family | Cards | Scratch removal helps? |
|----------------|------:|:----------------------:|
| `vintage:poor_band_notes_cluster` | Carew, Cash | Partial (+1 to +3), not to ±1 |
| `vintage:triad_light_wear_notes` | Kennedy (cache) | Partial (+2), not to ±1 |
| Triad / pillar clamp (`categoryFloor` ~5.5) | Eckersley, Seaver, Luzinski, Parker, Boggs, McGwire | **No** (Δ 0) |
| `vintage:uniform_optimistic_light_wear` | Dawson | **No** (Δ 0) |
| `ex_band:back_stain_only_ceiling` | Superman | **No** (Δ 0) |

Scratch defect cap (`defect:surface_scratch_light` @ 7.5) appears in cap audit on most light-scratch cards but **does not bind** the final grade when pillar clamp or vintage band rules sit lower.

---

## Fix 3 Scope vs Remaining Gremlins

| Scratch type | Remaining gremlins | Fix 3 behavior |
|--------------|-------------------:|----------------|
| `surface_scratch_light` | 9 | Strips when unconfirmed on NM band; retains structural evidence & Ryan guard |
| `surface_scratch_moderate` | 2 (Carew, Cash) | **Intentionally retained** — out of Fix 3 scope |

Cards **removed** from gremlin list by Fix 3 (not in remaining 11) include Drysdale PSA 9, Tyler PSA 9, Hunter PSA 9, Rose PSA 9, Clemens PSA 9, and others — confirming Fix 3 is doing real work on the cohort it targets.

---

## Commit Recommendation

### Commit Fix 3 as limiter-cleanup prerequisite — **yes**

- Technically safe (166/166 tests, MODERN 10 unchanged).  
- Delivers measurable hygiene: gremlins 17 → 11, scratch primary limiters 29 → 15, +1 within ±1.  
- Correctly preserves moderate scratch, Ryan guard, Ripken structural scratch, Eckersley guard path.

### Require companion cap/floor fix for meaningful ±1 gains on remaining 11 — **yes**

Counterfactual proves **0/11** reach ±1 without scratch. The accuracy ceiling on this set is set by:

1. **Triad / multi-pillar wear clamp** (~6 cards on cache) — highest leverage companion fix.  
2. **`vintage:poor_band_notes_cluster`** — Carew, Cash (vision severity mismatch).  
3. **`vintage:uniform_optimistic_light_wear`** — Dawson.  
4. **`ex_band:back_stain_only_ceiling`** — Superman.  
5. **Benchmark cache refresh** — 8/11 show snapshot paths already closer; stale cache overstates Fix 3 residual gremlin severity.

**Do not block Fix 3 commit** waiting for companion fixes. Fix 3 is a prerequisite that stops false scratch primaries from masking the real binders above. Ship Fix 3; schedule **Fix 4 / triad-pillar calibration** (or equivalent) as the next accuracy lever for this cohort.

---

## Suggested Next Research (no code changes)

1. Re-run 72-card replay after cache refresh from current vision snapshots — expect gremlin count < 11.  
2. Target triad pillar clamp (`categoryFloor` 5.5 on PSA 7–9 NM profiles) for Eckersley-class cards.  
3. Leave `surface_scratch_moderate` paths for a separate moderate-surface gate (not Fix 3).
