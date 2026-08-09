import assert from "node:assert/strict";
import test from "node:test";
import {
  APPLE_REVIEW_CREDIT_BALANCE,
  getAppleReviewerCredentialsFromEnv,
  provisionAppleReviewerAccount,
  upsertAppleReviewerAuthUser,
} from "./appleReviewerAccount.js";

test("getAppleReviewerCredentialsFromEnv requires email and strong password", () => {
  assert.throws(
    () => getAppleReviewerCredentialsFromEnv({}),
    /APPLE_REVIEW_EMAIL/,
  );
  assert.throws(
    () =>
      getAppleReviewerCredentialsFromEnv({
        APPLE_REVIEW_EMAIL: "review@example.com",
        APPLE_REVIEW_PASSWORD: "short",
      }),
    /APPLE_REVIEW_PASSWORD/,
  );

  const credentials = getAppleReviewerCredentialsFromEnv({
    APPLE_REVIEW_EMAIL: "  Review@Example.com ",
    APPLE_REVIEW_PASSWORD: "secure-pass-123",
  });

  assert.deepEqual(credentials, {
    email: "review@example.com",
    password: "secure-pass-123",
  });
});

test("upsertAppleReviewerAuthUser creates a confirmed password user", async () => {
  /** @type {Record<string, unknown>[]} */
  const creates = [];
  const supabase = {
    auth: {
      admin: {
        async createUser(payload) {
          creates.push(payload);
          return {
            data: { user: { id: "user-1", email: payload.email } },
            error: null,
          };
        },
      },
    },
  };

  const result = await upsertAppleReviewerAuthUser(supabase, {
    email: "review@example.com",
    password: "secure-pass-123",
  });

  assert.equal(result.created, true);
  assert.equal(result.userId, "user-1");
  assert.equal(creates[0].email_confirm, true);
  assert.equal(creates[0].password, "secure-pass-123");
  assert.equal(creates[0].user_metadata.source, "apple_app_review");
});

test("upsertAppleReviewerAuthUser updates an existing user password", async () => {
  const supabase = {
    auth: {
      admin: {
        async createUser() {
          return {
            data: { user: null },
            error: { message: "User already registered" },
          };
        },
        async updateUserById(id, payload) {
          assert.equal(id, "user-existing");
          assert.equal(payload.password, "new-secure-pass");
          assert.equal(payload.email_confirm, true);
          return {
            data: { user: { id, email: payload.email } },
            error: null,
          };
        },
      },
    },
    from(table) {
      assert.equal(table, "profiles");
      return {
        select() {
          return {
            ilike() {
              return {
                maybeSingle: async () => ({
                  data: { id: "user-existing", email: "review@example.com" },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };

  const result = await upsertAppleReviewerAuthUser(supabase, {
    email: "review@example.com",
    password: "new-secure-pass",
  });

  assert.equal(result.created, false);
  assert.equal(result.userId, "user-existing");
});

test("provisionAppleReviewerAccount wires create + credit grant", async () => {
  let balance = 12;
  const supabase = {
    auth: {
      admin: {
        async createUser(payload) {
          return {
            data: { user: { id: "user-new", email: payload.email } },
            error: null,
          };
        },
      },
    },
    from(table) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data:
                    table === "profiles"
                      ? {
                          id: "user-new",
                          email: "review@example.com",
                          credit_balance: balance,
                        }
                      : null,
                  error: null,
                }),
                single: async () => ({ data: { id: "txn-1" }, error: null }),
                order() {
                  return {
                    limit: async () => ({ data: [], error: null }),
                  };
                },
              };
            },
          };
        },
        insert() {
          return {
            select() {
              return {
                single: async () => ({ data: { id: "txn-1" }, error: null }),
              };
            },
          };
        },
        update(payload) {
          if (typeof payload.credit_balance === "number") {
            balance = payload.credit_balance;
          }
          return {
            eq: async () => ({ error: null }),
          };
        },
      };
    },
  };

  const result = await provisionAppleReviewerAccount(supabase, {
    email: "review@example.com",
    password: "secure-pass-123",
  });

  assert.equal(result.created, true);
  assert.equal(result.userId, "user-new");
  assert.equal(result.balance, APPLE_REVIEW_CREDIT_BALANCE);
});
