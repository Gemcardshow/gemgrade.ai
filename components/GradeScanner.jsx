"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { compressImageForUpload } from "../lib/compressImage.js";
import { gradeCard } from "../lib/gradeApi.js";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";
import { hasSupabasePublicConfig } from "../lib/supabase/env.js";
import GradeResult from "./GradeResult.jsx";

export default function GradeScanner({ email = "" }) {
  const [grade, setGrade] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [configured] = useState(() => hasSupabasePublicConfig());

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

    if (!(frontFile instanceof File) || !(backFile instanceof File)) {
      setError("Front and back card images are required.");
      return;
    }

    setLoading(true);

    try {
      const [frontImage, backImage] = await Promise.all([
        compressImageForUpload(frontFile),
        compressImageForUpload(backFile),
      ]);

      const responseGrade = await gradeCard({
        frontImage,
        backImage,
        email: email || undefined,
        mode: "pro",
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
          <Link href="/login">Sign in</Link> to grade cards. Pro scans cost 2
          credits.
        </p>
      ) : null}

      <form className="grade-scanner__form" onSubmit={handleSubmit}>
        <label>
          Front image
          <input type="file" name="frontImage" accept="image/*" required />
        </label>

        <label>
          Back image
          <input type="file" name="backImage" accept="image/*" required />
        </label>

        <button type="submit" disabled={loading || (configured && !signedIn)}>
          {loading ? "Grading..." : "Grade Card (2 credits)"}
        </button>
      </form>

      {error ? <p className="grade-scanner__error">{error}</p> : null}
      <GradeResult grade={grade} />
    </div>
  );
}
