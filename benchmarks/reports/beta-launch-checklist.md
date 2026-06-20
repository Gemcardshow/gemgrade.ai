# GemGrade Beta Launch Checklist

**Production:** https://gemgrade-ai.vercel.app  
**Branch:** `phase2/vintage-research`  
**Last updated:** June 2026

---

## Before inviting testers

- [ ] Confirm production smoke passes (login, Scout/Pro grade, credit deduction, `/history`).
- [ ] Confirm `ADMIN_EMAILS` is set on Vercel production.
- [ ] Confirm `SUPABASE_SERVICE_ROLE_KEY` is set (required for admin credits + scan saves).
- [ ] Have each tester’s **signup email** ready (they must create an account before you can grant credits).

---

## How to add tester credits

1. Sign in as an admin (`ADMIN_EMAILS` allowlist).
2. Open **https://gemgrade-ai.vercel.app/admin/credits**
3. Search the tester by **exact email** (same email they used to sign up).
4. Enter a **reason** (e.g. `Beta tester — wave 1`).
5. Grant credits:
   - Quick: **+50** or **+100**
   - Custom: enter amount → **Add**
   - Exact balance: **Set balance** (requires confirmation)
6. Confirm:
   - Balance updates on the user card
   - A row appears under **Recent transactions** with type `admin_grant` and metadata `admin_credit_adjustment`

**Notes**

- Testers must sign up first; if search returns “User not found,” ask them to complete login once, then retry.
- Subtract / set balance require confirmation in the UI.
- Every admin adjustment is logged in `credit_transactions` with admin email, target email, previous/new balance, and reason.

---

## How many credits to give each tester

| Profile | Credits | Typical usage |
|---------|---------|----------------|
| **Standard beta tester** | **50** | ~15–25 scans (mix of Scout + Pro) |
| **Power tester / collector with many cards** | **100** | ~30–50 scans |
| **Smoke / one-off demo** | **10** | 5–10 quick Scout scans |

**Cost reference**

| Mode | Credits | Images |
|------|---------|--------|
| Scout | 1 | Front only |
| Pro | 2 | Front + back |

**Suggested starter mix for 50 credits:** enough for ~10 Pro scans + ~10 Scout scans, or mostly Scout with room to retry bad photos.

Top up with **+50** if a tester runs out mid-session. Avoid large grants unless needed — easier to audit usage.

---

## What testers should try

### Account & credits

- [ ] Sign up / log in with magic link
- [ ] Confirm credit balance displays on the home page
- [ ] Confirm balance decreases after each scan (Scout −1, Pro −2)

### Scout (1 credit)

- [ ] Grade a **modern** card (front photo only)
- [ ] Grade a **vintage** card (front photo only)
- [ ] Try a card they **know the PSA grade** of (slabbed or recently graded)
- [ ] Try a **low-quality photo** (glare, blur, off-angle) and note whether results feel trustworthy

### Pro (2 credits)

- [ ] Grade the same card with **front + back**
- [ ] Compare Scout vs Pro on the same card — is Pro more useful for cards they own?

### History

- [ ] Open **/history** after a few scans
- [ ] Open a past scan detail page
- [ ] Confirm Scout/Pro mode and GemGrade label are shown

### Optional: placeholder purchase

- [ ] Visit **/credits** and try a placeholder pack (if enabled) — not required for beta if admin grants credits

---

## What feedback to collect

Ask testers to report back on:

1. **Grade accuracy** — How close was GemGrade to their expectation or known PSA grade? Card era (vintage vs modern)?
2. **Scout vs Pro value** — Was Scout enough for buying decisions? Did Pro add meaningful detail for cards they own?
3. **Photo guidance** — What shot setup worked best? What failed (glare, sleeves, slabs, low light)?
4. **UX friction** — Login, upload flow, wait time, result readability, history page
5. **Trust & clarity** — Do GemGrade labels and verdict text feel clear? Any confusion with PSA?
6. **Credits** — Did they run out too fast? Was the cost (1/2) fair for what they got?
7. **Bugs** — Error messages, failed scans, balance not updating, history missing scans

**Capture per report (minimum)**

- Tester email  
- Card description (year/set/player if known)  
- Known grade (if any) vs GemGrade result  
- Scout or Pro  
- Photo quality (good / fair / poor)  
- Screenshot or short note  
- Device + browser  

---

## Known limitations

- **Independent estimate only** — GemGrade is not PSA and does not replace professional grading.
- **Photo-dependent** — Hidden wear, holder glare, sleeves, and bad lighting can mislead the model.
- **Scout is front-only** — Scout duplicates the front image internally for the grading adapter; back defects are not seen in Scout mode.
- **Calibration is ongoing** — Vintage and modern cards may behave differently; high-grade modern cards are an active tuning area.
- **Placeholder billing** — `/credits` purchase flow is a placeholder, not live Stripe checkout.
- **Beta access** — No separate “beta flag”; access is login + credits only.
- **Admin tool** — Restricted to `ADMIN_EMAILS`; all adjustments are server-enforced and logged.
- **Scan history** — Requires successful grade save; very old legacy scan rows may lack mode/credits metadata.

---

## Emergency rollback notes

### Disable new usage quickly

1. **Vercel → Environment Variables**
   - Set `CREDITS_PLACEHOLDER_MODE=false` (blocks placeholder purchases)
   - Optionally remove or rotate `OPENAI_API_KEY` to stop grading (last resort — affects all users)

2. **Stop granting credits** — Do not use `/admin/credits` until issue is understood.

### Roll back a bad deploy

1. **Vercel dashboard** → Project → Deployments → find last known-good production deployment → **Promote to Production**  
   Or CLI:
   ```bash
   npx vercel rollback
   ```
2. **Git revert** (if code change caused the issue):
   ```bash
   git revert <bad-commit-sha>
   git push origin phase2/vintage-research
   npx vercel --prod
   ```

### After rollback

- [ ] Re-run authenticated production smoke
- [ ] Spot-check Scout + Pro on one card
- [ ] Confirm `/admin/credits` still works for admins
- [ ] Notify testers if scans or balances were affected

### Admin contacts

- `gemcardshow@gmail.com`
- `akurgin@att.net`

---

## Quick reference

| Item | Location |
|------|----------|
| Grade cards | `/` |
| Scan history | `/history` |
| Buy credits (placeholder) | `/credits` |
| Admin credit tool | `/admin/credits` |
| Login | `/login` |
