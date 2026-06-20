"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchAuthed } from "../lib/fetchAuthed.js";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";
import { hasUsableSupabasePublicConfig } from "../lib/supabase/env.js";

function formatDate(isoDate) {
  if (!isoDate) {
    return "—";
  }

  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function AdminCreditsTool() {
  const [configured] = useState(() => hasUsableSupabasePublicConfig());
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [searchEmail, setSearchEmail] = useState("");
  const [reason, setReason] = useState("Beta credit adjustment");
  const [customAmount, setCustomAmount] = useState("");
  const [setBalanceValue, setSetBalanceValue] = useState("");
  const [user, setUser] = useState(null);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const applySearchResult = useCallback((payload) => {
    setUser(payload.user);
    setRecentTransactions(
      Array.isArray(payload.recentTransactions)
        ? payload.recentTransactions
        : [],
    );
  }, []);

  const searchUser = useCallback(
    async (email) => {
      const trimmed = email.trim();

      if (!trimmed) {
        setError("Enter an email to search.");
        return;
      }

      setLoading(true);
      setError("");
      setMessage("");

      try {
        const response = await fetchAuthed(
          `/api/admin/users?email=${encodeURIComponent(trimmed)}`,
        );
        const payload = await response.json().catch(() => ({}));

        if (response.status === 403) {
          setAccessDenied(true);
          setUser(null);
          setRecentTransactions([]);
          return;
        }

        if (response.status === 401) {
          setSignedIn(false);
          return;
        }

        if (!response.ok) {
          throw new Error(payload.error || "Failed to search user.");
        }

        applySearchResult(payload);
        setSearchEmail(trimmed);
      } catch (searchError) {
        setUser(null);
        setRecentTransactions([]);
        setError(
          searchError instanceof Error
            ? searchError.message
            : "Failed to search user.",
        );
      } finally {
        setLoading(false);
      }
    },
    [applySearchResult],
  );

  useEffect(() => {
    if (!configured) {
      setReady(true);
      return undefined;
    }

    let active = true;
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setReady(true);
      return undefined;
    }

    supabase.auth.getUser().then(({ data: { user: sessionUser } }) => {
      if (!active) {
        return;
      }

      setSignedIn(Boolean(sessionUser));
      setReady(true);
    });

    return () => {
      active = false;
    };
  }, [configured]);

  async function adjustCredits({ mode, amount, confirmMessage }) {
    if (!user) {
      setError("Search for a user first.");
      return;
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      setError("Enter a valid non-negative amount.");
      return;
    }

    const trimmedReason = reason.trim();

    if (!trimmedReason) {
      setError("Enter a reason for this adjustment.");
      return;
    }

    if (confirmMessage && !window.confirm(confirmMessage)) {
      return;
    }

    setAdjusting(true);
    setError("");
    setMessage("");

    try {
      const response = await fetchAuthed("/api/admin/credits/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          user_id: user.id,
          amount: numericAmount,
          mode,
          reason: trimmedReason,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (response.status === 403) {
        setAccessDenied(true);
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error || "Failed to adjust credits.");
      }

      setUser((current) =>
        current
          ? {
              ...current,
              balance:
                typeof payload.balance === "number"
                  ? payload.balance
                  : current.balance,
            }
          : current,
      );
      setMessage(
        `Updated ${user.email}: ${payload.previousBalance} → ${payload.balance} credits.`,
      );
      await searchUser(user.email);
    } catch (adjustError) {
      setError(
        adjustError instanceof Error
          ? adjustError.message
          : "Failed to adjust credits.",
      );
    } finally {
      setAdjusting(false);
    }
  }

  if (!configured) {
    return (
      <p className="admin-credits__message">
        Supabase auth is not configured.
      </p>
    );
  }

  if (!ready) {
    return <p className="admin-credits__message">Loading admin tools…</p>;
  }

  if (!signedIn) {
    return (
      <div className="admin-credits__sign-in">
        <p>
          <Link href="/login">Sign in</Link> with an admin account to manage
          credits.
        </p>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <p className="admin-credits__error">
        Access denied. This page is restricted to admin accounts.
      </p>
    );
  }

  return (
    <div className="admin-credits">
      <section className="admin-credits__search">
        <label className="admin-credits__label" htmlFor="admin-search-email">
          Search by email
        </label>
        <div className="admin-credits__search-row">
          <input
            id="admin-search-email"
            type="email"
            className="admin-credits__input"
            value={searchEmail}
            onChange={(event) => setSearchEmail(event.target.value)}
            placeholder="beta.tester@example.com"
            autoComplete="off"
          />
          <button
            type="button"
            className="admin-credits__button"
            onClick={() => searchUser(searchEmail)}
            disabled={loading || adjusting}
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      </section>

      {user ? (
        <section className="admin-credits__card">
          <h2>User</h2>
          <dl className="admin-credits__meta">
            <div>
              <dt>Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd>
                <strong>{user.balance}</strong> credits
              </dd>
            </div>
            <div>
              <dt>User ID</dt>
              <dd>{user.id || "—"}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(user.createdAt)}</dd>
            </div>
          </dl>

          <label className="admin-credits__label" htmlFor="admin-reason">
            Reason
          </label>
          <input
            id="admin-reason"
            type="text"
            className="admin-credits__input"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />

          <div className="admin-credits__actions">
            <button
              type="button"
              className="admin-credits__button admin-credits__button--primary"
              disabled={adjusting}
              onClick={() =>
                adjustCredits({ mode: "add", amount: 50 })
              }
            >
              +50 credits
            </button>
            <button
              type="button"
              className="admin-credits__button admin-credits__button--primary"
              disabled={adjusting}
              onClick={() =>
                adjustCredits({ mode: "add", amount: 100 })
              }
            >
              +100 credits
            </button>
          </div>

          <div className="admin-credits__custom">
            <label className="admin-credits__label" htmlFor="admin-custom-amount">
              Custom amount
            </label>
            <div className="admin-credits__search-row">
              <input
                id="admin-custom-amount"
                type="number"
                min="0"
                className="admin-credits__input"
                value={customAmount}
                onChange={(event) => setCustomAmount(event.target.value)}
              />
              <button
                type="button"
                className="admin-credits__button"
                disabled={adjusting}
                onClick={() =>
                  adjustCredits({
                    mode: "add",
                    amount: customAmount,
                  })
                }
              >
                Add
              </button>
              <button
                type="button"
                className="admin-credits__button admin-credits__button--danger"
                disabled={adjusting}
                onClick={() =>
                  adjustCredits({
                    mode: "subtract",
                    amount: customAmount,
                    confirmMessage: `Subtract ${customAmount} credits from ${user.email}?`,
                  })
                }
              >
                Subtract
              </button>
            </div>
          </div>

          <div className="admin-credits__custom">
            <label className="admin-credits__label" htmlFor="admin-set-balance">
              Set exact balance
            </label>
            <div className="admin-credits__search-row">
              <input
                id="admin-set-balance"
                type="number"
                min="0"
                className="admin-credits__input"
                value={setBalanceValue}
                onChange={(event) => setSetBalanceValue(event.target.value)}
              />
              <button
                type="button"
                className="admin-credits__button admin-credits__button--danger"
                disabled={adjusting}
                onClick={() =>
                  adjustCredits({
                    mode: "set",
                    amount: setBalanceValue,
                    confirmMessage: `Set ${user.email} balance to ${setBalanceValue} credits?`,
                  })
                }
              >
                Set balance
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {message ? <p className="admin-credits__message">{message}</p> : null}
      {error ? <p className="admin-credits__error">{error}</p> : null}

      {recentTransactions.length > 0 ? (
        <section className="admin-credits__transactions">
          <h2>Recent transactions</h2>
          <div className="admin-credits__table-wrap">
            <table className="admin-credits__table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {recentTransactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{formatDate(transaction.createdAt)}</td>
                    <td>{transaction.type}</td>
                    <td>{transaction.amount}</td>
                    <td>
                      {transaction.metadata?.admin_reason ||
                        transaction.metadata?.reason ||
                        "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
