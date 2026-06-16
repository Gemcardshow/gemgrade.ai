# Launch Sprint 2 — Completion Summary

**Branch:** `phase2/vintage-research`  
**Remote:** `origin/phase2/vintage-research`  
**Head commit:** `ea20768` — `style: apply black and gold launch UI polish`  
**Production URL:** https://gemgrade-ai.vercel.app  
**Completed:** June 2026

Sprint 2 builds on Launch Sprint 1 (auth, credits ledger, login, purchase placeholder). It adds credit-gated scanning, Scout/Pro product modes, front-only Scout support, scan history, and a black/gold launch UI — without modifying the frozen grading engine.

---

## Commits 1–5

| # | Hash | Message | Summary |
|---|------|---------|---------|
| 1 | `6414c22` | `feat: add credit gating to scan flow` | Auth required on `/api/grade`. Pre-check balance, grade, persist scan, deduct credits post-success. Scout = 1 credit, Pro = 2 credits. |
| 2 | `6082d59` | `feat: add Scout and Pro mode split` | Mode selector on home. `ScoutResult` (buy signal, confidence) vs `ProGradeResult` (full breakdown). Presentation-only buy-signal helpers in `lib/scoutPresentation.js`. |
| 3 | `b1ccf9a` | `feat: support front-only Scout scans` | Scout may submit front only; Pro requires front + back. Handler adapter duplicates front as back for Scout v1. Client + server validation. |
| 4 | `29778da` | `feat: add scan history UI` | `/history` list + `/history/[id]` detail. Reads `public.scans` via RLS-scoped API. Extended scan insert with `user_id`, mode, credits, era, confidence, snapshot. |
| 5 | `ea20768` | `style: apply black and gold launch UI polish` | Matte black + gold luxury theme across home, login, credits, history, Scout/Pro results. Cormorant Garamond display font. No functional changes. |

**Sprint 1 prerequisite (already on branch):** `8012681` removed era selector; all scans use `era: "auto"`.

---

## Credit Gating

- **`lib/gradeScanGate.js`** — `executeCreditGatedScan()` orchestrates: balance pre-check → grade → save scan → deduct credits.
- Credits are **not** deducted if grading or scan persistence fails.
- **`lib/credits.js`** — `deductScanCredits()`, `InsufficientCreditsError` (HTTP 402).
- **`lib/scanCredits.js`** — client-safe cost constants: Scout **1**, Pro **2**.
- **`lib/gradeHandler.js`** — requires authenticated session; uses service-role Supabase for credit writes.
- **`components/GradeScanner.jsx`** — sign-in gate before submit; dispatches `credits-updated` after success.
- **`components/CreditBalance.jsx`** — header badge links to `/credits`.

---

## Scout / Pro Split

| Mode | Tagline | Credits | Result component | Output |
|------|---------|---------|------------------|--------|
| **Scout** | Know what to buy | 1 | `ScoutResult` | PSA estimate, confidence, buy signal, credits used |
| **Pro** | Know what you have | 2 | `ProGradeResult` | Full category scores, limiter, scan quality, cap audit, verdict |

- Same grading engine and API payload for both modes; presentation and credit cost differ.
- **`components/GradeResult.jsx`** routes by mode.
- **`lib/scoutPresentation.js`** — buy signal derived from existing grade response (no grading changes).

---

## Scout Front-Only

- **`lib/scanInputAdapter.js`** — product-flow adapter (not under `lib/grading/`):
  - **Scout + no back:** passes front as both `frontImage` and `backImage` (Scout v1 approximation).
  - **Pro + no back:** blocked with 400.
- Server response includes `scout.frontOnlyApproximation` when approximation is used.
- **`components/ScoutResult.jsx`** shows approximation notice when applicable.
- UI: back image optional for Scout, required for Pro; mode-specific submit validation.

---

## Scan History

- **Pages:** `/history` (list), `/history/[id]` (detail).
- **API:** `GET /api/scans`, `GET /api/scans/[id]` (authenticated, RLS-scoped client).
- **`lib/scanHistory.js`** — insert helpers, list/detail mappers, legacy insert fallback if migration not yet applied.
- **List columns:** date, mode, grade, confidence (Scout), credits used, detected era.
- **Detail:** reuses `GradeResult` with saved `result_snapshot` + verdict.
- **Header:** History link in `AuthStatus` when signed in.
- Scans before migration or without `user_id` will not appear in per-user history.

---

## Black / Gold UI Polish

- Matte black background with subtle gold radial glow.
- Gold accents on borders, links, badges, buttons, grade scores.
- **Fonts:** Cormorant Garamond (display) + Inter (body) via `next/font`.
- Large centered grade presentation for Scout; split **PSA** + numeric score for Pro.
- Unified `.btn--primary` gold CTAs; gold-bordered panels and mode selector cards.
- History table with gold headers; confidence/mode badges.
- Site header brand link **GemGrade AI** + gold credit pill.

---

## Verification Status

| Check | Status |
|-------|--------|
| Tests | **244/244 passing** (207 engine + 37 lib/handler) |
| Build | **Passing** (`npm run build`) |
| `lib/grading/*` | **Untouched** across all Sprint 2 commits |
| Grading prompts / calibration / benchmarks | **Not modified** in Sprint 2 |

---

## Required Supabase Migrations

Apply in order in the Supabase SQL Editor or via Supabase CLI.

### 1. `launch_sprint1`

**File:** `supabase/migrations/20260614_launch_sprint1.sql`

Creates:

- `public.profiles` (credit balance, 1:1 with `auth.users`)
- `public.credit_transactions` (append-only ledger)
- Signup trigger → auto-create profile
- RLS: users read own profile and transactions

**Prerequisite:** Supabase Auth enabled; magic-link email configured.

### 2. `launch_sprint2_scan_history`

**File:** `supabase/migrations/20260615_launch_sprint2_scan_history.sql`

Extends existing `public.scans` (must already exist from prior deploy):

- Adds `user_id`, `mode`, `credits_used`, `era`, `confidence`, `result_snapshot`
- Index on `(user_id, created_at DESC)`
- RLS: authenticated users `SELECT` own scans only
- Optional FK: `credit_transactions.scan_id` → `scans.id`

**Note:** New columns are nullable so legacy insert shape still works until the app populates extended fields. The app falls back to legacy insert if columns are missing.

---

## Required Vercel Environment Variables

### Grading (server)

| Variable | Required | Notes |
|----------|----------|-------|
| `OPENAI_API_KEY` | Yes | Vision grading |
| `SUPABASE_URL` | Yes | Same Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes* | Credit deduction + scan insert |
| `SUPABASE_ANON_KEY` | Fallback | Only if service role unavailable |

\* Service role is required for credit writes and reliable scan persistence in production.

### Auth (client + server)

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser auth |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser auth + RLS reads |

### Credits (placeholder purchases)

| Variable | Required | Notes |
|----------|----------|-------|
| `CREDITS_PLACEHOLDER_MODE` | Yes (for testing) | Set `true` to enable placeholder packs |
| `CREDIT_PACK_STARTER` | Optional | Default 10 |
| `CREDIT_PACK_STANDARD` | Optional | Default 50 |
| `CREDIT_PACK_PRO` | Optional | Default 100 |

### Optional

| Variable | Notes |
|----------|-------|
| `OPENAI_VISION_MODEL` | Default `gpt-4o-mini` |

### Supabase Auth redirect URLs

Add to Supabase Auth → URL configuration:

- Site URL: production domain (e.g. `https://gemgrade-ai.vercel.app`)
- Redirect: `https://gemgrade-ai.vercel.app/auth/callback` (and local `http://localhost:3000/auth/callback` for dev)

---

## Manual Smoke Test Checklist

Use a fresh or low-balance test account where possible.

- [ ] **Login magic link** — `/login` → enter email → receive link → lands on home signed in; header shows email + credit badge.
- [ ] **Buy placeholder credits** — `/credits` → purchase a pack (`CREDITS_PLACEHOLDER_MODE=true`) → balance increases; header badge updates.
- [ ] **Pro scan deducts 2** — Pro mode, front + back → grade succeeds → balance −2; `credit_transactions` shows `scan_pro`.
- [ ] **Scout front+back deducts 1** — Scout mode, both images → grade succeeds → balance −1; no approximation notice.
- [ ] **Scout front-only deducts 1** — Scout mode, front only → grade succeeds → balance −1; Scout approximation notice shown.
- [ ] **Insufficient credits blocks scan** — reduce balance below mode cost → submit → 402 / error message; no deduction.
- [ ] **History shows saved scans** — `/history` lists recent scans with date, mode, grade, confidence (Scout), credits, era (after sprint2 migration applied).
- [ ] **Result detail opens** — click View → `/history/[id]` shows saved Scout or Pro result + verdict.
- [ ] **Era auto displays read-only** — no era selector on scan form; Pro result and history show detected era (e.g. `vintage` / `modern` with `eraSource: auto`); API always sends `era: "auto"`.

---

## Key Files (Sprint 2)

| Area | Files |
|------|-------|
| Credit gating | `lib/gradeScanGate.js`, `lib/credits.js`, `lib/scanCredits.js`, `lib/gradeHandler.js` |
| Scout / Pro | `components/GradeScanner.jsx`, `ScoutResult.jsx`, `ProGradeResult.jsx`, `GradeResult.jsx`, `lib/scoutPresentation.js` |
| Front-only Scout | `lib/scanInputAdapter.js`, `lib/gradeApi.js` |
| Scan history | `lib/scanHistory.js`, `pages/api/scans/*`, `components/ScanHistory*.jsx`, `app/history/*` |
| UI theme | `app/globals.css`, `app/layout.jsx` |

---

## Out of Scope (Deferred)

- Real Stripe payments
- Luxury UI beyond Sprint 2 polish
- Grading engine / calibration / benchmark changes
- Scout v2 true back-optional grading (replace front-as-back adapter)

---

## Sprint 2 Sign-Off

All five commits are on `origin/phase2/vintage-research`. The launch scan flow is credit-gated, mode-aware, history-backed, and visually polished — with the grading engine frozen under `lib/grading/*`.
