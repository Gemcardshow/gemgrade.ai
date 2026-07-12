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

```text
Logged-in Shopify customer
  → Theme link /apps/gemgrade/handoff?next=/
  → Shopify App Proxy (HMAC signed)
  → GemGrade GET /api/auth/shopify/handoff
      1. Verify App Proxy signature with SHOPIFY_API_SECRET
      2. Read logged_in_customer_id (no email in URL)
      3. Load verified email via Shopify Admin API
      4. Mint ≤5-minute signed single-use token
      5. Persist nonce (jti)
      6. Redirect → /auth/shopify/callback?token=...
  → GemGrade GET /auth/shopify/callback
      1. Verify signature + expiry + required claims
      2. Consume nonce (reject replays)
      3. Find or create Supabase user by normalized email
      4. Establish secure cookie session
      5. Signup bonus (if eligible) + fulfill pending Shopify credits
      6. Redirect to next path (default /)
```

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
| `SHOPIFY_API_SECRET` | Yes | App Proxy HMAC verification + default handoff signing secret |
| `SHOPIFY_HANDOFF_SECRET` | Optional | Dedicated handoff HMAC secret (falls back to `SHOPIFY_API_SECRET`) |
| `SHOPIFY_SHOP_DOMAIN` | Yes | Shop hostname for Admin API, e.g. `hidden-gem-sportcards.myshopify.com` |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Yes | Admin API token with `read_customers` |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Create users, mint session links, consume nonces, fulfill credits |
| `NEXT_PUBLIC_SITE_URL` | Yes | `https://app.gemcardshow.com` |
| Existing Shopify credit vars | Unchanged | `SHOPIFY_WEBHOOK_SECRET`, credit maps |

## Required Supabase migration

Run in Supabase SQL Editor:

`supabase/migrations/20260711_shopify_auth_handoff.sql`

Creates `shopify_auth_handoff_nonces` for single-use token enforcement.

## Shopify custom app setup

1. Create a custom app for the Gem Card Show store (Partners or Admin → Apps → Develop apps).
2. Enable Admin API scope: `read_customers`.
3. Install the app and copy:
   - **API secret key** → `SHOPIFY_API_SECRET` / optional `SHOPIFY_HANDOFF_SECRET`
   - **Admin API access token** → `SHOPIFY_ADMIN_ACCESS_TOKEN`
4. Configure **App proxy** via `shopify.app.toml` / Dev Dashboard version:
   - Subpath prefix: `apps`
   - Subpath: `gemgrade`
   - Proxy URL: `https://app.gemcardshow.com/api/auth/shopify/handoff`
5. Save, install on the live store, and `shopify app deploy --allow-updates`.

Storefront URL becomes:

`https://gemcardshow.com/apps/gemgrade/handoff?next=/`

## Theme changes (Online Store)

Replace any plain GemGrade link that points at `https://app.gemcardshow.com` / login with:

```liquid
{% if customer %}
  <a href="/apps/gemgrade/handoff?next=/">Open GemGrade</a>
{% else %}
  <a href="https://app.gemcardshow.com/login">Open GemGrade</a>
{% endif %}
```

Notes for New Customer Accounts:

- Liquid `customer` is still available on the Online Store when the buyer is signed in.
- App Proxy `logged_in_customer_id` is the identity signal GemGrade trusts (verified by Shopify HMAC).
- Never put the customer email in the URL.
- Never put `SHOPIFY_API_SECRET` or handoff secrets in theme code.

## Fallback behavior

| Condition | Result |
|---|---|
| Customer not logged into Shopify | Theme sends them to `/login` |
| App Proxy signature invalid | Redirect `/login?error=shopify_handoff_error` |
| Missing customer id | Redirect `/login` |
| Token expired / altered / replayed / missing email | Redirect `/login?error=shopify_handoff_error` |
| Direct GemGrade visitors | Existing OTP + magic-link login unchanged |

## Security notes

- Tokens are HMAC-SHA256 signed, TTL capped at 5 minutes, and single-use via `jti` nonce rows.
- Email is loaded server-side from Shopify Admin API after proxy verification.
- Session establishment uses Supabase service-role `generateLink` + server `verifyOtp` cookie write (no password, no unsigned email query param).
- Open redirects are blocked (`next` must be a relative path starting with `/`).

## Production verification checklist

1. Apply the handoff SQL migration.
2. Set Vercel env vars and redeploy.
3. Configure Shopify app proxy + theme link.
4. While **logged out** of Shopify, click Open GemGrade → lands on GemGrade login.
5. While **logged in** to Shopify with a new email, click Open GemGrade → lands on `/` signed into GemGrade with welcome bonus if eligible.
6. Repeat the same token/callback URL → rejected (replay).
7. Buy credits on Shopify for that email before first GemGrade login → pending grants fulfill on handoff.
8. Confirm OTP / magic-link login still works for direct visitors.
