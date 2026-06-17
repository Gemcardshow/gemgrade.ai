import test from "node:test";
import assert from "node:assert/strict";
import { getAuthCallbackUrl, getPublicSiteUrl } from "./authRedirect.js";

test("getPublicSiteUrl prefers NEXT_PUBLIC_SITE_URL over browser origin", () => {
  const saved = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://gemgrade-ai.vercel.app";

  assert.equal(
    getPublicSiteUrl("http://localhost:3000"),
    "https://gemgrade-ai.vercel.app",
  );

  if (saved === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = saved;
  }
});

test("getPublicSiteUrl falls back to browser origin when env unset", () => {
  const saved = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;

  assert.equal(getPublicSiteUrl("http://localhost:3000"), "http://localhost:3000");

  if (saved === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = saved;
  }
});

test("getAuthCallbackUrl builds /auth/callback path", () => {
  const saved = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://gemgrade-ai.vercel.app/";

  assert.equal(
    getAuthCallbackUrl("http://localhost:3000"),
    "https://gemgrade-ai.vercel.app/auth/callback",
  );

  delete process.env.NEXT_PUBLIC_SITE_URL;
  assert.equal(
    getAuthCallbackUrl("http://localhost:3000"),
    "http://localhost:3000/auth/callback",
  );

  if (saved === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = saved;
  }
});
