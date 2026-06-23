"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";
import { hasUsableSupabasePublicConfig } from "../lib/supabase/env.js";
import { formatGemGradeHeader } from "../lib/gradePresentation.js";
import {
  formatScanDate,
  formatScanModeLabel,
  formatHistoryListConfidence,
  formatHistoryListCredits,
  formatHistoryListEra,
} from "../lib/scanHistory.js";

export default function ScanHistoryList() {
  const [scans, setScans] = useState([]);
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

    async function loadHistory() {
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
        const response = await fetch("/api/scans", { credentials: "include" });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Failed to load scan history.");
        }

        const data = await response.json();
        setScans(Array.isArray(data.scans) ? data.scans : []);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load scan history.",
        );
      } finally {
        setLoading(false);
      }
    }

    loadHistory();

    return () => {
      active = false;
    };
  }, [configured]);

  if (!configured) {
    return (
      <p className="scan-history__message">
        Supabase auth is not configured. Scan history requires sign-in.
      </p>
    );
  }

  if (!authReady || loading) {
    return <p className="scan-history__message">Loading scan history…</p>;
  }

  if (!signedIn) {
    return (
      <div className="scan-history__message">
        <p>
          <Link href="/login">Sign in</Link> to view your scan history.
        </p>
      </div>
    );
  }

  if (error) {
    return <p className="scan-history__error">{error}</p>;
  }

  if (scans.length === 0) {
    return (
      <p className="scan-history__message">
        No scans yet. Grade a card from the{" "}
        <Link href="/">home page</Link> to build your history.
      </p>
    );
  }

  return (
    <div className="scan-history">
      <div className="scan-history__table-wrap">
        <table className="scan-history__table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Mode</th>
              <th>Grade</th>
              <th>Confidence</th>
              <th>Credits</th>
              <th>Era</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {scans.map((scan) => (
              <tr key={scan.id}>
                <td>{formatScanDate(scan.createdAt)}</td>
                <td>
                  <span
                    className={`badge badge--mode-${scan.mode === "scout" ? "scout" : "pro"}`}
                  >
                    {formatScanModeLabel(scan.mode)}
                  </span>
                </td>
                <td>{formatGemGradeHeader(scan.grade)}</td>
                <td>{formatHistoryListConfidence(scan)}</td>
                <td>{formatHistoryListCredits(scan)}</td>
                <td>{formatHistoryListEra(scan)}</td>
                <td>
                  <Link href={`/history/${scan.id}`} className="scan-history__link">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
