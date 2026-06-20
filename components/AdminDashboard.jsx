"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  formatDashboardModeLabel,
} from "../lib/adminDashboard.js";
import { formatScanDate } from "../lib/scanHistory.js";
import { fetchAuthed } from "../lib/fetchAuthed.js";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";
import { hasUsableSupabasePublicConfig } from "../lib/supabase/env.js";
import { formatGemGradeHeader } from "../lib/gradePresentation.js";

function StatCard({ label, value, detail = null }) {
  return (
    <article className="admin-dashboard__stat">
      <p className="admin-dashboard__stat-label">{label}</p>
      <p className="admin-dashboard__stat-value">{value}</p>
      {detail ? (
        <p className="admin-dashboard__stat-detail">{detail}</p>
      ) : null}
    </article>
  );
}

export default function AdminDashboard() {
  const [configured] = useState(() => hasUsableSupabasePublicConfig());
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetchAuthed("/api/admin/dashboard");
      const payload = await response.json().catch(() => ({}));

      if (response.status === 403) {
        setAccessDenied(true);
        setStats(null);
        return;
      }

      if (response.status === 401) {
        setSignedIn(false);
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load admin dashboard.");
      }

      setStats(payload);
    } catch (loadError) {
      setStats(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load admin dashboard.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) {
      setReady(true);
      setLoading(false);
      return undefined;
    }

    let active = true;
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setReady(true);
      setLoading(false);
      return undefined;
    }

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!active) {
        return;
      }

      const isSignedIn = Boolean(user);
      setSignedIn(isSignedIn);
      setReady(true);

      if (isSignedIn) {
        loadDashboard();
      } else {
        setLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [configured, loadDashboard]);

  if (!configured) {
    return (
      <p className="admin-dashboard__message">
        Supabase auth is not configured.
      </p>
    );
  }

  if (!ready || loading) {
    return <p className="admin-dashboard__message">Loading dashboard…</p>;
  }

  if (!signedIn) {
    return (
      <div className="admin-dashboard__sign-in">
        <p>
          <Link href="/login">Sign in</Link> with an admin account to view the
          dashboard.
        </p>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <p className="admin-dashboard__error">
        Access denied. This page is restricted to admin accounts.
      </p>
    );
  }

  if (error) {
    return (
      <div className="admin-dashboard">
        <p className="admin-dashboard__error">{error}</p>
        <button
          type="button"
          className="admin-dashboard__button"
          onClick={loadDashboard}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="admin-dashboard">
      <div className="admin-dashboard__toolbar">
        <p className="admin-dashboard__updated">
          Updated {formatScanDate(stats.generatedAt)}
        </p>
        <div className="admin-dashboard__toolbar-actions">
          <Link href="/admin/credits" className="admin-dashboard__link">
            Manage credits
          </Link>
          <button
            type="button"
            className="admin-dashboard__button"
            onClick={loadDashboard}
          >
            Refresh
          </button>
        </div>
      </div>

      <section className="admin-dashboard__stats">
        <StatCard label="Total users" value={stats.users.total} />
        <StatCard
          label="Signed in (24h)"
          value={stats.users.signedInLast24Hours}
        />
        <StatCard
          label="Signed in (7d)"
          value={stats.users.signedInLast7Days}
        />
        <StatCard label="Total scans" value={stats.scans.total} />
        <StatCard label="Scans today" value={stats.scans.today} />
        <StatCard label="Scout scans" value={stats.scans.scout} />
        <StatCard label="Pro scans" value={stats.scans.pro} />
        <StatCard
          label="Credits consumed"
          value={stats.creditsConsumed}
          detail="From scan ledger entries"
        />
      </section>

      <section className="admin-dashboard__panel">
        <h2>Top active users (7 days)</h2>
        {stats.topActiveUsers.length === 0 ? (
          <p className="admin-dashboard__empty">No scans in the last 7 days.</p>
        ) : (
          <div className="admin-dashboard__table-wrap">
            <table className="admin-dashboard__table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>User ID</th>
                  <th>Scans</th>
                </tr>
              </thead>
              <tbody>
                {stats.topActiveUsers.map((user) => (
                  <tr key={user.userId || user.email || user.scanCount}>
                    <td>{user.email || "—"}</td>
                    <td>{user.userId || "—"}</td>
                    <td>{user.scanCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-dashboard__panel">
        <h2>Recent scans</h2>
        {stats.recentScans.length === 0 ? (
          <p className="admin-dashboard__empty">No scans yet.</p>
        ) : (
          <div className="admin-dashboard__table-wrap">
            <table className="admin-dashboard__table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Email</th>
                  <th>Mode</th>
                  <th>Grade</th>
                  <th>Credits</th>
                  <th>Era</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentScans.map((scan) => (
                  <tr key={scan.id}>
                    <td>{formatScanDate(scan.createdAt)}</td>
                    <td>{scan.email || "—"}</td>
                    <td>{formatDashboardModeLabel(scan.mode)}</td>
                    <td>{formatGemGradeHeader(scan.grade)}</td>
                    <td>{scan.creditsUsed ?? "—"}</td>
                    <td>{scan.era || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
