# PSA 10 Benchmark Suite

Gem mint calibration set for validating GemGrade on **PSA 10 (Gem Mint)** slabs.

## What belongs here

Add cards PSA has graded **10** — the highest slab band. These cards validate that GemGrade:

- Reaches gem eligibility when all pillars and centering support it
- Does not invent defects from scan artifacts or holder glare
- Applies modern vs vintage gem thresholds correctly

**Only PSA 10 slabs** belong here. Cards graded 9 or below go in `benchmarks/psa9/` or lower suites.

## Folder layout

```
benchmarks/psa10/
  manifest.template.json
  2018-topps-trout-psa10/   # Example placeholder
    front.jpg
    back.jpg
    card.meta.json
```

Folder names **must** end with `-psa10`, e.g. `2018-topps-trout-psa10`.

## Adding a card

1. **Create a folder** `{year}-{set-slug}-{subject-slug}-psa10`.
2. **Add `front.jpg` and `back.jpg`** — high-quality slab photos; avoid heavy reflection.
3. **Complete `card.meta.json`**:
   - `cardName`, `year`, `set`, `psaGrade` (must be **10**)
   - `certNumber` — optional but recommended for gem cards
   - `notes` — verification source, known re-holder, sub-grade if visible
4. **Regenerate manifest**: `npm run benchmark:scan`
5. **Run suite**: `npm run benchmark:run -- --suite psa10`

## Card selection tips

| Good candidates | Avoid |
| --- | --- |
| Modern gem rookies with verified PSA 10 labels | BGS 10 or SGC 10 without PSA cross-reference |
| Clean vintage gems (rarer, high value) | Cards with visible flaws despite slab (mislabel audit) |
| Mix of dark-border and light-border stock | Duplicate same-set cards unless testing a specific edge case |

## Placeholder

`2018-topps-trout-psa10/` uses placeholder images. Replace before running vision.
