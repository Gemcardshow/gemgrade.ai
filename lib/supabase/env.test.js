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
    isValidSupabaseProjectUrl("https://your-project.supabase.co"),
    true,
  );
  assert.equal(
    isValidSupabaseProjectUrl("https://not-supabase.example.com"),
    false,
  );
  assert.equal(isValidSupabaseProjectUrl("not-a-url"), false);
});

test("isValidSupabaseAnonKey rejects URL strings and non-JWT values", () => {
  assert.equal(
    isValidSupabaseAnonKey(
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def",
    ),
    true,
  );
  assert.equal(
    isValidSupabaseAnonKey("https://abcdefghijklmnop.supabase.co"),
    false,
  );
  assert.equal(isValidSupabaseAnonKey(""), false);
});
