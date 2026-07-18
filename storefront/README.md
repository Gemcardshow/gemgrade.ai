# Gem Card Show storefront — Start Scanning CTA

The live **Start Scanning** button lives on the Shopify Online Store homepage
(`gemcardshow.com`), not in the Next.js GemGrade app (`app.gemcardshow.com`).

## Final approach (live)

App-bound slideshow CTAs render an independent control — **not** Dawn
`.button` / `.button--primary` — so theme color-scheme CSS cannot paint them
white/gray:

- Markup: `<a class="gemgrade-primary-cta">` with diamond G via `logo1.jpg` (`file_url`)
- Styles: scoped `{%- style -%}` block in `sections/slideshow.liquid`
- Collection slides keep Dawn button classes and use distinct labels

## Files in this folder

| Path | Purpose |
|------|---------|
| `sections/slideshow.liquid` | GemGrade primary CTA branch + gold styles |
| `templates/index.json` | Homepage slideshow labels / links |
| `assets/gemgrade-start-scanning-v2.css` | Legacy asset still on theme (CDN cache-bust era) |
| `assets/gemgrade-start-scanning.css` | Prior filename kept for reference |
| `snippets/gemgrade-start-scanning-styles.liquid` | Stylesheet include → v2 (retained on theme) |

Official logo used (existing shop file, icon-only diamond “G”):
`https://gemcardshow.com/cdn/shop/files/logo1.jpg`

## Live theme (published 2026-07-18)

| Field | Value |
|------|--------|
| **Live theme** | **Refresh + GemGrade CTA Fresh Publish** (`196157767846`) |
| Live URL | https://gemcardshow.com/ |
| **Backup (prior live)** | **Refresh + GemGrade CTA backup 2026-07-18** (`196156129446`, unpublished) |
| Earlier pre-CTA backup | **Refresh backup pre-CTA 2026-07-18** (`196156588198`, unpublished) |
| Original Refresh | **Refresh** (`139590271142`, unpublished) |

## Homepage slideshow labels

| Slide | Label | Link |
|-------|-------|------|
| 1 | Start Scanning | `https://app.gemcardshow.com` → `.gemgrade-primary-cta` (gold) |
| 2 | Shop Cards | `/collections/all` |
| 3 | Browse Products | `/collections/all` |
| 4 | View Collection | `/collections/all` |

## Cache note

Shopify/Cloudflare edge HTML can stay stale after theme file edits. When the
theme Liquid is correct but public HTML is not, publish a fresh theme duplicate
(as done with `196157767846`) rather than only pushing assets.

## How to apply to another theme copy

1. Copy `sections/slideshow.liquid` and `templates/index.json` from this folder
2. Preview on an unpublished duplicate first
3. Publish only after visual approval

## Preserved behavior

- Destination remains `https://app.gemcardshow.com`
- Only links containing `app.gemcardshow.com` use `.gemgrade-primary-cta`
- Collection buttons keep Dawn classes and are not restyled as the gold CTA
