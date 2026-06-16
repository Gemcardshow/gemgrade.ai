"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";
import { hasSupabasePublicConfig } from "../lib/supabase/env.js";
import { formatScanDate, formatScanModeLabel } from "../lib/scanHistory.js";
import GradeResult from "./GradeResult.jsx";

/**
 * @param {{ scanId: string }} props
 */
export default function ScanHistoryDetail({ scanId }) {
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [configured] = useState(() => hasSupabasePublicConfig());

  useEffect(() => {
    if (!configured) {
      setAuthReady(true);
      setLoading(false);
      return undefined;
    }

    let active = true;
    const supabase = createSupabaseBrowserClient();

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

  return (
    <div className="scan-history-detail">
      <header className="scan-history-detail__header">
        <p className="scan-history-detail__meta">
          {formatScanDate(scan.createdAt)} · {formatScanModeLabel(scan.mode)} ·{" "}
          {scan.creditsUsed != null
            ? `${scan.creditsUsed} credit${scan.creditsUsed === 1 ? "" : "s"}`
            : "Credits unavailable"}
          {scan.era ? ` · ${scan.era}` : ""}
        </p>
      </header>

      <GradeResult grade={scan.result} mode={scan.mode} />

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
