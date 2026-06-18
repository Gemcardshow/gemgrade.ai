"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchAuthed } from "../lib/fetchAuthed.js";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";
import { hasUsableSupabasePublicConfig } from "../lib/supabase/env.js";

/**
 * @param {{ detail?: { balance?: number } }} event
 */
function readBalanceFromEvent(event) {
  const balance = event?.detail?.balance;
  return typeof balance === "number" ? balance : null;
}

/**
 * @param {{
 *   syncBalance?: number | null,
 *   syncDeduction?: number | null,
 * }} props
 */
export default function ScanCreditBalanceCard({
  syncBalance = null,
  syncDeduction = null,
}) {
  const [balance, setBalance] = useState(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [configured] = useState(() => hasUsableSupabasePublicConfig());

  const loadBalance = useCallback(async () => {
    setLoadingBalance(true);

    try {
      const response = await fetchAuthed("/api/credits/balance");

      if (!response.ok) {
        setBalance(null);
        return;
      }

      const data = await response.json();
      setBalance(typeof data.balance === "number" ? data.balance : null);
    } finally {
      setLoadingBalance(false);
    }
  }, []);

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

    async function syncAuthState() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active) {
        return;
      }

      const isSignedIn = Boolean(user);
      setSignedIn(isSignedIn);

      if (isSignedIn) {
        await loadBalance();
      } else {
        setBalance(null);
      }

      setReady(true);
    }

    syncAuthState();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const isSignedIn = Boolean(session?.user);
      setSignedIn(isSignedIn);

      if (isSignedIn) {
        loadBalance();
      } else {
        setBalance(null);
      }
    });

    /** @param {Event} event */
    const handleCreditsUpdated = (event) => {
      const eventBalance = readBalanceFromEvent(event);
      if (eventBalance !== null) {
        setBalance(eventBalance);
        return;
      }

      loadBalance();
    };

    window.addEventListener("credits-updated", handleCreditsUpdated);

    return () => {
      active = false;
      subscription.unsubscribe();
      window.removeEventListener("credits-updated", handleCreditsUpdated);
    };
  }, [configured, loadBalance]);

  useEffect(() => {
    if (typeof syncBalance === "number") {
      setBalance(syncBalance);
    }
  }, [syncBalance]);

  if (!configured || !ready || !signedIn) {
    return null;
  }

  const displayBalance = typeof syncBalance === "number" ? syncBalance : balance;
  const showDeduction =
    typeof syncDeduction === "number" &&
    syncDeduction > 0 &&
    typeof displayBalance === "number";

  const balanceLabel = loadingBalance
    ? "..."
    : displayBalance === null
      ? "—"
      : displayBalance;

  return (
    <section className="scan-credit-balance" aria-label="Credit balance">
      <div className="scan-credit-balance__header">
        <p className="scan-credit-balance__eyebrow">Available credits</p>
        <Link href="/credits" className="scan-credit-balance__link">
          Buy credits
        </Link>
      </div>

      <p className="scan-credit-balance__value">{balanceLabel}</p>

      {showDeduction ? (
        <p className="scan-credit-balance__deduction" role="status">
          −{syncDeduction} used · {displayBalance} remaining
        </p>
      ) : (
        <p className="scan-credit-balance__hint">Scout 1 credit · Pro 2 credits</p>
      )}
    </section>
  );
}
