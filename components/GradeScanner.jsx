"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { compressImageForUpload } from "../lib/compressImage.js";
import { gradeCard } from "../lib/gradeApi.js";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";
import { hasSupabasePublicConfig } from "../lib/supabase/env.js";
import GradeResult from "./GradeResult.jsx";

const SCAN_MODES = [
  {
    value: "scout",
    label: "Scout",
    tagline: "Know what to buy",
    credits: 1,
  },
  {
    value: "pro",
    label: "Pro",
    tagline: "Know what you have",
    credits: 2,
  },
];

export default function GradeScanner({ email = "" }) {
  const [grade, setGrade] = useState(null);
  const [scanMode, setScanMode] = useState("pro");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [configured] = useState(() => hasSupabasePublicConfig());

  const selectedMode =
    SCAN_MODES.find((mode) => mode.value === scanMode) ?? SCAN_MODES[1];
  const isScoutMode = scanMode === "scout";

  useEffect(() => {
    if (!configured) {
      setAuthReady(true);
      return undefined;
    }

    let active = true;
    const supabase = createSupabaseBrowserClient();

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!active) {
        return;
      }
      setSignedIn(Boolean(user));
      setAuthReady(true);
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
  }, [configured]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setGrade(null);

    if (configured && !signedIn) {
      setError("Sign in required to grade cards.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const frontFile = formData.get("frontImage");
    const backFile = formData.get("backImage");

    if (!(frontFile instanceof File) || frontFile.size === 0) {
      setError("Front image is required.");
      return;
    }

    const hasBackFile = backFile instanceof File && backFile.size > 0;

    if (!isScoutMode && !hasBackFile) {
      setError("Pro scans require front and back images.");
      return;
    }

    setLoading(true);

    try {
      const frontImage = await compressImageForUpload(frontFile);
      const backImage = hasBackFile
        ? await compressImageForUpload(backFile)
        : null;

      const responseGrade = await gradeCard({
        frontImage,
        backImage,
        email: email || undefined,
        mode: scanMode,
      });

      setGrade(responseGrade);
      window.dispatchEvent(new Event("credits-updated"));
    } catch (submitError) {
      setError(submitError.message || "Unable to grade card.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grade-scanner">
      {configured && authReady && !signedIn ? (
        <p className="grade-scanner__notice">
          <Link href="/login">Sign in</Link> to grade cards. Scout scans cost 1
          credit; Pro scans cost 2 credits.
        </p>
      ) : null}

      <form className="grade-scanner__form" onSubmit={handleSubmit}>
        <fieldset className="scan-mode-selector">
          <legend>Scan mode</legend>
          <div className="scan-mode-selector__options">
            {SCAN_MODES.map((mode) => (
              <label key={mode.value} className="scan-mode-selector__option">
                <input
                  type="radio"
                  name="scanMode"
                  value={mode.value}
                  checked={scanMode === mode.value}
                  onChange={() => setScanMode(mode.value)}
                />
                <span className="scan-mode-selector__label">{mode.label}</span>
                <span className="scan-mode-selector__tagline">{mode.tagline}</span>
                <span className="scan-mode-selector__credits">
                  {mode.credits} credit{mode.credits === 1 ? "" : "s"}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label>
          Front image
          <input type="file" name="frontImage" accept="image/*" required />
        </label>

        <label>
          Back image
          {isScoutMode ? (
            <span className="grade-scanner__hint"> (optional for Scout)</span>
          ) : null}
          <input
            type="file"
            name="backImage"
            accept="image/*"
            required={!isScoutMode}
          />
        </label>

        {isScoutMode ? (
          <p className="grade-scanner__hint">
            Scout v1: front-only scans use a temporary adapter that duplicates
            the front image for grading.
          </p>
        ) : null}

        <button type="submit" disabled={loading || (configured && !signedIn)}>
          {loading
            ? "Grading..."
            : `Scan with ${selectedMode.label} (${selectedMode.credits} credit${selectedMode.credits === 1 ? "" : "s"})`}
        </button>
      </form>

      {error ? <p className="grade-scanner__error">{error}</p> : null}
      <GradeResult grade={grade} mode={scanMode} />
    </div>
  );
}
