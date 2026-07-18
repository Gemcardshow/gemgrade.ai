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

## Preview theme (applied — not published)

| Field | Value |
|------|--------|
| Theme name | **GemGrade CTA Preview** |
| Theme ID | `196156129446` |
| Role | `unpublished` (draft) |
| Duplicated from | live **Refresh** (`139590271142`) |
| Preview URL | https://gemcardshow.com/?preview_theme_id=196156129446 |
| Alternate preview | https://hidden-gem-sportcards.myshopify.com?preview_theme_id=196156129446 |
| Theme editor | https://hidden-gem-sportcards.myshopify.com/admin/themes/196156129446/editor |

Files pushed to that preview theme only:

- `assets/gemgrade-start-scanning.css`
- `snippets/gemgrade-start-scanning-styles.liquid`
- `layout/theme.liquid` (adds `{% render 'gemgrade-start-scanning-styles' %}` after `{{ content_for_header }}`)

**Do not publish** until the project owner explicitly approves.

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
