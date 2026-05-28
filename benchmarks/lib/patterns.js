/**
 * Heuristic calibration pattern flags from a benchmark run row.
 *
 * @param {{
 *   psaGrade: number,
 *   gemGrade: number,
 *   internalGrade: number,
 *   categoryScores: { corners: number, edges: number, surface: number, centering: number },
 *   defects: Array<{ tag: string, severity: string }>,
 *   primaryLimiter: { tag: string, label: string },
 *   eyeAppealSummary: string,
 *   capAudit: Array<{ source: string }>,
 * }} row
 */
export function detectCalibrationPatterns(row) {
  const patterns = [];
  const delta = row.gemGrade - row.psaGrade;
  const tags = new Set(row.defects.map((d) => d.tag));
  const appeal = (row.eyeAppealSummary || "").toLowerCase();
  const { corners, edges, surface, centering } = row.categoryScores;

  if (row.psaGrade <= 3 && delta >= 2) {
    patterns.push({
      id: "low_grade_inflation",
      label: "Low-grade inflation",
      detail: `PSA ${row.psaGrade} slab projected ${row.gemGrade} (+${delta}).`,
    });
  } else if (row.psaGrade <= 3 && delta >= 1) {
    patterns.push({
      id: "low_grade_inflation",
      label: "Low-grade inflation (mild)",
      detail: `PSA ${row.psaGrade} projected ${row.gemGrade} (+${delta}).`,
    });
  }

  const creaseTags = ["moderate_crease", "severe_crease", "heavy_crease"];
  const hasCrease = creaseTags.some((tag) => tags.has(tag));
  if (
    hasCrease &&
    row.psaGrade <= 3 &&
    row.gemGrade > row.psaGrade + 1 &&
    surface >= 5
  ) {
    patterns.push({
      id: "weak_crease_penalties",
      label: "Weak crease penalties",
      detail: `Crease tag present but surface ${surface} and PSA projection ${row.gemGrade} exceed slab ${row.psaGrade}.`,
    });
  }

  const surfaceWearTags = [
    "surface_scratch_moderate",
    "surface_scratch_light",
    "surface_wear",
    "print_line",
    "staining_light",
    "heavy_staining",
  ];
  const hasSurfaceWear = surfaceWearTags.some((tag) => tags.has(tag));
  if (row.psaGrade <= 3 && surface >= 5.5 && hasSurfaceWear && delta >= 1) {
    patterns.push({
      id: "surface_over_scoring",
      label: "Surface over-scoring",
      detail: `Surface subgrade ${surface} with wear tags on a PSA ${row.psaGrade} card.`,
    });
  }

  const mentionsRounding =
    /\b(round|rounded|soft corner|corner wear)\b/.test(appeal) || tags.has("rounded_corners_all");
  if (
    row.psaGrade <= 3 &&
    corners >= 5.5 &&
    (tags.has("corner_wear_light") || (!tags.has("corner_wear_moderate") && mentionsRounding)) &&
    delta >= 1
  ) {
    patterns.push({
      id: "rounded_corner_under_penalty",
      label: "Rounded corner under-penalty",
      detail: `Corners ${corners} with light/missing corner wear tags on poor-band card.`,
    });
  }

  const appealStrongCentering = /\b(strong|excellent|well)\s+centering\b/.test(appeal);
  if (
    (centering >= 7 && row.primaryLimiter.tag.includes("centering")) ||
    (centering <= 5 && appealStrongCentering) ||
    (centering >= 7 && appeal.includes("off-center"))
  ) {
    patterns.push({
      id: "centering_inconsistency",
      label: "Centering inconsistency",
      detail: `Centering subgrade ${centering} conflicts with limiter/appeal (${row.primaryLimiter.tag}).`,
    });
  }

  if (edges >= 6 && row.psaGrade <= 3 && tags.has("edge_wear_light") && delta >= 1) {
    patterns.push({
      id: "edge_wear_under_penalty",
      label: "Edge wear under-penalty",
      detail: `Edges ${edges} with only edge_wear_light on PSA ${row.psaGrade} card.`,
    });
  }

  if (
    row.capAudit?.some((entry) => entry.source?.startsWith("compound:")) &&
    delta >= 2 &&
    row.psaGrade <= 3
  ) {
    patterns.push({
      id: "compound_cap_miss",
      label: "Compound cap may be insufficient",
      detail: `Compound audit fired but projection still +${delta} vs slab.`,
    });
  }

  return patterns;
}

/**
 * @param {Array<{ patterns: Array<{ id: string }> }>} rows
 */
export function summarizePatternFrequency(rows) {
  /** @type {Map<string, { id: string, label: string, count: number, cards: string[] }>} */
  const map = new Map();

  for (const row of rows) {
    for (const pattern of row.patterns) {
      const existing = map.get(pattern.id);
      if (existing) {
        existing.count += 1;
        existing.cards.push(row.card);
      } else {
        map.set(pattern.id, {
          id: pattern.id,
          label: pattern.label,
          count: 1,
          cards: [row.card],
        });
      }
    }
  }

  return [...map.values()].sort((a, b) => b.count - a.count);
}
