"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";
import { hasSupabasePublicConfig } from "../lib/supabase/env.js";

export default function CreditBalance() {
  const [balance, setBalance] = useState(null);
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [configured] = useState(() => hasSupabasePublicConfig());

  const loadBalance = useCallback(async () => {
    const response = await fetch("/api/credits/balance", {
      credentials: "include",
    });

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

    const handleCreditsUpdated = () => {
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

  return (
    <Link href="/credits" className="credit-balance">
      {balance === null ? "Credits" : `${balance} credits`}
    </Link>
  );
}
