# Vintage Phase 1 Fix 3 — NM Scratch Skepticism Investigation Report

**Generated:** 2026-06-14  
**Branch checkpoint:** `vintage/calibration-phase-1` (Fix 1 + Fix 5; Fix 2 deferred)  
**Research script:** `benchmarks/analyze-fix3-scratch-research.mjs`  
**Raw data:** `benchmarks/reports/fix3-scratch-research-latest.json`  
**Prior work:** Fix 2 deferred — see `benchmarks/vintage-fix2-deferred.md`

---

## Executive Summary

`surface_scratch_light` **is a systematic undergrading driver** on vintage PSA 7–9 cards, but the failure mode differs from Fix 2 crease:

| Metric | Value |
|--------|------:|
| Vintage PSA 7–9 cards graded | 52 |
| Cards in scratch investigation set | 48 |
| `surface_scratch_light` / `moderate` as primary limiter | 29 |
| Gremlin `scratch_limiter_high_grade` (PSA ≥ 7, Δ ≤ −2) | **17** |
| Grades bound directly by `defect:surface_scratch_light` (cap 7.5) | **10** |
| Gremlin misses where triad cap binds instead of scratch | 1 |
| Likely false-positive scratch (generic language / clean-surface contradiction) among gremlin misses | **17/17** |

**Primary finding:** Vintage cards do **not** pass through `filterUnconfirmedSurfaceScratchDefects` (modern-only). Vision tags `surface_scratch_light` on generic language (*"few light scratches"*, *"minor scratches"*) persist and bind at **`capVintage: 7.5`**, capping PSA 9 slabs to Gem 5–7 even when notes say the card presents well.

**Secondary finding:** Benchmark **cache drift** amplifies scratch misses (Kennedy PSA 8: cache Gem 3 → snapshot Gem 6 with scratch removed). Snapshot-preferred replay improves several cards but **does not eliminate** the scratch bottleneck (Hunter PSA 9 still Gem 5 with scratch limiter on snapshot).

**Fix 3 is warranted:** Scratch skepticism is now the **top-priority** vintage accuracy lever for PSA 7–9, superseding deferred Fix 2 (crease).

---

## Code Path Analysis

| Path | Era | Behavior |
|------|-----|----------|
| `filterUnconfirmedSurfaceScratchDefects` | **modern only** | Strips `surface_scratch_light` without `hasConfirmedSurfaceScratchEvidence` |
| `reconcileModernReflectiveScratchArtifacts` | modern only | Glossy/chrome false-scratch strip |
| `ensurePrimaryLimiterDefect` | all | Blocks scratch limiter injection without confirmed evidence — but tag already in defects list |
| `SURFACE_SCRATCH_EXPLICIT_EVIDENCE` | vintage notes | Broad patterns include generic `\bscratch(ed\|es\|ing)\b` — weaker than modern glossy strong-evidence gate |
| `defects.js` `surface_scratch_light.capVintage` | vintage | **7.5** — binds NM cards when tag is primary limiter |

Modern production applies skepticism; vintage does not. Fix 3 should add a **vintage-only** NM scratch skepticism path mirroring `hasConfirmedSurfaceScratchEvidence` without touching modern paths.

---

## Gremlin Misses — Scratch Primary Limiter (17 cards)

| Card | PSA | Gem | Δ | Binding rule | Structural scratch? | Generic / clean note? |
|------|----:|----:|--:|--------------|:-------------------:|:---------------------:|
| 1953 T KENNEDY | 8 | 3 | −5 | `vintage:poor_band_notes_cluster` | No | Generic |
| 1967 T CAREW | 7 | 2 | −5 | `vintage:poor_band_notes_cluster` | No | Escalated to `surface_scratch_moderate` |
| 1971 T CASH | 7 | 2 | −5 | `vintage:triad_light_wear_notes` | No | Moderate scratch |
| 1968 T DRYSDALE | 9 | 5 | −4 | **`defect:surface_scratch_light`** | No | Generic + "clear printing" |
| 1969 T ROSE | 9 | 5 | −4 | **`defect:surface_scratch_light`** | No | "few light scratches… do not detract" |
| 1978 T ECKERSLEY | 9 | 5 | −4 | **`defect:surface_scratch_light`** | No | Generic |
| 1983 T SEAVER | 9 | 5 | −4 | **`defect:surface_scratch_light`** | No | "minor scratches, not affecting presentation" |
| 1984 F CLEMENS | 9 | 5 | −4 | **`defect:surface_scratch_light`** | No | "Clean surface with a few minor scratches" |
| 1975 T LUZINSKI | 8 | 5 | −3 | **`defect:surface_scratch_light`** | No | Generic |
| 1981 T GIBSON | 9 | 6 | −3 | `ex_band:back_stain_only_ceiling` | No | Scratch limiter; stain ceiling binds |
| 1981 T TYLER | 9 | 6 | −3 | `ex_band:back_stain_only_ceiling` | No | Same pattern |
| 1966 T SUPERMAN | 8 | 6 | −2 | `vintage:uniform_optimistic_light_wear` | No | Generic |
| 1967 T HUNTER | 9 | 7 | −2 | **`defect:surface_scratch_light`** | No | "Light scratches; otherwise clean" |
| 1974 T PARKER | 7 | 5 | −2 | **`defect:surface_scratch_light`** | No | Generic |
| 1977 T DAWSON | 7 | 5 | −2 | `ex_band:back_stain_only_ceiling` | No | Stain ceiling |
| 1983 T BOGGS | 7 | 5 | −2 | **`defect:surface_scratch_light`** | No | **"Surface is clean with minimal visible issues"** |
| 1985 T MCGWIRE | 7 | 5 | −2 | **`defect:surface_scratch_light`** | No | Generic |

---

## Snapshot vs Cache Impact (gremlin misses with snapshots)

| Card | Cache Gem / limiter | Snapshot Gem / limiter | Scratch removed on snapshot? |
|------|---------------------|------------------------|:----------------------------:|
| 1953 T KENNEDY | 3 / `surface_scratch_light` | **6** / none | **Yes** |
| 1971 T CASH | 2 / `surface_scratch_moderate` | **6** / `surface_scratch_light` | Partial (escalation reduced) |
| 1978 T ECKERSLEY | 5 / scratch | **7** / scratch | No — still scratch limiter |
| 1983 T SEAVER | 5 / scratch | 3 / scratch | No |
| 1975 T LUZINSKI | 5 / scratch | **7** / scratch | No (grade up, scratch remains) |
| 1974 T PARKER | 5 / scratch | **7** / `staining_light` | Scratch not limiter |
| 1983 T BOGGS | 5 / scratch | **7** / `corner_wear_light` | **Yes** — clean-surface note |
| 1985 T MCGWIRE | 5 / scratch | **7** / `staining_light` | Scratch not limiter |
| 1967 T HUNTER | 7 / scratch | **5** / scratch | No — snapshot worse (triad interaction) |

**Interpretation:** Cache hygiene helps Kennedy/Boggs/Parker/McGwire but is insufficient alone. A vintage NM scratch gate would address the remaining snapshot-persistent cases (Drysdale, Rose, Eckersley, Seaver, Clemens, Hunter, etc.).

---

## Per-Card Detail — Top Scratch-Binding Cases (cap 7.5)

### 1983 T BOGGS — PSA 7 → Gem 5 (Δ −2) — Strong skepticism candidate

- **Surface note (snapshot):** *"Surface is clean with minimal visible issues."*
- **Vision tag:** `surface_scratch_light` in cache; snapshot removes scratch as limiter → Gem 7
- **Language:** Clean-surface contradiction; no structural scratch
- **Origin:** Cache drift + vision over-tag
- **Human review:** Scratch likely false on NM slab

### 1967 T HUNTER — PSA 9 → Gem 7 (cache) / Gem 5 (snapshot)

- **Surface note:** *"Light scratches detected; otherwise clean surface."*
- **Binding:** `defect:surface_scratch_light` cap 7.5
- **Language:** Generic scratch only; clean-surface contradiction
- **Fix 3 target:** Strip or reclassify to `print_line` when "otherwise clean" qualifies

### 1969 T ROSE — PSA 9 → Gem 5 (Δ −4)

- **Surface note:** *"Generally clean surface with a few light scratches that do not detract significantly."*
- **Binding:** `defect:surface_scratch_light`
- **Language:** Explicit non-detraction language — classic NM false scratch

### 1984 F CLEMENS — PSA 9 → Gem 5 (Δ −4)

- **Surface note:** *"Clean surface with a few minor scratches."*
- **Language:** Clean + generic scratch — skepticism candidate

---

## Cards Within ±1 Despite Scratch (control cases)

| Card | PSA | Gem | Limiter | Notes |
|------|----:|----:|---------|-------|
| 1982 T RIPKEN | 7 | 7 | `surface_scratch_light` | *"Light scratches… no major creases"* — scratch may be legitimate at PSA 7 |
| 1967 T HUNTER | 9 | 7 | scratch | Borderline; gate might lift to 8–9 if stripped |

Preserve confirmed scratches on cards where PSA slab aligns (Ripken PSA 7).

---

## Confirmed vs Non-Confirming Language

### Structural (retain `surface_scratch_light`)

- Linear / hairline scratch
- Scratch crossing artwork / background / image
- Scratch visible at multiple angles / under angled light
- High-confidence vision tag + explicit scratch location in note **without** clean-surface contradiction

### Non-confirming (demote to `print_line` or strip)

| Pattern | Example cards |
|---------|---------------|
| Generic "light/minor/few scratches" | Rose, Clemens, Seaver, Drysdale, Hunter |
| Clean-surface contradiction | Boggs, Rose, Clemens, Hunter ("otherwise clean") |
| Scratch non-detraction language | Rose ("do not detract significantly") |
| Print line / roller conflation | Drysdale ("clear printing") |
| Explicit denial | Ripken ("no major creases" — retain only if crossing-artwork evidence) |
| Marks without scratch | Marshall (triad binds, not scratch) |

---

## Minimum Evidence Gate Recommendation

**Retain `surface_scratch_light` on vintage PSA 7–9 when:**

1. Surface note contains **structural** scratch language (linear/hairline, crossing artwork, multi-angle), OR
2. Vision `surface_scratch_light` with **high** confidence AND explicit scratch in note AND no `SURFACE_CLEAN_SCRATCH_CONTRADICTION` match.

**Strip or reclassify when (vintage NM path):**

1. PSA 7–9 presentation: min(corners, edges) ≥ 6.5 and surface vision ≥ 6.5
2. Note matches clean/presents-well contradiction patterns without structural scratch
3. Only generic scratch language (`MODERN_GLOSSY_GENERIC_SCRATCH_LANGUAGE` equivalents)
4. Sole limiter would be scratch and other pillars ≥ 7

**Do not strip:**

- `surface_scratch_moderate` with continuous/deep scratch wording (Carew — separate EX/VG path)
- PSA 4–6 EX band with confirmed scratch + `ex_band:crease_surface_relief`-style relief already in stack
- Confirmed crossing-artwork evidence regardless of era

---

## Relationship to Other Fixes

| Fix | Interaction |
|-----|-------------|
| Fix 1 (stain) | Gibson/Tyler/Dawson — stain ceiling binds, scratch is limiter label but not always binding cap |
| Fix 2 (crease) | **Deferred** — no longer top priority |
| Fix 5 (triad) | Marshall/Cash — triad cap binds before scratch; scratch gate won't alone fix triad cluster |
| Modern glossy gate | Template for Fix 3 vintage-only implementation |

---

## Missing Data

PSA 7–9 cards without cache or snapshot are listed in `fix3-scratch-research-latest.json` → `missing`.

---

## Conclusion

**Yes** — `surface_scratch_light` systematically undergrades PSA 7–9 vintage cards. **10 of 17** gremlin misses bind directly on the scratch defect cap (7.5). The fix is a **vintage-only NM scratch skepticism gate** aligned with modern `hasConfirmedSurfaceScratchEvidence`, not cache regeneration alone.
