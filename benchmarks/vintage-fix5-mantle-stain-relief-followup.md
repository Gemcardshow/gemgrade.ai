# Follow-up: Mantle PSA 7 → GemGrade 9 (`nm_band:gem_stain_relief` interaction)

**Status:** TODO — do not implement with Fix 5  
**Context:** Fix 5 conservative commit (`fix: add vintage NM triad band gate`)  
**Generated:** 2026-06-12

---

## Summary

**1962 T Mantle PSA 7** overshoots to **GemGrade 9** (Δ +2, outside ±1) after Fix 5 + Fix 1 stack. This is **not** a Fix 5 triad-only issue.

| Stage | PSA | Mechanism |
| --- | ---: | --- |
| Pre–Fix 5 (triad normalize clamp) | **5** | `reconcileTriadLightWearProfile` → C/E/S **5.5** |
| Fix 5 only (no stain relief flag) | **7** | Triad skip preserves vision **8 / 7.5 / 7.5** |
| Fix 5 + Fix 1 (current) | **9** | `nm_band:gem_stain_relief` **floor 9** |

Fix 5 alone restores the **PSA 7** anchor. The extra lift to 9 comes from **`nm_band:gem_stain_relief`** in `psa-calibration.js` when `vintageCosmeticBackStainRelief` is set and NM presentation gates pass.

Among all **PSA 7–8** vintage benchmark cards, Mantle is the **only** card with GemGrade **> PSA + 1** and the **only** PSA 7–8 card graded **9**.

---

## Recommended future fix

Tighten **`nm_band:gem_stain_relief`** so cosmetic back-stain relief **cannot floor above 8** unless:

- `surface >= 8.5`, **and**
- all wear pillars (`corners`, `edges`, `surface`) **>= 8**

This keeps Fix 5 triad relief intact while preventing a PSA 7 NM slab from inheriting a gem-mint floor via back-toning reconcile alone.

---

## Out of scope (explicit)

- Do **not** add a Fix 5 triad upper ceiling — triad skip alone grades Mantle at **7**
- Do **not** change Gem Mint bridge in the same pass
- Do **not** revert Fix 1 cosmetic back-stain demotion

---

## Verification when implemented

- **1962 T Mantle PSA 7:** GemGrade **7–8** (within ±1), not 9
- **Fix 1 stain relief cards** (Eckersley, Gibson, etc.): no regression below within ±1
- **MODERN 10 / vintage gates:** unchanged
