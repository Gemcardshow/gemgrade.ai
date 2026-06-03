import fs from "node:fs";
import path from "node:path";

const FLAT_FILE_RE =
  /^(.+?)\s+PSA\s*(\d+)\s+(FRONT|BACK)\s*\.(jpe?g|png|webp)$/i;

/**
 * Scan a suite folder where each card is a FRONT/BACK filename pair
 * (e.g. "1980 T HENDERSON PSA 6 FRONT.jpg").
 *
 * @param {string} suitePath
 * @param {string} suiteId
 */
export function scanFlatFileSuite(suitePath, suiteId) {
  const files = fs.readdirSync(suitePath).filter((name) => /\.(jpe?g|png|webp)$/i.test(name));
  /** @type {Map<string, { label: string, psaGrade: number, front: string|null, back: string|null }>} */
  const groups = new Map();

  for (const file of files) {
    const match = file.match(FLAT_FILE_RE);
    if (!match) {
      console.warn(`[benchmark] Skipping ${file}: expected "NAME PSA N FRONT.jpg"`);
      continue;
    }

    const label = match[1].trim().replace(/\s+/g, " ");
    const psaGrade = Number.parseInt(match[2], 10);
    const side = match[3].toUpperCase();
    const key = `${label.toLowerCase()}|psa${psaGrade}`;

    if (!groups.has(key)) {
      groups.set(key, { label, psaGrade, front: null, back: null });
    }

    const group = groups.get(key);
    if (side === "FRONT") group.front = file;
    else group.back = file;
  }

  const cards = [];

  for (const [key, group] of groups) {
    if (!group.front || !group.back) {
      console.warn(
        `[benchmark] Skipping ${group.label} PSA ${group.psaGrade}: missing ${
          group.front ? "back" : "front"
        }`
      );
      continue;
    }

    const yearMatch = group.label.match(/^(\d{3,4})\b/);
    const id = `${key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

    cards.push({
      id,
      slug: id,
      cardName: group.label,
      fileLabel: `${group.label} PSA ${group.psaGrade}`,
      year: yearMatch ? Number.parseInt(yearMatch[1], 10) : null,
      psaGrade: group.psaGrade,
      suiteId,
      relativeDir: suiteId,
      images: {
        front: path.posix.join(suiteId, group.front),
        back: path.posix.join(suiteId, group.back),
      },
    });
  }

  cards.sort((a, b) => a.cardName.localeCompare(b.cardName));

  return {
    id: suiteId,
    label: suiteId,
    cardCount: cards.length,
    cards,
  };
}

/**
 * @param {string} suitePath
 */
export function isFlatImageSuite(suitePath) {
  const entries = fs.readdirSync(suitePath, { withFileTypes: true });
  const hasSubdirs = entries.some((e) => e.isDirectory());
  if (hasSubdirs) return false;
  return entries.some(
    (e) => e.isFile() && FLAT_FILE_RE.test(e.name)
  );
}
