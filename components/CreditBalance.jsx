"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchAuthed } from "../lib/fetchAuthed.js";
import { shouldHideExternalCreditPurchases } from "../lib/platform.js";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";
import { hasUsableSupabasePublicConfig } from "../lib/supabase/env.js";

export default function CreditBalance() {
  const [balance, setBalance] = useState(null);
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [configured] = useState(() => hasUsableSupabasePublicConfig());
  const [hidePurchases, setHidePurchases] = useState(false);

  useEffect(() => {
    setHidePurchases(shouldHideExternalCreditPurchases());
  }, []);

  const loadBalance = useCallback(async () => {
    const response = await fetchAuthed("/api/credits/balance");

    if (!response.ok) {
      setBalance(null);
      return;
    }

    const data = await response.json();
    setBalance(typeof data.balance === "number" ? data.balance : null);
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
      const detailBalance = event?.detail?.balance;
      if (typeof detailBalance === "number") {
        setBalance(detailBalance);
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

  if (!configured || !ready || !signedIn) {
    return null;
  }

  const label = balance === null ? "Credits" : `${balance} credits`;

  if (hidePurchases) {
    return (
      <span className="credit-balance credit-balance--readonly" aria-label={label}>
        {label}
      </span>
    );
  }

  return (
    <Link href="/credits" className="credit-balance">
      {label}
    </Link>
  );
}
