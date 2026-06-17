"use client";

import { useState } from "react";
import { getAuthCallbackUrl } from "../lib/authRedirect.js";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";

/**
 * @param {{ callbackError?: string }} props
 */
export default function LoginForm({ callbackError }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(
    callbackError === "auth_callback_error"
      ? "Sign-in link expired or was invalid. Request a new magic link."
      : "",
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        throw new Error(
          "Supabase auth is not configured correctly. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then redeploy.",
        );
      }

      const redirectTo = getAuthCallbackUrl(window.location.origin);
      if (!redirectTo) {
        throw new Error(
          "Unable to determine auth callback URL. Set NEXT_PUBLIC_SITE_URL or use the app from a browser origin.",
        );
      }

      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirectTo,
        },
      });

      if (signInError) {
        throw signInError;
      }

      setMessage("Check your email for the magic link.");
    } catch (submitError) {
      const text =
        submitError instanceof Error
          ? submitError.message
          : "Unable to send magic link.";
      setError(text);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <label htmlFor="login-email">
        Email
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </label>

      <button type="submit" className="btn btn--primary" disabled={loading}>
        {loading ? "Sending..." : "Send magic link"}
      </button>

      {message ? <p className="login-form__message">{message}</p> : null}
      {error ? <p className="login-form__error">{error}</p> : null}
    </form>
  );
}
