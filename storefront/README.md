# Gem Card Show storefront — Start Scanning CTA

The live **Start Scanning** button lives on the Shopify Online Store homepage
(`gemcardshow.com`), not in the Next.js GemGrade app (`app.gemcardshow.com`).

## Root cause (white / gray button)

Earlier gold CTA work was applied in `app/globals.css` against the GemGrade app
scanner submit button (`.btn.btn--scan`). The storefront uses Dawn theme classes
(`.button.button--primary`) inside a slideshow `banner__buttons` block. Theme
color-scheme variables paint that primary button **white** with gold text, so
the app CSS never appeared on the homepage collectors actually see.

## Files in this folder

| Path | Purpose |
|------|---------|
| `assets/gemgrade-start-scanning.css` | High-specificity gold CTA + official `logo1.jpg` mark |
| `snippets/gemgrade-start-scanning-styles.liquid` | Stylesheet include for Dawn `theme.liquid` |

Official logo used (existing shop file, icon-only diamond “G”):
`https://gemcardshow.com/cdn/shop/files/logo1.jpg`

## Live theme (published 2026-07-18)

| Field | Value |
|------|--------|
| **Live theme** | **Refresh + GemGrade CTA** (`196156129446`) |
| Live URL | https://gemcardshow.com/ |
| **Backup of prior live** | **Refresh backup pre-CTA 2026-07-18** (`196156588198`, unpublished) |
| Prior live (also retained) | **Refresh** (`139590271142`, unpublished after publish) |

## Preview theme history

| Field | Value |
|------|--------|
| Theme name | **Refresh + GemGrade CTA** (renamed from GemGrade CTA Preview) |
| Theme ID | `196156129446` |
| Role | was `unpublished`; now **live** |
| Duplicated from | live **Refresh** (`139590271142`) |
| Preview URL (historical) | https://gemcardshow.com/?preview_theme_id=196156129446 |
| Theme editor | https://hidden-gem-sportcards.myshopify.com/admin/themes/196156129446/editor |

Files on this theme:

- `assets/gemgrade-start-scanning.css`
- `snippets/gemgrade-start-scanning-styles.liquid`
- `layout/theme.liquid` (adds `{% render 'gemgrade-start-scanning-styles' %}` after `{{ content_for_header }}`)

## How to apply to another theme copy

**Option A — Theme code (recommended)**

1. Shopify Admin → Online Store → Themes → Edit code
2. Upload / create `assets/gemgrade-start-scanning.css` from this folder
3. Create `snippets/gemgrade-start-scanning-styles.liquid` from this folder
4. In `layout/theme.liquid` `<head>`, add:
   `{% render 'gemgrade-start-scanning-styles' %}`
5. Preview on unpublished theme first, then publish when approved

**Option B — Theme Custom CSS (fastest preview)**

1. Online Store → Themes → Customize → Theme settings → Custom CSS
2. Paste the contents of `assets/gemgrade-start-scanning.css`
3. Save / publish only with owner approval

## Preserved behavior

- Destination remains `https://app.gemcardshow.com`
- Selector is scoped to primary buttons whose `href` contains `app.gemcardshow.com`
- Other slideshow “Start Scanning” buttons that link to collections are untouched

## Live homepage gotcha (4 “Start Scanning” CTAs)

The slideshow has **four** buttons labeled “Start Scanning”:

| Slide | Classes | `href` | Styled by GemGrade CSS? |
|-------|---------|--------|-------------------------|
| 1 | `button button--primary` | `https://app.gemcardshow.com` | Yes — gold |
| 2 | `button button--secondary` | `/collections/all` | No (light gray) |
| 3 | `button button--primary` | `/collections/all` | No (olive scheme) |
| 4 | `button button--primary` | `/collections/all` | No (**white** scheme) |

If the live page looks “still white,” check that you are on **slide 1** (app link), not a later slide. On desktop, slide 1’s gold CTA sits **below** the adapt-to-image hero, so scroll past the banner image to see it.

## Selector (unchanged — matches real live DOM)

```css
.banner__buttons a.button.button--primary[href*="app.gemcardshow.com"]
```
