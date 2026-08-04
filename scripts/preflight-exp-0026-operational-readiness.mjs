import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { connectCdpBrowser } from "./lib/cdp-browser.mjs";
import { startExp0026Server } from "./lib/exp-0026-process.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const outputPath = resolve(
  projectRoot,
  "eval/generated/exp-0026/operational-readiness-preflight-v0.1.json"
);
const sha256 = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const testFiles = [
  "tests/exp-0026-analysis.test.mjs",
  "tests/exp-0026-blind-analysis.test.mjs",
  "tests/exp-0026-data-lifecycle.test.mjs",
  "tests/exp-0026-freeze.test.mjs",
  "tests/exp-0026-instrument.test.mjs",
  "tests/exp-0026-operational-readiness.test.mjs",
  "tests/exp-0026-replacements.test.mjs",
  "tests/exp-0026-session-store.test.mjs"
];
const testOutput = execFileSync(process.execPath, ["--test", ...testFiles], {
  cwd: projectRoot,
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024
});
execFileSync(process.execPath, [
  "scripts/materialize-exp-0026-stimuli.mjs",
  "--check"
], { cwd: projectRoot, stdio: "pipe" });
const tempRoot = await mkdtemp(join(tmpdir(), "exp0026-oq-preflight-"));
let server = null;
let browser = null;
try {
  server = await startExp0026Server({
    projectRoot,
    runtime: "full",
    role: "dry-run",
    participantAlias: "OQ-PREFLIGHT",
    orderIndex: 0,
    dataRoot: resolve(tempRoot, "private"),
    commercialAvailable: false,
    mirrorLogs: false
  });
  browser = await connectCdpBrowser();
  const [amendmentBytes, vocabularyBytes] = await Promise.all([
    readFile(resolve(
      projectRoot,
      "docs/experiments/EXP-0026-operational-readiness-amendment.md"
    )),
    readFile(resolve(
      projectRoot,
      "eval/experiments/exp-0026-technical-signatures-v0.1.json"
    ))
  ]);
  const core = {
    schemaVersion: "exp-0026-operational-readiness-preflight-v1",
    experimentId: "EXP-0026",
    completedAt: new Date().toISOString(),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8"
    }).trim(),
    inputs: {
      amendmentSha256: sha256(amendmentBytes),
      signatureVocabularySha256: sha256(vocabularyBytes),
      testFiles
    },
    evidence: {
      targetedTestsPassed: /# fail 0\b/u.test(testOutput),
      targetedTestOutputSha256: sha256(Buffer.from(testOutput)),
      stimuliHashCheckPassed: true,
      exactRuntimeHealthReady:
        server.health.asr.state === "ready" &&
        server.health.tts.state === "ready" &&
        server.health.brain === "openai" &&
        server.health.models.interaction === "gpt-5.6-luna" &&
        server.health.models.task === "gpt-5.6-luna" &&
        server.health.usage.requests === 0 &&
        server.health.usage.requestLimit === 25,
      windowsChromeCdpReady: Boolean(browser.version?.Browser)
    },
    scope: {
      microphoneOpened: false,
      audibleStimulusPlayed: false,
      physicalAttemptConsumed: false,
      externalLlmRequests: 0
    }
  };
  const report = {
    ...core,
    pass: Object.values(core.evidence).every((value) =>
      typeof value === "boolean" ? value : true),
    preflightSha256: `sha256:${canonicalSha256(core)}`
  };
  if (!report.pass) throw new Error("preflight operacional EXP-0026 falhou");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => {});
  await server?.stop().catch(() => {});
  await rm(tempRoot, { recursive: true, force: true });
}
