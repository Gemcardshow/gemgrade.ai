"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";
import { hasSupabasePublicConfig } from "../lib/supabase/env.js";

export default function AuthStatus() {
  const [email, setEmail] = useState(null);
  const [ready, setReady] = useState(false);
  const [configured] = useState(() => hasSupabasePublicConfig());

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
      setEmail(user?.email ?? null);
      setReady(true);
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
    await supabase.auth.signOut();
    setEmail(null);
  }

  if (!configured || !ready) {
    return null;
  }

  return (
    <div className="auth-status">
      {email ? (
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
  );
}
