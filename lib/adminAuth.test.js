import test from "node:test";
import assert from "node:assert/strict";
import {
  isAdminUser,
  parseAdminEmails,
} from "./adminAuth.js";

test("parseAdminEmails reads comma-separated ADMIN_EMAILS", () => {
  const saved = process.env.ADMIN_EMAILS;

  process.env.ADMIN_EMAILS =
    "gemcardshow@gmail.com, akurgin@att.net , extra@example.com";
  assert.deepEqual(parseAdminEmails(), [
    "gemcardshow@gmail.com",
    "akurgin@att.net",
    "extra@example.com",
  ]);

  delete process.env.ADMIN_EMAILS;
  assert.deepEqual(parseAdminEmails(), []);

  if (saved === undefined) {
    delete process.env.ADMIN_EMAILS;
  } else {
    process.env.ADMIN_EMAILS = saved;
  }
});

test("isAdminUser matches allowlisted emails case-insensitively", () => {
  const saved = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "gemcardshow@gmail.com,akurgin@att.net";

  assert.equal(
    isAdminUser({ email: "Gemcardshow@gmail.com" }),
    true,
  );
  assert.equal(isAdminUser({ email: "beta@test.com" }), false);
  assert.equal(isAdminUser(null), false);

  if (saved === undefined) {
    delete process.env.ADMIN_EMAILS;
  } else {
    process.env.ADMIN_EMAILS = saved;
  }
});

test("non-admin users fail the admin allowlist gate", () => {
  const saved = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "admin@example.com";

  assert.equal(isAdminUser({ email: "beta@test.com" }), false);

  if (saved === undefined) {
    delete process.env.ADMIN_EMAILS;
  } else {
    process.env.ADMIN_EMAILS = saved;
  }
});
