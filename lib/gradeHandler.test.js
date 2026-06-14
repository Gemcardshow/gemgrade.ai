import test from "node:test";
import assert from "node:assert/strict";
import {
  getMissingRequiredEnvVars,
  getSupabaseClient,
} from "./gradeHandler.js";

test("getMissingRequiredEnvVars lists all required keys when unset", () => {
  const saved = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  };

  delete process.env.OPENAI_API_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_ANON_KEY;

  const missing = getMissingRequiredEnvVars();
  assert.ok(missing.includes("OPENAI_API_KEY"));
  assert.ok(missing.includes("SUPABASE_URL"));
  assert.ok(missing.includes("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY"));
  assert.equal(getSupabaseClient(), null);

  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("getMissingRequiredEnvVars accepts SUPABASE_ANON_KEY", () => {
  const saved = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  };

  process.env.OPENAI_API_KEY = "sk-test";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_ANON_KEY = "anon-test";

  assert.deepEqual(getMissingRequiredEnvVars(), []);

  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});
