# Shopify → GemGrade authentication handoff

## Problem

Gem Card Show (`gemcardshow.com`) and GemGrade (`app.gemcardshow.com`) use separate identity systems:

- Shopify **New Customer Accounts** (passwordless email OTP on `shopify.com/authentication/...`)
- GemGrade **Supabase Auth** (email OTP / magic link)

Without a handoff, a logged-in Shopify customer must create or sign into a separate GemGrade account.

## Confirmed account type

Gem Card Show uses **Shopify New Customer Accounts** (not classic Liquid password accounts).

Evidence: visiting `/account` redirects to Shopify-hosted authentication with email-only Continue.

## Architecture

### Primary path (New Customer Accounts) — Customer Account UI + session token

New Customer Accounts often leave App Proxy `logged_in_customer_id` **empty**. Do **not** switch the store to classic accounts. Use the Customer Account UI extension instead:

```text
Logged-in customer (shopify.com/.../account)
  → Customer Account UI extension “Open GemGrade”
  → shopify.sessionToken.get() (HS256 JWT)
  → open(_top) GET https://app.gemcardshow.com/api/auth/shopify/customer-account-handoff?token=…&next=/
      1. Verify JWT (signature, aud=client_id, exp/nbf, dest/iss shop, sub)
      2. Read customer id from sub (gid://shopify/Customer/…)
      3. Load verified email via Admin API (offline token)
      4. Mint ≤5-minute signed single-use GemGrade handoff token
      5. Persist nonce (jti)
      6. 302 → /auth/shopify/callback?token=...
  → Same GemGrade callback session establish as App Proxy path
```

(Optional POST + Bearer still supported for clients with `network_access`; the shipping extension uses GET navigate so Dev Dashboard apps can release without Partner “Allow network access”.)

### Guest / fallback path — App Proxy (unchanged)

```text
Guest or fallback link
  → /apps/gghandoff/handoff?next=/
  → Shopify App Proxy (HMAC signed)
  → GemGrade GET /api/auth/shopify/handoff
      1. Verify App Proxy signature with SHOPIFY_API_SECRET
      2. If logged_in_customer_id present → Admin email → handoff (classic-like)
      3. If empty (typical for New Customer Accounts) → /login (no SSO)
```

Keep theme/fallback links on `/apps/gghandoff/handoff?next=/`. Do not change the working App Proxy install.

Shopify Dev Dashboard / CLI config lives in `shopify.app.toml`:

- App URL: `https://app.gemcardshow.com`
- Redirect URL: `https://app.gemcardshow.com/api/auth/shopify/callback`
- App proxy: `apps` / `gemgrade` → `https://app.gemcardshow.com/api/auth/shopify/handoff`

Release with:

```bash
npx @shopify/cli app deploy --allow-updates
```

Guest customers (not logged into Shopify) should link directly to:

`https://app.gemcardshow.com/login`

Existing GemGrade OTP and magic-link login remain unchanged.

## Required environment variables (GemGrade / Vercel)

| Variable | Required | Purpose |
|---|---|---|
| `SHOPIFY_API_KEY` | Yes | App Client ID |
| `SHOPIFY_API_SECRET` | Yes | App Client Secret — App Proxy HMAC + OAuth + default handoff signing |
| `SHOPIFY_HANDOFF_SECRET` | Optional | Dedicated handoff HMAC secret (falls back to `SHOPIFY_API_SECRET`) |
| `SHOPIFY_SHOP_DOMAIN` | Yes | Shop hostname for Admin API, e.g. `hidden-gem-sportcards.myshopify.com` |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Optional | Static Admin token override |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Create users, mint session links, consume nonces, fulfill credits, store offline Admin tokens |
| `NEXT_PUBLIC_SITE_URL` | Yes | `https://app.gemcardshow.com` |
| Existing Shopify credit vars | Unchanged | `SHOPIFY_WEBHOOK_SECRET`, credit maps |

Active custom app: [396571410433](https://dev.shopify.com/dashboard/226169287/apps/396571410433).

Admin API auth: try client_credentials first; if Shopify returns `shop_not_permitted` (common for custom-distribution installs), use a stored **offline** token from authorization code grant (`shopify_admin_tokens` table). Run migrations below, then open the authorize URL once as store owner.

## Required Supabase migration

Run in Supabase SQL Editor:

1. `supabase/migrations/20260711_shopify_auth_handoff.sql` — handoff nonces
2. `supabase/migrations/20260712_shopify_admin_tokens.sql` — offline Admin API token storage

Then (once) as store owner open:

`https://hidden-gem-sportcards.myshopify.com/admin/oauth/authorize?client_id=5d873659d0a23f0e2d0b9931e2ae744e&scope=read_customers%2Cwrite_app_proxy&redirect_uri=https%3A%2F%2Fapp.gemcardshow.com%2Fapi%2Fauth%2Fshopify%2Fcallback`

## Shopify custom app setup

1. Create the app in the Shopify Dev Dashboard: **GemGrade Auth Handoff**.
2. Release a version with scopes `read_customers,write_app_proxy` and App Proxy:
   - Subpath prefix: `apps`
   - Subpath: `gghandoff` (fresh path after stuck `/apps/gemgrade` registration)
   - Proxy URL: `https://app.gemcardshow.com/api/auth/shopify/handoff` (or relative `/api/auth/shopify/handoff`)
3. **Select Custom distribution and generate a signed install link:**
   1. Open [Distribution](https://dev.shopify.com/dashboard/226169287/apps/396571410433/distribution) (or Partners Distribution for the same app)
   2. Choose **Custom distribution** (if not already selected)
   3. Store domain: `hidden-gem-sportcards.myshopify.com` (not `gemcardshow.com`)
   4. **Uncheck** “Allow multi-store install for one Plus organization” unless the store is Shopify Plus and you need org-wide installs. Multi-store Plus links commonly return **invalid install link** on non-Plus stores.
   5. Click **Generate link** and copy the URL

**Valid install links must include Shopify’s `signature=`** (usually path `oauth/install_custom_app`). They expire in about **7 days**.

**Invalid (do not use):** bare `…/oauth/install?client_id=…` URLs without Shopify’s `signature=`. Those show the app name but Shopify displays **“The installation link for this app is invalid”** and disables Install.

4. Open the **Generate link** URL in a private/incognito window as the **store owner** (not staff).
5. Approve scopes (`read_customers`, `write_app_proxy`). Confirm App Proxy at `/apps/gghandoff`.
6. Set Vercel env vars (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_SHOP_DOMAIN`). Admin API uses client_credentials refresh; do not require a permanent `SHOPIFY_ADMIN_ACCESS_TOKEN`.

> Distribution and signed install links cannot be created from `shopify.app.toml` or Shopify CLI. After Custom vs Public is selected, that choice cannot be changed. The Plus multi-store checkbox should stay **off** for a single non-Plus merchant store.

## Troubleshooting: storefront `/apps/...` returns Shopify 404

If Dev Dashboard / version config looks correct but the storefront still returns **404 with an empty body** and **no** `x-vercel-id`, Shopify is **not forwarding** — this is a storefront route-registration failure, not a GemGrade bug.

Fingerprint of “proxy not registered”:

| Check | Expected if proxy works | Stuck registration |
|------|-------------------------|--------------------|
| `https://gemcardshow.com/apps/gghandoff` | Hits Vercel (redirect / liquid / app error) | Empty `404`, `powered-by: Shopify`, `content-length: 0` |
| `https://gemcardshow.com/apps/does-not-exist-xyz` | Empty Shopify `404` | **Identical** to the configured proxy path |
| Direct `https://app.gemcardshow.com/api/auth/shopify/handoff` | `302` / app response | Still works |

**Confirm store Admin (not only Dev Dashboard):**
Settings → Apps and sales channels → **GemGrade Auth Handoff** → scroll to **App proxy**.

Fixes (in order):

1. Open **Customize URL**, leave values as-is (or tweak subpath and revert), **Save**. Opening this UI often forces Shopify to register the route.
2. If still identical empty 404: change subpath to a fresh value (e.g. `gghandoff`), save, test `/apps/gghandoff`, then set theme links to that path.
3. Last resort: remove `[app_proxy]` → `shopify app deploy` → add it back with a new subpath → deploy → uninstall/reinstall.

Current released remount uses subpath **`gghandoff`** (version `gemgrade-auth-handoff-6`). After uninstall/reinstall or Customize URL, test:

`https://gemcardshow.com/apps/gghandoff/handoff?next=/`

Storefront URL becomes:

`https://gemcardshow.com/apps/gghandoff/handoff?next=/`

## Customer Account UI extension (required for New Customer Accounts SSO)

Extension source: `extensions/gemgrade-open/`

### Network access note (Dev Dashboard)

Dev Dashboard custom apps often have **no “API access / Allow network access” UI** (that lives in Partner Dashboard). Version `customer-account-sso-1` was created with `network_access = true` but **not released** for that reason.

Current design avoids that gate:

- Extension calls `shopify.sessionToken.get()` at click time, then `open(..., "_blank")` to
  `GET /api/auth/shopify/customer-account-handoff?token=…&next=/`
- No extension `fetch` → **no `network_access` capability** in `shopify.extension.toml`
- Backend verifies the JWT and 302s to the existing GemGrade handoff callback

Ensure **Protected customer data** is approved so session tokens include `sub`. Without `sub`, SSO cannot identify the customer.

### Deploy / release

1. Deploy GemGrade backend (GET+POST `/api/auth/shopify/customer-account-handoff`).
2. Deploy Shopify app version including `gemgrade-open` (**keeps App Proxy** `apps`/`gghandoff`):

```bash
npx @shopify/cli app deploy --allow-updates --client-id 5d873659d0a23f0e2d0b9931e2ae744e
```

Confirm with `shopify app versions list` that the new version is **active** and includes the UI extension (active must not remain `gemgrade-auth-handoff-2` alone).

### Exact Shopify Admin steps to enable the extension

Keep **New customer accounts** enabled. Do not switch to classic.

| Step | Where | Action |
|---|---|---|
| 1 | CLI / Dev Dashboard → Versions | Release latest version that includes `gemgrade-open` (App Proxy unchanged) |
| 2 | Admin → **Settings → Customer accounts** | Confirm **New customer accounts** stays on |
| 3 | Admin → **Settings → Customer accounts → Customize** | Add **Open GemGrade** block from **GemGrade Auth Handoff** on Profile → **Save** |
| 4 | Customer account → Profile | Click **Open GemGrade** → land on GemGrade signed in |
| 5 | Fallback | `/apps/gghandoff/handoff?next=/` remains for guests |

If the editor UI differs: open the customer accounts visual editor from Customer accounts settings → **Add block** → **Open GemGrade**.

Production logs: `event=shopify_customer_account_handoff` (`method`, `transport`, `signature_valid`, `customer_lookup`, `handoff_session`). Never logs tokens, emails, or full JWTs.

## Theme / guest fallback (Online Store)

Keep App Proxy as the guest/fallback path (not the NCA SSO primary):

```liquid
<a href="/apps/gghandoff/handoff?next=/">Open GemGrade</a>
```

Or send guests straight to GemGrade login:

```liquid
<a href="https://app.gemcardshow.com/login">Open GemGrade</a>
```

- Confirmed: `/account` redirects to `https://shopify.com/{shop_id}/account` (New Customer Accounts).
- **Known Shopify limitation:** with New Customer Accounts, App Proxy `logged_in_customer_id` is often **empty even when logged in**. Primary SSO is the Customer Account UI extension + session token.
- App Proxy path remains installed and verified; when `logged_in_customer_id` is present it still SSO’s.
- Production proxy logs: `event=shopify_handoff_proxy` (no secrets / no full signatures).
- Theme fallback link: `/apps/gghandoff/handoff?next=/`
- Never put the customer email in the URL.
- Never put `SHOPIFY_API_SECRET` or handoff secrets in theme or extension code.

## Fallback behavior

| Condition | Result |
|---|---|
| Customer uses Profile → Open GemGrade (NCA) | Session token SSO → GemGrade signed in |
| Extension session token invalid / missing `sub` | Extension shows error + App Proxy fallback link |
| Guest / App Proxy without `logged_in_customer_id` | Redirect GemGrade `/login` |
| App Proxy signature invalid | Redirect `/login?error=shopify_handoff_error` |
| Handoff token expired / altered / replayed / missing email | Redirect `/login?error=shopify_handoff_error` |
| Direct GemGrade visitors | Existing OTP + magic-link login unchanged |

## Security notes

- Tokens are HMAC-SHA256 signed, TTL capped at 5 minutes, and single-use via `jti` nonce rows.
- Email is loaded server-side from Shopify Admin API after proxy verification.
- Session establishment uses Supabase service-role `generateLink` + server `verifyOtp` cookie write (no password, no unsigned email query param).
- Open redirects are blocked (`next` must be a relative path starting with `/`).

## Production verification checklist

1. Apply handoff + admin token SQL migrations; ensure offline Admin token is stored.
2. Set Vercel env vars and redeploy (includes `/api/auth/shopify/customer-account-handoff`).
3. Deploy Shopify app version with Customer Account UI extension; keep App Proxy `apps`/`gghandoff`.
4. Enable **Open GemGrade** in the customer accounts editor (see steps above).
5. While **logged in** to New Customer Accounts, Profile → **Open GemGrade** → lands on `/` signed into GemGrade.
6. While **logged out**, App Proxy `/apps/gghandoff/handoff?next=/` → GemGrade login.
7. Repeat the same handoff callback URL → rejected (replay).
8. Confirm OTP / magic-link login still works for direct visitors.
