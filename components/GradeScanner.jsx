"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { compressImageForUpload } from "../lib/compressImage.js";
import { gradeCard } from "../lib/gradeApi.js";
import {
  clearFileInputValue,
  shouldResetCompanionImagesOnFrontChange,
} from "../lib/gradeScannerForm.js";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";
import { hasUsableSupabasePublicConfig } from "../lib/supabase/env.js";
import GradeResult from "./GradeResult.jsx";
import ScanCreditBalanceCard from "./ScanCreditBalanceCard.jsx";
import ScanProgress from "./ScanProgress.jsx";

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

/**
 * @param {{
 *   label: string,
 *   name: string,
 *   preview: string | null,
 *   onChange: (event: React.ChangeEvent<HTMLInputElement>) => void,
 *   required?: boolean,
 *   hint?: React.ReactNode,
 *   inputRef?: React.RefObject<HTMLInputElement | null>,
 * }} props
 */
function ImageUploadField({
  label,
  name,
  preview,
  onChange,
  required = false,
  hint = null,
  inputRef = null,
}) {
  return (
    <label className="grade-scanner__upload">
      <span className="grade-scanner__upload-label">
        {label}
        {hint}
      </span>
      <input
        ref={inputRef}
        type="file"
        name={name}
        accept="image/*"
        required={required}
        onChange={onChange}
      />
      <div className="grade-scanner__preview-wrap">
        {preview ? (
          <img
            src={preview}
            alt={`${label} preview`}
            className="grade-scanner__preview"
          />
        ) : (
          <div className="grade-scanner__preview-placeholder">
            <span className="grade-scanner__preview-placeholder-label">{label}</span>
            <span className="grade-scanner__preview-placeholder-text">
              No image selected
            </span>
          </div>
        )}
      </div>
    </label>
  );
}

export default function GradeScanner({ email = "" }) {
  const [grade, setGrade] = useState(null);
  const [scanMode, setScanMode] = useState("pro");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(null);
  const [error, setError] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [configured] = useState(() => hasUsableSupabasePublicConfig());
  const [frontPreview, setFrontPreview] = useState(null);
  const [backPreview, setBackPreview] = useState(null);
  const [creditSnapshot, setCreditSnapshot] = useState(null);
  const backInputRef = useRef(null);

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

    if (!supabase) {
      setAuthReady(true);
      return undefined;
    }

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

  useEffect(() => {
    return () => {
      if (frontPreview) {
        URL.revokeObjectURL(frontPreview);
      }
      if (backPreview) {
        URL.revokeObjectURL(backPreview);
      }
    };
  }, [frontPreview, backPreview]);

  function handleImagePreviewChange(setPreview, event) {
    const file = event.target.files?.[0];

    setPreview((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }

      if (!(file instanceof File) || file.size === 0) {
        return null;
      }

      return URL.createObjectURL(file);
    });
  }

  function clearBackImageSelection() {
    setBackPreview((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }

      return null;
    });
    clearFileInputValue(backInputRef.current);
  }

  function handleFrontImageChange(event) {
    handleImagePreviewChange(setFrontPreview, event);

    const file = event.target.files?.[0];
    if (!shouldResetCompanionImagesOnFrontChange(file)) {
      return;
    }

    clearBackImageSelection();
    setGrade(null);
    setError("");
    setCreditSnapshot(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setGrade(null);
    setCreditSnapshot(null);

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
    setLoadingStep("uploading");

    let advanceTimer;

    try {
      const frontImage = await compressImageForUpload(frontFile);
      const backImage = hasBackFile
        ? await compressImageForUpload(backFile)
        : null;

      setLoadingStep("analyzing");
      advanceTimer = window.setTimeout(() => {
        setLoadingStep((current) =>
          current === "analyzing" ? "calculating" : current,
        );
      }, 3000);

      const responseGrade = await gradeCard({
        frontImage,
        backImage,
        email: email || undefined,
        mode: scanMode,
      });

      setLoadingStep("calculating");
      setGrade(responseGrade);

      const creditsPayload = responseGrade?.credits;
      if (creditsPayload && typeof creditsPayload.balance === "number") {
        setCreditSnapshot({
          balance: creditsPayload.balance,
          deducted:
            typeof creditsPayload.deducted === "number"
              ? creditsPayload.deducted
              : null,
        });
        window.dispatchEvent(
          new CustomEvent("credits-updated", {
            detail: { balance: creditsPayload.balance },
          }),
        );
      } else {
        window.dispatchEvent(new Event("credits-updated"));
      }
    } catch (submitError) {
      setError(submitError.message || "Unable to grade card.");
    } finally {
      window.clearTimeout(advanceTimer);
      setLoading(false);
      setLoadingStep(null);
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

      <div className="grade-scanner__panel">
        <form className="grade-scanner__form" onSubmit={handleSubmit}>
        <ScanCreditBalanceCard
          syncBalance={creditSnapshot?.balance ?? null}
          syncDeduction={creditSnapshot?.deducted ?? null}
        />

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

        <div className="grade-scanner__uploads">
          <ImageUploadField
            label="Front image"
            name="frontImage"
            preview={frontPreview}
            required
            onChange={handleFrontImageChange}
          />

          <ImageUploadField
            label="Back image"
            name="backImage"
            preview={backPreview}
            required={!isScoutMode}
            inputRef={backInputRef}
            hint={
              isScoutMode ? (
                <span className="grade-scanner__hint"> (optional for Scout)</span>
              ) : null
            }
            onChange={(event) => handleImagePreviewChange(setBackPreview, event)}
          />
        </div>

        {isScoutMode ? (
          <p className="grade-scanner__hint">
            Scout v1: front-only scans use a temporary adapter that duplicates
            the front image for grading.
          </p>
        ) : null}

        <button
          type="submit"
          className="btn btn--primary"
          disabled={loading || (configured && !signedIn)}
        >
          {loading
            ? "Scanning..."
            : `Scan with ${selectedMode.label} (${selectedMode.credits} credit${selectedMode.credits === 1 ? "" : "s"})`}
        </button>

        <ScanProgress activeStep={loadingStep} />
        </form>
      </div>

      {error ? <p className="grade-scanner__error">{error}</p> : null}
      <GradeResult grade={grade} mode={scanMode} />
    </div>
  );
}
