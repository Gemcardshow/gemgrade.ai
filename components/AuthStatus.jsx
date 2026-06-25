"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GEM_CARD_SHOW_URL } from "../lib/gradePresentation.js";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";
import { hasUsableSupabasePublicConfig } from "../lib/supabase/env.js";
import CreditBalance from "./CreditBalance.jsx";

export default function AuthStatus() {
  const [email, setEmail] = useState(null);
  const [ready, setReady] = useState(false);
  const [configured] = useState(() => hasUsableSupabasePublicConfig());

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

    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (!active) {
          return;
        }
        setEmail(user?.email ?? null);
        setReady(true);
      })
      .catch(() => {
        if (active) {
          setReady(true);
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [configured]);

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    setEmail(null);
  }

  if (!ready) {
    return null;
  }

  return (
    <header className="site-header auth-status">
      <div className="site-brand-group">
        <a
          href={GEM_CARD_SHOW_URL}
          className="site-brand site-brand__store"
          target="_blank"
          rel="noopener noreferrer"
        >
          Gem Card Show
        </a>
        <span className="site-brand__sep" aria-hidden="true">
          ·
        </span>
        <Link href="/" className="site-brand site-brand__app">
          GemGrade
        </Link>
      </div>
      <div className="auth-status__nav">
        {configured ? <CreditBalance /> : null}
        {email ? <Link href="/history">History</Link> : null}
      </div>
      <div className="auth-status__actions">
        {!configured ? (
          <span className="auth-status__label">Auth unavailable</span>
        ) : email ? (
          <>
            <span className="auth-status__label">Signed in as {email}</span>
            <button type="button" onClick={handleSignOut}>
              Sign out
            </button>
          </>
        ) : (
          <Link href="/login">Sign in</Link>
        )}
      </div>
    </header>
  );
}
