"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getAuthCallbackUrl } from "../lib/authRedirect.js";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";

const SEND_COOLDOWN_SECONDS = 60;

/**
 * @param {{ message?: string }} error
 */
function getOtpVerifyErrorMessage(error) {
  const message = error?.message?.toLowerCase() ?? "";
  if (message.includes("expired") || message.includes("invalid")) {
    return "That code is invalid or has expired. Request a new login code.";
  }
  return error?.message ?? "Unable to verify code. Try again.";
}

/**
 * @param {{ message?: string }} error
 * @param {string} fallback
 */
function getOtpSendErrorMessage(error, fallback) {
  const message = error?.message?.toLowerCase() ?? "";
  if (
    message.includes("rate limit") ||
    message.includes("email rate limit") ||
    message.includes("too many")
  ) {
    return "Too many login emails were requested. Please wait a minute and try again.";
  }
  return error?.message ?? fallback;
}

/**
 * @param {{ callbackError?: string }} props
 */
export default function LoginForm({ callbackError }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(
    callbackError === "auth_callback_error"
      ? "Sign-in link expired or was invalid. Request a new magic link."
      : callbackError === "shopify_handoff_error"
        ? "We could not continue from Gem Card Show. Sign in with your email below."
        : "",
  );
  const [sendCodeLoading, setSendCodeLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const sendCooldownActive = cooldownSeconds > 0;

  useEffect(() => {
    if (!sendCooldownActive) {
      return;
    }

    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [sendCooldownActive]);

  function getSupabase() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      throw new Error(
        "Supabase auth is not configured correctly. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then redeploy.",
      );
    }
    return supabase;
  }

  function startSendCooldown() {
    setCooldownSeconds(SEND_COOLDOWN_SECONDS);
  }

  function resetLoginForm() {
    setEmail("");
    setCode("");
    setMessage("");
    setError("");
    setCodeSent(false);
    setCooldownSeconds(0);
  }

  function getSendAgainLabel() {
    return `Send again in ${cooldownSeconds}s`;
  }

  async function handleSendCode(event) {
    event.preventDefault();
    if (sendCooldownActive || sendCodeLoading) {
      return;
    }

    setSendCodeLoading(true);
    setMessage("");
    setError("");
    setCode("");

    try {
      const supabase = getSupabase();
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
      });

      if (signInError) {
        throw signInError;
      }

      setCodeSent(true);
      startSendCooldown();
      setMessage(
        "We sent a login code to your email. Enter it below to sign in on this device.",
      );
    } catch (submitError) {
      setError(
        getOtpSendErrorMessage(submitError, "Unable to send login code."),
      );
    } finally {
      setSendCodeLoading(false);
    }
  }

  async function handleVerifyCode(event) {
    event.preventDefault();
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setError("Enter the login code from your email.");
      return;
    }

    setVerifyLoading(true);
    setMessage("");
    setError("");

    try {
      const supabase = getSupabase();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: trimmedCode,
        type: "email",
      });

      if (verifyError) {
        throw verifyError;
      }

      router.push("/");
      router.refresh();
    } catch (verifyErr) {
      setError(getOtpVerifyErrorMessage(verifyErr));
    } finally {
      setVerifyLoading(false);
    }
  }

  async function handleSendMagicLink(event) {
    event.preventDefault();
    if (sendCooldownActive || magicLinkLoading) {
      return;
    }

    setMagicLinkLoading(true);
    setMessage("");
    setError("");

    try {
      const supabase = getSupabase();
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

      startSendCooldown();
      setMessage(
        "Check your email for the magic link. Open it on this device to sign in here.",
      );
    } catch (submitError) {
      setError(
        getOtpSendErrorMessage(submitError, "Unable to send magic link."),
      );
    } finally {
      setMagicLinkLoading(false);
    }
  }

  return (
    <div className="login-form">
      <p className="login-form__hint">
        Use a login code to sign in on this iPad or device. Check your email on
        any phone or computer, then enter the code here.
      </p>

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

      <button
        type="button"
        className="btn btn--primary"
        disabled={sendCodeLoading || !email.trim() || sendCooldownActive}
        onClick={handleSendCode}
      >
        {sendCodeLoading
          ? "Sending..."
          : sendCooldownActive
            ? getSendAgainLabel()
            : "Send login code"}
      </button>

      {codeSent ? (
        <div className="login-form__code-section">
          <label htmlFor="login-code">
            Login code
            <input
              id="login-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              required
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, ""))
              }
              placeholder="Enter code from email"
              className="login-form__code-input"
            />
          </label>

          <button
            type="button"
            className="btn btn--primary"
            disabled={verifyLoading || !code.trim()}
            onClick={handleVerifyCode}
          >
            {verifyLoading ? "Verifying..." : "Verify code"}
          </button>

          <button
            type="button"
            className="login-form__different-email"
            onClick={resetLoginForm}
          >
            Use a different email
          </button>
        </div>
      ) : null}

      {message ? <p className="login-form__message">{message}</p> : null}
      {error ? <p className="login-form__error">{error}</p> : null}

      <div className="login-form__divider" role="separator">
        <span>or</span>
      </div>

      <button
        type="button"
        className="btn login-form__magic-link-btn"
        disabled={magicLinkLoading || !email.trim() || sendCooldownActive}
        onClick={handleSendMagicLink}
      >
        {magicLinkLoading
          ? "Sending..."
          : sendCooldownActive
            ? getSendAgainLabel()
            : "Send magic link instead"}
      </button>
    </div>
  );
}
