# PSA 9 Benchmark Suite

Mint calibration set for validating GemGrade on **PSA 9 (Mint)** slabs.

## What belongs here

Add cards PSA has graded **9** — visually near-perfect with at most one minor flaw (slight centering, tiny print dot, micro corner touch). These cards stress-test:

- Centering caps without over-penalizing mint presentation
- Distinguishing factory print lines from surface damage
- Modern vs vintage mint tolerance differences

**Do not** add PSA 8 or PSA 10 cards here. Use `benchmarks/psa7-8/` or `benchmarks/psa10/` respectively.

## Folder layout

```
benchmarks/psa9/
  manifest.template.json
  1989-upper-deck-griffey-psa9/   # Example placeholder
    front.jpg
    back.jpg
    card.meta.json
```

Folder names **must** end with `-psa9`, e.g. `1989-upper-deck-griffey-psa9`.

## Adding a card

1. **Create a folder** `{year}-{set-slug}-{subject-slug}-psa9`.
2. **Add `front.jpg` and `back.jpg`** — well-lit slab or raw scans, minimal glare.
3. **Complete `card.meta.json`**:
   - `cardName`, `year`, `set`, `psaGrade` (must be **9**)
   - `certNumber` — optional
   - `notes` — document the single limiting factor PSA cited if known (centering, surface, etc.)
4. **Regenerate manifest**: `npm run benchmark:scan`
5. **Run suite**: `npm run benchmark:run -- --suite psa9`

## Card selection tips

| Good candidates | Avoid |
| --- | --- |
| Iconic modern rookies at PSA 9 | PSA 8 copies (use psa7-8) |
| Vintage with one minor centering issue | Heavily worn vintage |
| Cards where GemGrade historically overshoots to 10 | Uncertified raw scans without slab reference |

## Placeholder

`1989-upper-deck-griffey-psa9/` uses placeholder images. Replace before running vision.
