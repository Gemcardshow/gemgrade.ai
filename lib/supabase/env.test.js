import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidSupabaseAnonKey,
  isValidSupabaseProjectUrl,
} from "./env.js";

test("isValidSupabaseProjectUrl accepts real Supabase hosts only", () => {
  assert.equal(
    isValidSupabaseProjectUrl("https://abcdefghijklmnop.supabase.co"),
    true,
  );
  assert.equal(
    isValidSupabaseProjectUrl("https://not-supabase.example.com"),
    false,
  );
  assert.equal(isValidSupabaseProjectUrl("not-a-url"), false);
});

test("isValidSupabaseProjectUrl rejects documentation placeholders", () => {
  assert.equal(
    isValidSupabaseProjectUrl("https://your-project.supabase.co"),
    false,
  );
  assert.equal(
    isValidSupabaseProjectUrl("https://<real-project-ref>.supabase.co"),
    false,
  );
});

test("isValidSupabaseAnonKey accepts JWT and publishable keys", () => {
  assert.equal(
    isValidSupabaseAnonKey(
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def",
    ),
    true,
  );
  assert.equal(
    isValidSupabaseAnonKey("sb_publishable_4qhM1F7HrmpI6nUxUwbhaA_fVbRhVXf"),
    true,
  );
  assert.equal(
    isValidSupabaseAnonKey("https://abcdefghijklmnop.supabase.co"),
    false,
  );
  assert.equal(isValidSupabaseAnonKey(""), false);
});
