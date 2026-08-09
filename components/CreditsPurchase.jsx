"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import PurchasePackCard from "./PurchasePackCard.jsx";
import { fetchAuthed } from "../lib/fetchAuthed.js";
import { shouldHideExternalCreditPurchases } from "../lib/platform.js";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";
import { hasUsableSupabasePublicConfig } from "../lib/supabase/env.js";

const PACK_CATALOG = [
  {
    key: "10",
    label: "10 scans",
    credits: 10,
    checkoutUrl: "https://gemcardshow.com/products/10-pro-scans",
  },
  {
    key: "25",
    label: "25 scans",
    credits: 25,
    checkoutUrl: "https://gemcardshow.com/products/25-pro-scans",
  },
  {
    key: "50",
    label: "50 scans",
    credits: 50,
    checkoutUrl: "https://gemcardshow.com/products/50-pro-scans",
  },
  {
    key: "100",
    label: "100 scans",
    credits: 100,
    checkoutUrl: "https://gemcardshow.com/products/100-gemgrade-pro-scans",
  },
];

export default function CreditsPurchase() {
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [balance, setBalance] = useState(null);
  const [error, setError] = useState("");
  const [configured] = useState(() => hasUsableSupabasePublicConfig());
  const [hidePurchases, setHidePurchases] = useState(false);

  useEffect(() => {
    setHidePurchases(shouldHideExternalCreditPurchases());
  }, []);

  const loadBalance = useCallback(async () => {
    const response = await fetchAuthed("/api/credits/balance");

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

    if (!supabase) {
      setReady(true);
      return undefined;
    }

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
      const isSignedIn = Boolean(session?.user);
      setSignedIn(isSignedIn);

      if (isSignedIn) {
        loadBalance().catch(() => {
          setError("Unable to load credit balance.");
        });
      } else {
        setBalance(null);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [configured, loadBalance]);

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
        <p>
          {hidePurchases
            ? "Sign in to view your available scan credits."
            : "Sign in to view your balance and purchase scan credits."}
        </p>
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

      {hidePurchases ? (
        <p className="credits-page__note">
          Your existing scan credits are available in the iOS app. Credit
          purchases are not offered in this App Store build.
        </p>
      ) : (
        <>
          <p className="credits-page__note">
            Use the same email at checkout that you use for your GemGrade
            account. Credits are added automatically after payment.
          </p>

          <div className="credits-page__packs">
            {PACK_CATALOG.map((pack) => (
              <PurchasePackCard
                key={pack.key}
                label={pack.label}
                credits={pack.credits}
                checkoutUrl={pack.checkoutUrl}
              />
            ))}
          </div>
        </>
      )}

      {error ? <p className="credits-page__error">{error}</p> : null}
    </div>
  );
}
