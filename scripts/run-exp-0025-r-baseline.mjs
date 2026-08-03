import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  EXP0025_R_BASELINE_BINDING,
  analyzeExp0025RBaselineHeadroom,
  validateExp0025RMaterializedPack
} from "../src/eval/exp-0025-r-floor-control.mjs";
import { canonicalJson, canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import { EXP0025_R_DEVELOPMENT_PACK_PATH } from
  "./build-exp-0025-r-development-pack.mjs";

export const EXP0025_R_BASELINE_REPORT_PATH =
  "eval/reports/exp-0025-r-baseline-headroom-v0.1.json";

const COMPLETED_AT = "2026-08-03T15:05:00.000Z";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function assertBinding(path, expectedSha256) {
  const bytes = await readFile(resolve(path));
  const observed = sha256(bytes);
  if (observed !== expectedSha256) {
    throw new Error(`${path} divergiu: esperado ${expectedSha256}, observado ${observed}`);
  }
  return { path, sha256: observed };
}

export async function buildExp0025RBaselineReport(options = {}) {
  const packPath = options.packPath ?? EXP0025_R_DEVELOPMENT_PACK_PATH;
  const packBytes = await readFile(resolve(packPath));
  const pack = JSON.parse(packBytes.toString("utf8"));
  const validation = validateExp0025RMaterializedPack(pack);
  if (!validation.valid) {
    throw new Error(`pack EXP-0025-R inválido: ${validation.errors.join("; ")}`);
  }
  const [manifest, endpoint] = await Promise.all([
    assertBinding(
      EXP0025_R_BASELINE_BINDING.manifestPath,
      EXP0025_R_BASELINE_BINDING.manifestSha256
    ),
    assertBinding(
      EXP0025_R_BASELINE_BINDING.endpointPath,
      EXP0025_R_BASELINE_BINDING.endpointSha256
    )
  ]);
  const analysis = analyzeExp0025RBaselineHeadroom(pack);
  const core = {
    ...analysis,
    completedAt: COMPLETED_AT,
    pack: {
      ...analysis.pack,
      path: packPath,
      fileSha256: `sha256:${sha256(packBytes)}`
    },
    sourceBindings: { manifest, endpoint },
    nextMove: analysis.gate.pass
      ? "REQUEST_EXTERNAL_EXECUTION_AUTHORIZATION_OR_BUILD_ARTICLE_INSPIRED_L"
      : "CLOSE_EXP_0025_R_WITHOUT_EXTERNAL_SPEND"
  };
  return Object.freeze({
    ...core,
    reportSha256: `sha256:${canonicalSha256(core)}`
  });
}

export function validateExp0025RBaselineReport(report) {
  try {
    if (report?.stage !== "BASELINE_HEADROOM_DEVELOPMENT" ||
      report?.externalExecutionAuthorized !== false ||
      report?.holdoutOpened !== false ||
      report?.authorityEligible !== false ||
      report?.a0At600?.role !== "CADENCE_DIAGNOSTIC_NOT_CHALLENGER") {
      return false;
    }
    const core = structuredClone(report);
    delete core.reportSha256;
    return report.reportSha256 === `sha256:${canonicalSha256(core)}` &&
      report.sourceBindings.manifest.sha256 ===
        EXP0025_R_BASELINE_BINDING.manifestSha256 &&
      report.sourceBindings.endpoint.sha256 ===
        EXP0025_R_BASELINE_BINDING.endpointSha256;
  } catch {
    return false;
  }
}

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, path);
}

export async function materializeExp0025RBaselineReport(options = {}) {
  const path = resolve(options.path ?? EXP0025_R_BASELINE_REPORT_PATH);
  const expected = await buildExp0025RBaselineReport(options);
  if (options.check === true) {
    const observed = JSON.parse(await readFile(path, "utf8"));
    if (!isDeepStrictEqual(observed, expected) ||
      !validateExp0025RBaselineReport(observed)) {
      throw new Error("relatório baseline EXP-0025-R divergiu");
    }
    return observed;
  }
  await writeAtomic(path, `${canonicalJson(expected)}\n`);
  return expected;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((arg) => arg !== "--check")) {
    throw new Error("uso: node scripts/run-exp-0025-r-baseline.mjs [--check]");
  }
  const report = await materializeExp0025RBaselineReport({
    check: args.has("--check")
  });
  process.stdout.write(
    `EXP-0025-R baseline ${report.gate.decision}: ` +
      `${report.gate.observedPrematureTakeovers}/16 tomadas prematuras; ` +
      `A0@600 é apenas diagnóstico; E autorizado=${report.externalExecutionAuthorized}\n`
  );
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
