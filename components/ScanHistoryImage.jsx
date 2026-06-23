"use client";

import { useState } from "react";
import { buildScanImageUrl } from "../lib/scanHistory.js";

/**
 * @param {{
 *   scanId: string,
 *   side?: "front" | "back",
 *   size?: "list" | "detail",
 *   alt?: string,
 *   hasImage?: boolean | null,
 *   imageUrl?: string | null,
 * }} props
 */
export default function ScanHistoryImage({
  scanId,
  side = "front",
  size = "list",
  alt,
  hasImage = null,
  imageUrl = null,
}) {
  const [failed, setFailed] = useState(false);
  const label = alt ?? (side === "back" ? "Card back" : "Card front");
  const shouldAttempt =
    hasImage !== false &&
    typeof scanId === "string" &&
    scanId.trim().length > 0;
  const src =
    imageUrl && imageUrl.trim()
      ? imageUrl
      : buildScanImageUrl(scanId, side);

  if (!shouldAttempt || failed) {
    return (
      <div
        className={`scan-history__thumb scan-history__thumb--placeholder scan-history__thumb--${size}`}
        aria-hidden={label ? undefined : true}
        role={label ? "img" : undefined}
        aria-label={label ? `${label} unavailable` : undefined}
      />
    );
  }

  return (
    <img
      className={`scan-history__thumb scan-history__thumb--${size}`}
      src={src}
      alt={label}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
