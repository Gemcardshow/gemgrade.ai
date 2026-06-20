import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateTopActiveUsers,
  countScans,
  daysAgoIso,
  fetchAdminDashboardStats,
  inferScanMode,
  mapRecentScanRow,
  startOfUtcDayIso,
} from "./adminDashboard.js";

test("startOfUtcDayIso returns midnight UTC for the current day", () => {
  const iso = startOfUtcDayIso(new Date("2026-06-10T15:30:00.000Z"));
  assert.equal(iso, "2026-06-10T00:00:00.000Z");
});

test("daysAgoIso subtracts whole-day windows", () => {
  const iso = daysAgoIso(7, new Date("2026-06-10T12:00:00.000Z"));
  assert.equal(iso, "2026-06-03T12:00:00.000Z");
});

test("inferScanMode prefers explicit mode and falls back to credits used", () => {
  assert.equal(inferScanMode(2, "scout"), "scout");
  assert.equal(inferScanMode(1, null), "scout");
  assert.equal(inferScanMode(2, null), "pro");
  assert.equal(inferScanMode(null, null), "unknown");
});

test("mapRecentScanRow omits image fields", () => {
  const mapped = mapRecentScanRow({
    id: "scan-1",
    created_at: "2026-06-10T12:00:00.000Z",
    email: "test@example.com",
    user_id: "user-1",
    grade: 8,
    era: "vintage",
    credits_used: 1,
    verdict: "Strong candidate.",
    front_image: "huge-payload",
  });

  assert.equal(mapped.mode, "scout");
  assert.equal(mapped.email, "test@example.com");
  assert.equal(mapped.verdictPreview, "Strong candidate.");
  assert.equal("front_image" in mapped, false);
});

test("aggregateTopActiveUsers ranks users by scan count", () => {
  const topUsers = aggregateTopActiveUsers(
    [
      { userId: "user-1", email: "a@test.com" },
      { userId: "user-2", email: "b@test.com" },
      { userId: "user-1", email: "a@test.com" },
      { userId: "user-1", email: "a@test.com" },
      { userId: "user-2", email: "b@test.com" },
    ],
    2,
  );

  assert.deepEqual(topUsers, [
    { userId: "user-1", email: "a@test.com", scanCount: 3 },
    { userId: "user-2", email: "b@test.com", scanCount: 2 },
  ]);
});

test("countScans uses id-only head count", async () => {
  let selectColumns = null;
  const supabase = {
    from(table) {
      assert.equal(table, "scans");
      return {
        select(columns, options) {
          selectColumns = columns;
          const isCount = options?.count === "exact" && options?.head === true;
          return {
            gte() {
              return this;
            },
            async then(resolve) {
              assert.equal(isCount, true);
              return resolve({ count: 32, error: null });
            },
          };
        },
      };
    },
  };

  const total = await countScans(supabase);
  assert.equal(selectColumns, "id");
  assert.equal(total, 32);
});

test("countScans paginates when head count fails", async () => {
  let page = 0;
  const supabase = {
    from(table) {
      assert.equal(table, "scans");
      return {
        select(columns, options) {
          const isCount = options?.count === "exact" && options?.head === true;

          if (isCount) {
            return {
              async then(resolve) {
                return resolve({
                  count: null,
                  error: { message: "head count unavailable" },
                });
              },
            };
          }

          assert.equal(columns, "id");
          page += 1;

          return {
            order() {
              return this;
            },
            range() {
              return Promise.resolve({
                data: page === 1 ? [{ id: 1 }, { id: 2 }] : [],
                error: null,
              });
            },
          };
        },
      };
    },
  };

  const total = await countScans(supabase);
  assert.equal(total, 2);
});

test("fetchAdminDashboardStats aggregates dashboard metrics", async () => {
  const now = new Date("2026-06-10T12:00:00.000Z");

  const supabase = {
    from(table) {
      if (table === "profiles" || table === "scans" || table === "credit_transactions") {
        return {
          select(columns, options = {}) {
            const isCount = options.count === "exact" && options.head === true;

            const chain = {
              eq(column, value) {
                this.filters = [...(this.filters ?? []), { column, value, op: "eq" }];
                return this;
              },
              gte(column, value) {
                this.filters = [...(this.filters ?? []), { column, value, op: "gte" }];
                return this;
              },
              in(column, values) {
                this.filters = [...(this.filters ?? []), { column, values, op: "in" }];
                return this;
              },
              order() {
                return this;
              },
              range() {
                return Promise.resolve({ data: [], error: null });
              },
              limit(limitValue) {
                if (table === "scans") {
                  return Promise.resolve({
                    data: [
                      {
                        id: "scan-1",
                        created_at: "2026-06-10T11:00:00.000Z",
                        email: "active@test.com",
                        user_id: "user-1",
                        grade: 8,
                        era: "modern",
                        credits_used: 1,
                        verdict: "Clean card",
                      },
                    ].slice(0, limitValue),
                    error: null,
                  });
                }

                return Promise.resolve({ data: [], error: null });
              },
              async then(resolve) {
                if (isCount) {
                  if (table === "profiles") {
                    return resolve({ count: 12, error: null });
                  }

                  if (table === "scans") {
                    const hasTodayFilter = (this.filters ?? []).some(
                      (filter) => filter.op === "gte" && filter.column === "created_at",
                    );
                    return resolve({ count: hasTodayFilter ? 3 : 40, error: null });
                  }

                  if (table === "credit_transactions") {
                    const typeFilter = (this.filters ?? []).find(
                      (filter) => filter.column === "type",
                    );
                    return resolve({
                      count: typeFilter?.value === "scan_scout" ? 25 : 15,
                      error: null,
                    });
                  }
                }

                if (table === "credit_transactions") {
                  return resolve({
                    data: [
                      { amount: -1, type: "scan_scout" },
                      { amount: -2, type: "scan_pro" },
                    ],
                    error: null,
                  });
                }

                if (table === "scans") {
                  return resolve({
                    data: [
                      {
                        id: "scan-1",
                        created_at: "2026-06-10T11:00:00.000Z",
                        email: "active@test.com",
                        user_id: "user-1",
                        grade: 8,
                        era: "modern",
                        credits_used: 1,
                        verdict: "Clean card",
                      },
                    ],
                    error: null,
                  });
                }

                return resolve({ data: [], error: null });
              },
            };

            return chain;
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
    auth: {
      admin: {
        async listUsers() {
          return {
            data: {
              users: [
                {
                  last_sign_in_at: "2026-06-10T10:00:00.000Z",
                },
                {
                  last_sign_in_at: "2026-06-01T10:00:00.000Z",
                },
              ],
            },
            error: null,
          };
        },
      },
    },
  };

  const stats = await fetchAdminDashboardStats(supabase, now);

  assert.equal(stats.users.total, 12);
  assert.equal(stats.users.signedInLast24Hours, 1);
  assert.equal(stats.users.signedInLast7Days, 1);
  assert.equal(stats.scans.total, 40);
  assert.equal(stats.scans.today, 3);
  assert.equal(stats.scans.scout, 25);
  assert.equal(stats.scans.pro, 15);
  assert.equal(stats.creditsConsumed, 3);
  assert.equal(stats.topActiveUsers[0].email, "active@test.com");
  assert.equal(stats.recentScans[0].mode, "scout");
});
