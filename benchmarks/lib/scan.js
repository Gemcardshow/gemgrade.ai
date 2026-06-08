import fs from "node:fs";
import path from "node:path";
import { BENCHMARKS_ROOT } from "./paths.js";
import { isFlatImageSuite, scanFlatFileSuite } from "./scanFlat.js";

const IMAGE_NAMES = ["front.jpg", "back.jpg", "front.jpeg", "back.jpeg", "front.png", "back.png"];

/**
 * @param {string} folderName
 */
export function parseBenchmarkFolder(folderName) {
  const match = folderName.match(/^(.+)-psa(\d+)$/i);
  if (!match) {
    return null;
  }

  const slug = match[1];
  const psaGrade = Number.parseInt(match[2], 10);
  const parts = slug.split("-");
  const year = /^\d{4}$/.test(parts[0]) ? parts[0] : null;
  const nameParts = year ? parts.slice(1) : parts;
  const cardName = [year, ...nameParts]
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return {
    id: folderName,
    slug,
    cardName: cardName || folderName,
    year: year ? Number.parseInt(year, 10) : null,
    psaGrade,
  };
}

/**
 * @param {string} cardDir
 */
function resolveImagePair(cardDir) {
  const files = fs.readdirSync(cardDir);
  const front =
    files.find((name) => /^front\.(jpe?g|png|webp)$/i.test(name)) ?? null;
  const back =
    files.find((name) => /^back\.(jpe?g|png|webp)$/i.test(name)) ?? null;

  if (!front || !back) {
    const missing = [];
    if (!front) missing.push("front");
    if (!back) missing.push("back");
    throw new Error(
      `Missing ${missing.join(" and ")} image in ${cardDir}. Expected ${IMAGE_NAMES.slice(0, 4).join(" or ")}.`
    );
  }

  return { front, back };
}

/**
 * Scan benchmark suite directories under benchmarks/.
 * Each suite folder (e.g. psa-1-3) contains card subfolders with front/back images.
 */
export function scanBenchmarkSuites(rootDir = BENCHMARKS_ROOT) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const suites = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (
      entry.name === "lib" ||
      entry.name === "reports" ||
      entry.name === "cache" ||
      entry.name === "_archive" ||
      entry.name === "psa7-8" ||
      entry.name === "psa9" ||
      entry.name === "psa10"
    ) {
      continue;
    }

    const suitePath = path.join(rootDir, entry.name);

    if (isFlatImageSuite(suitePath)) {
      suites.push(scanFlatFileSuite(suitePath, entry.name));
      continue;
    }

    const cardEntries = fs
      .readdirSync(suitePath, { withFileTypes: true })
      .filter((item) => item.isDirectory());

    const cards = [];

    for (const cardEntry of cardEntries) {
      const meta = parseBenchmarkFolder(cardEntry.name);
      if (!meta) {
        console.warn(
          `[benchmark] Skipping ${cardEntry.name}: expected folder name like 1967-mantle-psa1`
        );
        continue;
      }

      const cardDir = path.join(suitePath, cardEntry.name);
      const { front, back } = resolveImagePair(cardDir);

      cards.push({
        ...meta,
        suiteId: entry.name,
        relativeDir: path.posix.join(entry.name, cardEntry.name),
        images: {
          front: path.posix.join(entry.name, cardEntry.name, front),
          back: path.posix.join(entry.name, cardEntry.name, back),
        },
      });
    }

    cards.sort((a, b) => a.id.localeCompare(b.id));

    if (cards.length > 0) {
      suites.push({
        id: entry.name,
        label: entry.name.toUpperCase().replace(/PSA/g, "PSA "),
        cardCount: cards.length,
        cards,
      });
    }
  }

  suites.sort((a, b) => a.id.localeCompare(b.id));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    root: "benchmarks",
    suites,
  };
}
