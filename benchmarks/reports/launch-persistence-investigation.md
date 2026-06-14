# Launch Persistence Investigation — Supabase Grade Save Failure

**Generated:** 2026-06-14  
**Symptom:** Grading succeeds; UI shows *"Grade computed but failed to save record. Please try again."*  
**Scope:** Persistence layer only — **no grading or prompt changes**  
**Handler:** `lib/gradeHandler.js` @ `5f79062` (+ temporary insert logging)

---

## Executive Summary

Production smoke test confirms **OpenAI grading works end-to-end**. Failure occurs **after** `gradeCard()` returns, during the **Supabase insert** into table `grades`.

The repository contains **no SQL migrations, schema files, or RLS policy definitions** for Supabase. Table shape and policies must be verified in the Supabase project dashboard. Based on code analysis, the **most likely root causes** (in order) are:

1. **Row Level Security (RLS)** blocking inserts when using `SUPABASE_ANON_KEY`
2. **Schema mismatch** — missing table, wrong column names, or wrong types
3. **Oversized row payload** — full JPEG data URLs (~0.5–1.0 MB each) stored in `front_image` / `back_image` text columns

Temporary structured logging was added to surface the exact Supabase error (`code`, `message`, `details`, `hint`) in server logs on the next failed insert.

---

## 1. Exact Supabase Insert Operation

**File:** `lib/gradeHandler.js`  
**Client:** `@supabase/supabase-js` via lazy `getSupabaseClient()`  
**Operation:**

```javascript
await supabase.from("grades").insert([
  {
    email: email || null,
    grade: grade.psaGrade,
    verdict: grade.verdict,
    front_image: frontImage,
    back_image: backImage,
  },
]);
```

| Field | Source | Notes |
|-------|--------|-------|
| `email` | Request body (optional) | `null` if omitted |
| `grade` | `grade.psaGrade` | Integer PSA snap (1–10) |
| `verdict` | `grade.verdict` | Markdown string (~1 KB typical) |
| `front_image` | Request body | Full JPEG **data URL** (base64) |
| `back_image` | Request body | Full JPEG **data URL** (base64) |

**Failure path:** If `insertError` is truthy → HTTP **500** with user message *"Grade computed but failed to save record. Please try again."* Graded JSON is **not** returned to the client.

**Success path:** HTTP **200** with full grade response.

---

## 2. Which Supabase Key Is Used?

**Selection logic** (`getSupabaseKey()`):

```javascript
process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  || process.env.SUPABASE_ANON_KEY?.trim()
```

| Priority | Env var | RLS behavior |
|----------|---------|--------------|
| **1 (preferred)** | `SUPABASE_SERVICE_ROLE_KEY` | **Bypasses RLS** — server-side inserts |
| **2 (fallback)** | `SUPABASE_ANON_KEY` | **Subject to RLS** — requires INSERT policy |

**Deployment determination:** Check hosting env vars. Whichever is set wins; service role takes precedence if **both** are present.

**Investigation helper:** `getSupabaseKeySource()` returns `"SUPABASE_SERVICE_ROLE_KEY"`, `"SUPABASE_ANON_KEY"`, or `null`. Logged on insert failure.

**Local dev note:** Local `.env` currently has **no Supabase values** — local API returns **503** (missing env). Production clearly has Supabase configured (insert attempted, not 503).

---

## 3. Target Table Verification

**Expected table:** `public.grades`

**In-repo evidence:** **None.** No `supabase/migrations/`, no `schema.sql`, no README documenting table DDL.

**Inferred required schema** (from insert payload):

| Column | Inferred type | Required |
|--------|---------------|----------|
| `id` | `uuid` / serial (PK) | Auto-generated assumed |
| `email` | `text` nullable | Optional |
| `grade` | `integer` or `numeric` | Required |
| `verdict` | `text` | Required |
| `front_image` | `text` | Required — **large** |
| `back_image` | `text` | Required — **large** |
| `created_at` | `timestamptz` | Optional (default `now()`) |

### Verify in Supabase Dashboard

1. **Table Editor** → confirm `grades` table exists
2. **Columns** → names match **snake_case** exactly (`front_image`, not `frontImage`)
3. **Types** → `grade` accepts integers; text columns accept large strings
4. **RLS** → see section 4

**Common schema errors:**

| Supabase error code | Meaning |
|---------------------|---------|
| `42P01` | Relation `"grades"` does not exist |
| `42703` | Column does not exist (name mismatch) |
| `23502` | NOT NULL violation on missing column |
| `22P02` | Invalid input syntax for type (e.g. text in integer column) |

---

## 4. Row Level Security (RLS) Analysis

If deployment uses **`SUPABASE_ANON_KEY`** (or service role is unset/misnamed), inserts are **blocked unless an RLS policy allows INSERT**.

| Key | RLS |
|-----|-----|
| `SUPABASE_SERVICE_ROLE_KEY` | **Bypasses RLS** — inserts succeed if schema valid |
| `SUPABASE_ANON_KEY` | **Requires policy** e.g. `CREATE POLICY "Allow public insert" ON grades FOR INSERT WITH CHECK (true);` |

**Typical RLS failure:**

| Field | Value |
|-------|-------|
| **HTTP status** | 500 (from handler) |
| **PostgREST code** | `42501` |
| **Message** | `new row violates row-level security policy for table "grades"` |

**Recommendation for production API:**

- Use **`SUPABASE_SERVICE_ROLE_KEY`** on the server only (never expose to client)
- Or keep anon key + add explicit INSERT policy on `grades`

---

## 5. Payload Size Analysis

Compressed upload images still produce **large insert payloads**:

| Sample (Yount TEST 9 JPGs) | Size |
|------------------------------|-----:|
| Front data URL | ~472 KB |
| Back data URL | ~544 KB |
| Verdict + metadata | ~1 KB |
| **Total insert JSON** | **~1.0 MB** |

Storing multi-MB base64 strings in PostgreSQL `text` columns is **valid** but can cause:

- PostgREST request timeout
- Hosting platform body limits (Next.js allows 10 MB on `/api/grade`)
- Supabase plan row/size limits in edge cases

**If error mentions payload size or statement timeout**, consider:

- Store images in **Supabase Storage**; persist URLs only
- Store grade metadata without images in `grades`
- Use `bytea` / external object storage instead of inline text

---

## 6. Temporary Logging Added

Structured logging on insert failure (server console):

```javascript
{
  table: "grades",
  operation: "insert",
  keySource: "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_ANON_KEY",
  supabase: {
    message: "...",
    code: "...",
    details: "...",
    hint: "..."
  },
  payloadSummary: {
    email, grade, verdictLength,
    frontImageBytes, backImageBytes
  }
}
```

**Next step:** Reproduce one failed production save and capture the log line. The `code` field identifies the root cause immediately.

---

## 7. Diagnostic Decision Tree

```
Grade computed ✓
  └─ insert into grades
       ├─ code 42501 → RLS policy missing (use service role or add INSERT policy)
       ├─ code 42P01 → Table "grades" does not exist
       ├─ code 42703 → Column name mismatch
       ├─ code 23502 → NOT NULL column missing from insert
       ├─ timeout / 5xx → Payload too large; move images to Storage
       └─ other → Check supabase.message + hint in logs
```

---

## 8. Recommended Fixes (Persistence Only)

| Priority | Action |
|----------|--------|
| **P0** | Capture one production log line with new structured logging |
| **P1** | Confirm deployment uses **`SUPABASE_SERVICE_ROLE_KEY`** for `/api/grade` |
| **P1** | Verify `grades` table + column names in Supabase dashboard |
| **P2** | If using anon key: `ALTER TABLE grades ENABLE ROW LEVEL SECURITY` + INSERT policy |
| **P3** | Stop storing full data URLs in Postgres; use Storage bucket + URL references |

---

## 9. What Was Not Changed

- Grading logic (`lib/grading/*`) — **unchanged**
- Prompts — **unchanged**
- Benchmarks — **unchanged**
- API response on successful save — **unchanged**

Only **insert failure logging** in `lib/gradeHandler.js` was enhanced for investigation.

---

## 10. Verification Checklist (Ops)

- [ ] Supabase dashboard → `grades` table exists
- [ ] Column names: `email`, `grade`, `verdict`, `front_image`, `back_image`
- [ ] Production env: `SUPABASE_URL` set
- [ ] Production env: `SUPABASE_SERVICE_ROLE_KEY` set (recommended)
- [ ] RLS policies reviewed if using anon key
- [ ] Reproduce failure; copy `Supabase grade insert failed:` log JSON
- [ ] Apply fix based on `supabase.code` from decision tree (section 7)

---

*Investigation only. Awaiting production Supabase error code from enhanced logs to confirm root cause.*
