import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const outputPath = resolve(
  projectRoot,
  "eval/commitments/exp-0026-operational-readiness-opening-v0.1.json"
);
const preflightPath = resolve(
  projectRoot,
  "eval/generated/exp-0026/operational-readiness-preflight-v0.1.json"
);
const sha256 = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const git = (...args) => execFileSync("git", args, {
  cwd: projectRoot,
  encoding: "utf8"
}).trim();
if (git("status", "--porcelain=v1", "--untracked-files=all") !== "") {
  throw new Error("worktree precisa estar limpa antes da abertura acústica");
}
await access(outputPath).then(
  () => { throw new Error("abertura operacional EXP-0026 já existe"); },
  (error) => { if (error.code !== "ENOENT") throw error; }
);
const [preflightBytes, amendmentBytes] = await Promise.all([
  readFile(preflightPath),
  readFile(resolve(
    projectRoot,
    "docs/experiments/EXP-0026-operational-readiness-amendment.md"
  ))
]);
const preflight = JSON.parse(preflightBytes);
if (preflight.pass !== true || preflight.scope?.physicalAttemptConsumed !== false) {
  throw new Error("preflight não qualifica abertura física");
}
const openedAt = new Date().toISOString();
const core = {
  schemaVersion: "exp-0026-operational-readiness-opening-v1",
  experimentId: "EXP-0026",
  status: "OPEN_FOR_ONE_PHYSICAL_QUALIFICATION",
  attemptId: "EXP-0026-OQ-A-ONE",
  sourceCommit: git("rev-parse", "HEAD"),
  openedAt,
  expiresAt: new Date(new Date(openedAt).valueOf() + 24 * 60 * 60 * 1_000)
    .toISOString(),
  budget: {
    physicalAttempts: 1,
    physicalMinutes: 12,
    externalLlmRequests: 2,
    externalSpendUsd: 5,
    gpuHours: 0
  },
  consumptionBoundary:
    "first-audible-stimulus-or-fixed-speech-instruction-or-persisted-microphone-frame",
  preflight: {
    path: "eval/generated/exp-0026/operational-readiness-preflight-v0.1.json",
    fileSha256: sha256(preflightBytes),
    preflightSha256: preflight.preflightSha256
  },
  amendment: {
    path: "docs/experiments/EXP-0026-operational-readiness-amendment.md",
    fileSha256: sha256(amendmentBytes)
  },
  terminalOutcomes: [
    "READY_TO_FREEZE_EXP_0026",
    "NOT_READY_FOR_FREEZE_TERMINAL"
  ]
};
const commitment = {
  ...core,
  commitmentSha256: `sha256:${canonicalSha256(core)}`
};
await writeFile(outputPath, `${JSON.stringify(commitment, null, 2)}\n`, {
  flag: "wx"
});
process.stdout.write(`${JSON.stringify(commitment, null, 2)}\n`);
