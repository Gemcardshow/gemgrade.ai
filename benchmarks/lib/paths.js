import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BENCHMARKS_ROOT = path.resolve(__dirname, "..");
export const REPO_ROOT = path.resolve(BENCHMARKS_ROOT, "..");

export function resolveBenchmarkPath(...segments) {
  return path.join(BENCHMARKS_ROOT, ...segments);
}

export function loadEnvFiles() {
  const candidates = [
    path.join(REPO_ROOT, ".env"),
    path.join(REPO_ROOT, ".env.local"),
    path.join(REPO_ROOT, "api", ".env"),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;

    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

/**
 * Resolve the OpenAI package from repo root or api/ workspace.
 */
export function importOpenAI() {
  const packageCandidates = [
    path.join(REPO_ROOT, "package.json"),
    path.join(REPO_ROOT, "api", "package.json"),
  ];

  for (const packageJson of packageCandidates) {
    if (!fs.existsSync(packageJson)) continue;
    try {
      const require = createRequire(packageJson);
      return require("openai");
    } catch {
      // try next workspace
    }
  }

  throw new Error(
    "openai package not found. Run `npm install` at the repo root or in api/."
  );
}

export function imageToDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : "application/octet-stream";
  const base64 = fs.readFileSync(filePath).toString("base64");
  return `data:${mime};base64,${base64}`;
}
