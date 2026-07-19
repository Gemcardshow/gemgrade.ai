import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const extensionSource = fs.readFileSync(
  new URL("../extensions/gemgrade-open/src/OpenGemGrade.jsx", import.meta.url),
  "utf8",
);
const callbackSource = fs.readFileSync(
  new URL("../app/auth/shopify/callback/route.js", import.meta.url),
  "utf8",
);

test("customer-account extension requests a fresh token from the first click", () => {
  assert.match(extensionSource, /onClick=\{onRequestToken\}/);
  assert.match(
    extensionSource,
    /async function onRequestToken\(\)[\s\S]*shopify\.sessionToken\.get\(\)/,
  );
  assert.match(extensionSource, /token_request_started/);
  assert.match(extensionSource, /token_ready/);
  assert.match(extensionSource, /token_failed/);
});

test("customer-account extension never uses programmatic external navigation", () => {
  assert.doesNotMatch(extensionSource, /\bwindow\.open\s*\(/);
  assert.doesNotMatch(extensionSource, /(?:^|[^.\w])open\s*\(/m);
});

test("supported href navigation renders only after token retrieval", () => {
  assert.match(
    extensionSource,
    /status === "navigation_ready" && handoffHref[\s\S]*href=\{handoffHref\}[\s\S]*Continue to GemGrade/,
  );
  assert.match(
    extensionSource,
    /setHandoffHref\(href\);[\s\S]*setStatus\("navigation_ready"\)/,
  );
});

test("customer-account extension has no App Proxy authentication fallback", () => {
  assert.doesNotMatch(extensionSource, /\/apps\/gghandoff|FALLBACK_URL/);
});

test("Shopify callback uses explicit secure host-only cookie flags", () => {
  assert.match(
    callbackSource,
    /cookieOptions:\s*\{\s*secure:\s*true,\s*sameSite:\s*"lax",\s*path:\s*"\/",\s*\}/,
  );
  const cookieOptions = callbackSource.match(/cookieOptions:\s*\{([\s\S]*?)\}/)?.[1];
  assert.ok(cookieOptions);
  assert.doesNotMatch(cookieOptions, /domain\s*:/);
  assert.match(callbackSource, /response\.cookies\.set\(name, value, options\)/);
});
