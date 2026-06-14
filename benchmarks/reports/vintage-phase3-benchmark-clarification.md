# Vintage Phase 3 — Benchmark Clarification

**Generated:** 2026-06-14  
**Purpose:** Document benchmark run context and trusted checkpoint metrics  
**Scope:** Documentation only — **no grading logic or prompt changes**

---

## Failed Live Run (exit code 1)

A combined benchmark task ran:

```bash
node benchmarks/run-vintage-calibration-phase1.mjs
node benchmarks/run-modern910-benchmark.js
```

The **MODERN 9/10 live suite** exited with **code 1** because one card failed during vision API calls:

| Card | Error |
|------|-------|
| **2022 A OHTANI PSA 10** | OpenAI **429 TPM rate limit** — `Limit 200000, Used 200000, Requested 4660. Please try again in 1.398s.` |

All other cards in that run completed. The script sets `process.exitCode = 1` when any card fails, even if a summary report is written.

---

## Resume Run (clean completion)

The failed card was retried with resume:

```bash
node benchmarks/run-modern910-benchmark.js --resume
```

**Result:** **62/62** cards graded. **93.5% within ±1** overall. Exit code **0**.

The Ohtani card graded as **PSA 9** on retry. Updated output: `benchmarks/reports/modern910-benchmark-latest.md` (and JSON companion).

---

## Live MODERN 9/10 ≠ MODERN 10 Regression Gate

These are **different benchmarks** and must not be conflated:

| Benchmark | Script | Cards | Vision | Purpose |
|-----------|--------|------:|--------|---------|
| **Live MODERN 9/10 suite** | `run-modern910-benchmark.js` | **62** | Live API calls | Broad modern PSA 9–10 accuracy study |
| **MODERN 10 regression gate** | `run-modern10-baseline-replay.mjs` | **32** | Cached replay | Vintage-phase regression guard (no live API) |

The live 62-card suite (93.5% within ±1) is **not** the gate used to verify vintage calibration work. The trusted modern regression gate is the **cached MODERN 10 replay** @ `ca78f34`.

---

## Vintage 43/72 — Not a Regression

The failed combined run reported **43/72 within ±1 (59.7%)** on the vintage replay. That figure came from a **stale / pre-3B-1** report snapshot and **must not** be treated as a regression against the Phase 3 checkpoint.

Phase 3B-1 floor recovery shipped in commit `ca78f34` after that run context. Re-verified metrics at the checkpoint are authoritative.

---

## Trusted Checkpoint @ `ca78f34`

**Commit:** `ca78f34befd37eb631793108fe08c70ae1c0339f`  
**Message:** `feat: add vintage phase 3b1 floor recovery`  
**Branch:** `phase2/vintage-research` (synced with origin)

| Gate | Result |
|------|--------|
| **Vintage replay** | **48/72 within ±1** (66.7%) |
| **MODERN 10 replay** | **31/32 within ±1** (96.9%), **0 false-positive tags** |
| **Engine tests** | **198/198 passing** |

Verification commands:

```bash
npm run test:api
node benchmarks/run-vintage-calibration-phase1.mjs
node benchmarks/run-modern10-baseline-replay.mjs
```

---

## What This Document Does Not Change

- **No grading logic changes**
- **No prompt changes**
- **No implementation of Phase 3B-2, 3B-3, or other deferred workstreams**

This document exists solely to prevent misinterpretation of benchmark artifacts from the failed live run and the stale 43/72 vintage figure.

---

## Related Artifacts

| Document | Purpose |
|----------|---------|
| `benchmarks/reports/vintage-phase3b1-checkpoint-report.md` | Phase 3 checkpoint through 3B-1 |
| `benchmarks/reports/vintage-phase3-status.md` | Living Phase 3 status rollup |
| `benchmarks/reports/modern910-benchmark-latest.md` | Live 62-card MODERN 9/10 output |
| **This document** | Benchmark run clarification |
