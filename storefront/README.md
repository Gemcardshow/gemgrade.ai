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

## How to apply (requires owner approval — this is production storefront)

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
