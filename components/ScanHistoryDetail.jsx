"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";
import { hasUsableSupabasePublicConfig } from "../lib/supabase/env.js";
import {
  formatScanDate,
  formatScanModeLabel,
  formatHistoryListConfidence,
  formatHistoryListCredits,
  formatHistoryListEra,
  normalizeHistoryGradeResult,
} from "../lib/scanHistory.js";
import GradeResult from "./GradeResult.jsx";
import ScanHistoryImage from "./ScanHistoryImage.jsx";

/**
 * @param {{ scanId: string }} props
 */
export default function ScanHistoryDetail({ scanId }) {
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [configured] = useState(() => hasUsableSupabasePublicConfig());

  useEffect(() => {
    if (!configured) {
      setAuthReady(true);
      setLoading(false);
      return undefined;
    }

    let active = true;
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setAuthReady(true);
      setLoading(false);
      return undefined;
    }

    async function loadScan() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active) {
        return;
      }

      const isSignedIn = Boolean(user);
      setSignedIn(isSignedIn);
      setAuthReady(true);

      if (!isSignedIn) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/scans/${scanId}`, {
          credentials: "include",
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Failed to load scan.");
        }

        const data = await response.json();
        setScan(data.scan ?? null);
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "Failed to load scan.",
        );
      } finally {
        setLoading(false);
      }
    }

    loadScan();

    return () => {
      active = false;
    };
  }, [configured, scanId]);

  if (!configured) {
    return (
      <p className="scan-history__message">
        Supabase auth is not configured. Scan history requires sign-in.
      </p>
    );
  }

  if (!authReady || loading) {
    return <p className="scan-history__message">Loading scan…</p>;
  }

  if (!signedIn) {
    return (
      <p className="scan-history__message">
        <Link href="/login">Sign in</Link> to view scan details.
      </p>
    );
  }

  if (error) {
    return <p className="scan-history__error">{error}</p>;
  }

  if (!scan) {
    return <p className="scan-history__error">Scan not found.</p>;
  }

  const safeGrade = normalizeHistoryGradeResult(scan);
  const creditsLabel = formatHistoryListCredits(scan);
  const creditsMeta =
    creditsLabel === "—"
      ? "Credits unavailable"
      : `${creditsLabel} credit${scan.creditsUsed === 1 ? "" : "s"}`;

  return (
    <div className="scan-history-detail">
      <header className="scan-history-detail__header">
        <div className="scan-history-detail__hero">
          <div className="scan-history-detail__hero-copy">
            <p className="scan-history-detail__meta">
              {formatScanDate(scan.createdAt)} · {formatScanModeLabel(scan.mode)} ·{" "}
              {creditsMeta}
              {scan.era ? ` · ${scan.era}` : ""}
            </p>
            <p className="scan-history-detail__confidence">
              Confidence: {formatHistoryListConfidence(scan)}
            </p>
          </div>
        </div>
      </header>

      <section className="scan-history-detail__images" aria-label="Card images">
        <figure className="scan-history-detail__figure">
          <ScanHistoryImage
            scanId={scan.id}
            side="front"
            size="detail"
            hasImage={scan.hasFrontImage}
            imageUrl={scan.frontThumbnailUrl}
          />
          <figcaption>Front</figcaption>
        </figure>
        <figure className="scan-history-detail__figure">
          <ScanHistoryImage
            scanId={scan.id}
            side="back"
            size="detail"
            hasImage={scan.hasBackImage}
            imageUrl={scan.backImageUrl}
          />
          <figcaption>Back</figcaption>
        </figure>
      </section>

      <GradeResult grade={safeGrade} mode={scan.mode} />

      {scan.verdict ? (
        <article className="grade-card">
          <h3>Verdict</h3>
          <p className="grade-result__verdict">{scan.verdict}</p>
        </article>
      ) : null}

      <p>
        <Link href="/history">Back to scan history</Link>
      </p>
    </div>
  );
}
