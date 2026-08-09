import assert from "node:assert/strict";
import test from "node:test";
import {
  getAppPlatform,
  isNativeIosApp,
  shouldHideExternalCreditPurchases,
} from "./platform.js";

test("getAppPlatform defaults to web without window", () => {
  assert.equal(getAppPlatform(), "web");
  assert.equal(isNativeIosApp(), false);
  assert.equal(shouldHideExternalCreditPurchases(), false);
});

test("getAppPlatform uses Capacitor ios bridge when present", () => {
  const previous = globalThis.window;
  globalThis.window = {
    Capacitor: {
      getPlatform() {
        return "ios";
      },
    },
  };

  try {
    assert.equal(getAppPlatform(), "ios");
    assert.equal(isNativeIosApp(), true);
    assert.equal(shouldHideExternalCreditPurchases(), true);
  } finally {
    if (previous === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previous;
    }
  }
});

test("getAppPlatform keeps android purchase UI enabled", () => {
  const previous = globalThis.window;
  globalThis.window = {
    Capacitor: {
      getPlatform() {
        return "android";
      },
    },
  };

  try {
    assert.equal(getAppPlatform(), "android");
    assert.equal(isNativeIosApp(), false);
    assert.equal(shouldHideExternalCreditPurchases(), false);
  } finally {
    if (previous === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previous;
    }
  }
});
