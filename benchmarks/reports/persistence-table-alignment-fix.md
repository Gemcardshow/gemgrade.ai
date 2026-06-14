# Persistence Table Alignment Fix

**Generated:** 2026-06-14  
**Commit:** `fix: persist grades to scans table`  
**Scope:** Persistence only — **no grading logic or prompt changes**

---

## Root Cause

Production insert targeted **`public.grades`**, which does not exist. Supabase returned **`PGRST205`** with hint: *Perhaps you meant the table 'public.scans'*.

Dashboard inspection confirmed **`public.scans`** exists with columns that match the handler payload exactly:

| Column | Handler field |
|--------|---------------|
| `id` | auto-generated |
| `email` | `email` |
| `grade` | `grade.psaGrade` |
| `verdict` | `grade.verdict` |
| `front_image` | `frontImage` |
| `back_image` | `backImage` |
| `created_at` | auto-generated |

---

## Fix

**File:** `lib/gradeHandler.js`

```diff
- .from("grades")
+ .from("scans")
```

Insert payload unchanged. Structured failure logging preserved (`table` field updated to `"scans"` for accurate Vercel logs).

---

## Verification

| Check | Result |
|-------|--------|
| Grading logic | **Unchanged** |
| Prompts | **Unchanged** |
| `npm test` | Run at commit time |
| `npm run build` | Run at commit time |

**Post-deploy:** Reproduce one production scan; expect HTTP **200** and a new row in `public.scans`.

---

## Trusted Grading Baseline (unchanged @ `bdaed8b`)

| Suite | Metric |
|-------|--------|
| Vintage | 48/72 within ±1 |
| MODERN 10 | 31/32 within ±1, 0 FP tags |
| Tests | 209/209 passing |
