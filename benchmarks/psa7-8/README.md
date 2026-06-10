# PSA 7–8 Benchmark Suite

Near-mint calibration set for validating GemGrade on **PSA 7 (NM)** and **PSA 8 (NM-MT)** slabs.

## What belongs here

Add cards that PSA has graded **7 or 8** and where you can verify the slab grade from the label or cert lookup. Prefer a mix of:

| Band | Typical wear profile | Examples |
| --- | --- | --- |
| **PSA 7** | Light corner/edge wear, minor centering or surface flaws, still strong eye appeal | 1970s–80s commons with slight rounding, vintage with minor print defects |
| **PSA 8** | Very minor flaws only; centering or one category slightly off gem | Clean modern issues, well-centered vintage with tiny corner touch |

**Include both vintage and modern** where possible. Avoid cards that also belong in PSA 4–6 (heavy wear) or PSA 9–10 (virtually flawless).

## Folder layout

Each card lives in its own subfolder under `benchmarks/psa7-8/`:

```
benchmarks/psa7-8/
  manifest.template.json    # Copy fields from here when adding cards manually
  1972-topps-seaver-psa7/   # Example placeholder — replace with real scans
    front.jpg
    back.jpg
    card.meta.json          # Optional metadata (set, cert, notes)
```

Folder names **must** end with `-psa{N}` where `N` is the known slab grade (`7` or `8`), e.g. `1972-topps-seaver-psa7`.

## Adding a card

1. **Create a folder** named `{year}-{set-slug}-{player-slug}-psa{grade}` (lowercase, hyphens).
2. **Add images**: `front.jpg` and `back.jpg` (JPEG preferred; PNG/WebP also supported by the scanner).
3. **Fill in `card.meta.json`** (copy from the example folder):
   - `cardName` — display name (e.g. `"1972 Topps Tom Seaver"`)
   - `year` — production year (number)
   - `set` — full set name (e.g. `"1972 Topps"`)
   - `psaGrade` — **7** or **8** (must match folder suffix)
   - `certNumber` — optional PSA cert #
   - `notes` — why this card is in the suite, known quirks, slab verification URL
4. **Regenerate the root manifest** from repo root:
   ```bash
   npm run benchmark:scan
   ```
5. **Run the benchmark** when ready (requires `OPENAI_API_KEY`):
   ```bash
   npm run benchmark:run -- --suite psa7-8
   ```

## Success criteria (future calibration)

When this suite is populated, target metrics (same as PSA 4–6):

- **Within ±1** of slab grade on most cards
- **Exact hits** on clean NM/NM-MT examples
- No systematic inflation on centering-only flaws or light edge touch

## Placeholder

The `1972-topps-seaver-psa7/` folder contains **placeholder images** only. Replace `front.jpg` and `back.jpg` with real slab scans before running vision. Delete or rename the example folder once you add production cards.
