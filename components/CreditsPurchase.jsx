"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import PurchasePackCard from "./PurchasePackCard.jsx";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";
import { hasSupabasePublicConfig } from "../lib/supabase/env.js";

const PACK_CATALOG = [
  { key: "starter", label: "Starter", credits: 10 },
  { key: "standard", label: "Standard", credits: 50 },
  { key: "pro", label: "Pro", credits: 100 },
];

export default function CreditsPurchase() {
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [balance, setBalance] = useState(null);
  const [activePack, setActivePack] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [configured] = useState(() => hasSupabasePublicConfig());

  const loadBalance = useCallback(async () => {
    const response = await fetch("/api/credits/balance", {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Unable to load credit balance.");
    }

    const data = await response.json();
    setBalance(typeof data.balance === "number" ? data.balance : 0);
    return data;
  }, []);

  useEffect(() => {
    if (!configured) {
      setReady(true);
      return undefined;
    }

    let active = true;
    const supabase = createSupabaseBrowserClient();

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!active) {
        return;
      }

      const isSignedIn = Boolean(user);
      setSignedIn(isSignedIn);

      if (isSignedIn) {
        loadBalance().catch(() => {
          setError("Unable to load credit balance.");
        });
      }

      setReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session?.user));
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [configured, loadBalance]);

  async function handlePurchase(packKey) {
    setActivePack(packKey);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/credits/purchase", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pack: packKey }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Purchase failed.");
      }

      setBalance(data.balance);
      setMessage(
        `Added ${data.creditsGranted} credits. New balance: ${data.balance}.`,
      );
      window.dispatchEvent(new Event("credits-updated"));
    } catch (purchaseError) {
      const text =
        purchaseError instanceof Error
          ? purchaseError.message
          : "Purchase failed.";
      setError(text);
    } finally {
      setActivePack(null);
    }
  }

  if (!configured) {
    return (
      <p className="credits-page__error">
        Supabase auth is not configured for credit purchases.
      </p>
    );
  }

  if (!ready) {
    return <p className="credits-page__note">Loading credits...</p>;
  }

  if (!signedIn) {
    return (
      <div className="credits-page__sign-in">
        <p>Sign in to view your balance and purchase placeholder credits.</p>
        <Link href="/login">Sign in</Link>
      </div>
    );
  }

  return (
    <div className="credits-page">
      <p className="credits-page__balance">
        Current balance:{" "}
        <strong>{balance === null ? "..." : balance} credits</strong>
      </p>

      <p className="credits-page__note">
        Placeholder purchase mode — credits are granted instantly for testing.
        Real payments will replace this in a later sprint.
      </p>

      <div className="credits-page__packs">
        {PACK_CATALOG.map((pack) => (
          <PurchasePackCard
            key={pack.key}
            packKey={pack.key}
            label={pack.label}
            credits={pack.credits}
            loading={activePack === pack.key}
            disabled={activePack !== null && activePack !== pack.key}
            onPurchase={handlePurchase}
          />
        ))}
      </div>

      {message ? <p className="credits-page__message">{message}</p> : null}
      {error ? <p className="credits-page__error">{error}</p> : null}
    </div>
  );
}
