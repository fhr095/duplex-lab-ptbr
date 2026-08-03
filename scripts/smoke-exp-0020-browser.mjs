import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";

import {
  EXP0020_BOUNDARY_PATHS,
  EXP0020_BROWSER_COMMAND,
  validateExp0020BrowserAttempt,
  validateExp0020InstrumentationFreeze
} from "../src/eval/exp-0020-boundary.mjs";
import {
  EXP0020_CONFIG,
  createExp0020Report,
  validateExp0020Report
} from "../src/eval/exp-0020-stop-order.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import {
  discoverExp0020CdpUrl,
  runExp0020BrowserCampaign
} from "./lib/exp-0020-browser-harness.mjs";

const execFile = promisify(execFileCallback);
const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const RECEIPT_SCHEMA = "exp-0020-browser-attempt-consumption-v1";
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0020 browser runner: ${message}`);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function normalizeSha256(value) {
  if (typeof value !== "string") return null;
  const normalized = value.startsWith("sha256:")
    ? value.toLowerCase()
    : `sha256:${value.toLowerCase()}`;
  return HASH_PATTERN.test(normalized) ? normalized : null;
}

async function gitBytes(projectRoot, ...args) {
  const result = await execFile("git", args, {
    cwd: projectRoot,
    encoding: "buffer",
    maxBuffer: 30 * 1024 * 1024
  });
  return result.stdout;
}

async function gitText(projectRoot, ...args) {
  return (await gitBytes(projectRoot, ...args)).toString("utf8").trim();
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function changedPaths(projectRoot, commit) {
  return (await gitText(
    projectRoot,
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    commit
  )).split(/\r?\n/u).filter(Boolean).toSorted();
}

function artifactRecord(path, bytes, canonicalSha256Value) {
  return {
    path,
    fileSha256: sha256(bytes),
    canonicalSha256: canonicalSha256Value
  };
}

export function parseExp0020BrowserArgs(args) {
  const options = { check: false, cdpUrl: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      invariant(!options.check, "--check duplicado");
      options.check = true;
      continue;
    }
    if (argument === "--cdp-url") {
      invariant(
        options.cdpUrl === null && index + 1 < args.length,
        "--cdp-url duplicado ou sem valor"
      );
      options.cdpUrl = args[++index];
      continue;
    }
    invariant(false, `argumento desconhecido: ${argument}`);
  }
  invariant(
    !options.check || options.cdpUrl === null,
    "--check não aceita CDP"
  );
  return Object.freeze(options);
}

async function verifyExp0020CommittedBoundary(projectRoot, options = {}) {
  const freezePath = resolve(projectRoot, EXP0020_BOUNDARY_PATHS.freeze);
  const attemptPath = resolve(projectRoot, EXP0020_BOUNDARY_PATHS.attempt);
  const [freezeBytes, attemptBytes] = await Promise.all([
    readFile(freezePath),
    readFile(attemptPath)
  ]);
  const freeze = JSON.parse(freezeBytes.toString("utf8"));
  const attempt = JSON.parse(attemptBytes.toString("utf8"));
  const freezeValidation = validateExp0020InstrumentationFreeze(freeze);
  const attemptValidation = validateExp0020BrowserAttempt(attempt);
  invariant(freezeValidation.valid, freezeValidation.errors.join("; "));
  invariant(attemptValidation.valid, attemptValidation.errors.join("; "));

  const attemptCommit = await gitText(
    projectRoot,
    "log",
    "-1",
    "--format=%H",
    "--",
    EXP0020_BOUNDARY_PATHS.attempt
  );
  invariant(/^[a-f0-9]{40}$/u.test(attemptCommit),
    "commit da tentativa não encontrado");
  invariant(
    (await gitBytes(
      projectRoot,
      "show",
      `${attemptCommit}:${EXP0020_BOUNDARY_PATHS.attempt}`
    )).equals(attemptBytes),
    "tentativa precisa estar commitada byte a byte"
  );
  invariant(
    isDeepStrictEqual(
      await changedPaths(projectRoot, attemptCommit),
      [EXP0020_BOUNDARY_PATHS.attempt]
    ),
    "commit da tentativa pode alterar somente a tentativa"
  );
  const freezeCommit = attempt.openingSourceCommit;
  invariant(
    await gitText(projectRoot, "rev-parse", `${attemptCommit}^`) ===
      freezeCommit,
    "commit da tentativa precisa ser filho direto do freeze"
  );
  invariant(
    await gitText(
      projectRoot,
      "log",
      "-1",
      "--format=%H",
      "--",
      EXP0020_BOUNDARY_PATHS.freeze
    ) === freezeCommit,
    "freeze foi alterado depois do commit congelado"
  );
  invariant(
    (await gitBytes(
      projectRoot,
      "show",
      `${freezeCommit}:${EXP0020_BOUNDARY_PATHS.freeze}`
    )).equals(freezeBytes),
    "freeze do commit de abertura divergiu"
  );
  invariant(
    isDeepStrictEqual(
      await changedPaths(projectRoot, freezeCommit),
      [EXP0020_BOUNDARY_PATHS.freeze]
    ),
    "commit do freeze pode alterar somente o freeze"
  );
  invariant(
    await gitText(projectRoot, "rev-parse", `${freezeCommit}^`) ===
      freeze.runnerSourceCommit,
    "freeze precisa ser filho direto de runnerSourceCommit"
  );
  invariant(
    attempt.freeze.path === EXP0020_BOUNDARY_PATHS.freeze &&
      attempt.freeze.fileSha256 === sha256(freezeBytes) &&
      attempt.freeze.instrumentationFreezeSha256 ===
        freeze.instrumentationFreezeSha256 &&
      attempt.freeze.runnerSourceCommit === freeze.runnerSourceCommit,
    "tentativa não está ligada ao freeze canônico"
  );
  invariant(
    attempt.campaign.command === EXP0020_BROWSER_COMMAND &&
      attempt.boundary.rerunAllowed === false,
    "tentativa ampliou comando ou rerun"
  );
  const attemptAbsentAtFreeze = await gitBytes(
    projectRoot,
    "show",
    `${freezeCommit}:${EXP0020_BOUNDARY_PATHS.attempt}`
  ).then(() => false, () => true);
  const freezeAbsentAtRunner = await gitBytes(
    projectRoot,
    "show",
    `${freeze.runnerSourceCommit}:${EXP0020_BOUNDARY_PATHS.freeze}`
  ).then(() => false, () => true);
  invariant(
    attemptAbsentAtFreeze && freezeAbsentAtRunner,
    "freeze/tentativa já existiam antes da abertura autorizada"
  );
  for (const path of [
    EXP0020_BOUNDARY_PATHS.receipt,
    EXP0020_BOUNDARY_PATHS.report
  ]) {
    const absentAtAttempt = await gitBytes(
      projectRoot,
      "show",
      `${attemptCommit}:${path}`
    ).then(() => false, () => true);
    invariant(absentAtAttempt, `${path} já existia no commit da tentativa`);
  }
  await gitBytes(
    projectRoot,
    "merge-base",
    "--is-ancestor",
    attemptCommit,
    "HEAD"
  );

  for (const record of [
    ...freeze.productionSources,
    ...freeze.instrumentationSources
  ]) {
    const [runnerBytes, attemptHeadBytes] = await Promise.all([
      gitBytes(
        projectRoot,
        "show",
        `${freeze.runnerSourceCommit}:${record.path}`
      ),
      gitBytes(projectRoot, "show", `${attemptCommit}:${record.path}`)
    ]);
    invariant(
      sha256(runnerBytes) === record.fileSha256 &&
        sha256(attemptHeadBytes) === record.fileSha256,
      `${record.path} divergiu da instrumentação congelada`
    );
    if (record.exp0019FileSha256 !== undefined) {
      const exp0019Bytes = await gitBytes(
        projectRoot,
        "show",
        `${freeze.sourceBaseline.evidenceCommit}:${record.path}`
      );
      invariant(
        sha256(exp0019Bytes) === record.exp0019FileSha256 &&
          exp0019Bytes.equals(runnerBytes),
        `${record.path} não corresponde aos bytes históricos do EXP-0019`
      );
    }
    if (options.requireCurrentFrozenSources === true) {
      const diskBytes = await readFile(resolve(projectRoot, record.path));
      invariant(
        sha256(diskBytes) === record.fileSha256,
        `${record.path} mudou antes da execução congelada`
      );
    }
  }
  for (const artifact of Object.values(freeze.artifacts)) {
    const runnerBytes = await gitBytes(
      projectRoot,
      "show",
      `${freeze.runnerSourceCommit}:${artifact.path}`
    );
    invariant(
      sha256(runnerBytes) === artifact.fileSha256,
      `${artifact.path} divergiu no commit do runner`
    );
    if (artifact.path === EXP0020_BOUNDARY_PATHS.exp0019Report) {
      const exp0019Bytes = await gitBytes(
        projectRoot,
        "show",
        `${freeze.sourceBaseline.evidenceCommit}:${artifact.path}`
      );
      invariant(
        exp0019Bytes.equals(runnerBytes),
        "relatório EXP-0019 divergiu de seu commit de evidência"
      );
    }
    if (options.requireCurrentFrozenSources === true) {
      const diskBytes = await readFile(resolve(projectRoot, artifact.path));
      invariant(
        diskBytes.equals(runnerBytes),
        `${artifact.path} mudou antes da execução congelada`
      );
    }
  }
  return Object.freeze({
    projectRoot,
    freeze,
    freezeBytes,
    freezeCommit,
    attempt,
    attemptBytes,
    attemptCommit,
    freezeRecord: artifactRecord(
      EXP0020_BOUNDARY_PATHS.freeze,
      freezeBytes,
      freeze.instrumentationFreezeSha256
    ),
    attemptRecord: artifactRecord(
      EXP0020_BOUNDARY_PATHS.attempt,
      attemptBytes,
      attempt.browserAttemptSha256
    )
  });
}

export async function verifyExp0020ExecutionBoundary(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const receiptPath = resolve(projectRoot, EXP0020_BOUNDARY_PATHS.receipt);
  const reportPath = resolve(projectRoot, EXP0020_BOUNDARY_PATHS.report);
  invariant(
    await gitText(
      projectRoot,
      "status",
      "--porcelain=v1",
      "--untracked-files=all"
    ) === "",
    "worktree precisa estar limpo antes de consumir a tentativa"
  );
  invariant(!await exists(receiptPath), "tentativa já foi consumida");
  invariant(!await exists(reportPath), "relatório canônico já existe");
  const boundary = await verifyExp0020CommittedBoundary(projectRoot, {
    requireCurrentFrozenSources: true
  });
  invariant(
    await gitText(projectRoot, "rev-parse", "HEAD") ===
      boundary.attemptCommit,
    "HEAD precisa ser exatamente o commit isolado da tentativa"
  );
  return boundary;
}

function receiptCore(boundary, startedAt, processId) {
  return {
    schemaVersion: RECEIPT_SCHEMA,
    experimentId: "EXP-0020",
    status: "browser-attempt-consumed",
    startedAt,
    processId,
    executionCommit: boundary.attemptCommit,
    attemptPath: EXP0020_BOUNDARY_PATHS.attempt,
    attemptFileSha256: boundary.attemptRecord.fileSha256,
    attemptCanonicalSha256: boundary.attemptRecord.canonicalSha256,
    nonce: boundary.attempt.campaign.nonce,
    command: boundary.attempt.campaign.command,
    targetUrl: boundary.attempt.campaign.targetUrl,
    reportPath: boundary.attempt.campaign.reportPath,
    rerunAllowed: false
  };
}

export function createExp0020AttemptReceipt(input) {
  const core = receiptCore(input.boundary, input.startedAt, input.processId);
  return Object.freeze({
    ...core,
    receiptSha256: `sha256:${canonicalSha256(core)}`
  });
}

export function validateExp0020AttemptReceipt(receipt, boundary) {
  try {
    const expectedCore = receiptCore(
      boundary,
      receipt?.startedAt,
      receipt?.processId
    );
    const core = structuredClone(receipt ?? {});
    delete core.receiptSha256;
    return Number.isFinite(Date.parse(receipt?.startedAt ?? "")) &&
      Number.isSafeInteger(receipt?.processId) && receipt.processId > 0 &&
      isDeepStrictEqual(core, expectedCore) &&
      receipt.receiptSha256 === `sha256:${canonicalSha256(core)}`;
  } catch {
    return false;
  }
}

export async function consumeExp0020Attempt(boundary, options = {}) {
  const receipt = createExp0020AttemptReceipt({
    boundary,
    startedAt: options.startedAt ?? new Date().toISOString(),
    processId: options.processId ?? process.pid
  });
  invariant(
    validateExp0020AttemptReceipt(receipt, boundary),
    "recibo de consumo inválido"
  );
  const path = resolve(boundary.projectRoot, EXP0020_BOUNDARY_PATHS.receipt);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  const bytes = await readFile(path);
  return Object.freeze({ receipt, bytes, fileSha256: sha256(bytes) });
}

function campaignBoundaryRecord(boundary, receiptFileSha256) {
  return {
    attemptCanonicalSha256: boundary.attemptRecord.canonicalSha256,
    attemptFileSha256: boundary.attemptRecord.fileSha256,
    attemptPath: boundary.attemptRecord.path,
    attemptVerified: true,
    freezeCanonicalSha256: boundary.freezeRecord.canonicalSha256,
    freezeFileSha256: boundary.freezeRecord.fileSha256,
    freezePath: boundary.freezeRecord.path,
    freezeVerified: true,
    receiptFileSha256,
    receiptPath: EXP0020_BOUNDARY_PATHS.receipt,
    rerunAllowed: false
  };
}

export function validateExp0020RecordedBinding(input) {
  const errors = [];
  try {
    const parsedReceipt = JSON.parse(input.receiptBytes.toString("utf8"));
    if (!isDeepStrictEqual(parsedReceipt, input.receipt)) {
      errors.push("bytes do recibo divergem do objeto validado");
    }
    if (!validateExp0020AttemptReceipt(input.receipt, input.boundary)) {
      errors.push("recibo não corresponde à tentativa commitada");
    }
    const receiptFileSha256 = sha256(input.receiptBytes);
    const expectedBoundary = campaignBoundaryRecord(
      input.boundary,
      receiptFileSha256
    );
    if (
      !isDeepStrictEqual(
        input.report?.campaign?.boundary,
        expectedBoundary
      ) ||
      input.report?.startedAt !== input.receipt?.startedAt
    ) {
      errors.push("relatório não está ligado ao freeze/attempt/receipt");
    }
    const reportValidation = validateExp0020Report(input.report);
    if (!reportValidation.valid) {
      errors.push(...reportValidation.errors);
    }
  } catch (error) {
    errors.push(`binding registrado malformado: ${error.message}`);
  }
  return Object.freeze({ valid: errors.length === 0, errors });
}

export async function verifyExp0020RecordedEvidence(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const boundary = await verifyExp0020CommittedBoundary(projectRoot);
  const reportPath = resolve(projectRoot, EXP0020_BOUNDARY_PATHS.report);
  const receiptPath = resolve(projectRoot, EXP0020_BOUNDARY_PATHS.receipt);
  const [reportBytes, receiptBytes] = await Promise.all([
    readFile(reportPath),
    readFile(receiptPath)
  ]);
  const report = JSON.parse(reportBytes.toString("utf8"));
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  const validation = validateExp0020RecordedBinding({
    boundary,
    report,
    receipt,
    receiptBytes
  });
  invariant(validation.valid, validation.errors.join("; "));

  if (options.requireCommitted === true) {
    const [reportCommit, receiptCommit] = await Promise.all([
      gitText(
        projectRoot,
        "log",
        "-1",
        "--format=%H",
        "--",
        EXP0020_BOUNDARY_PATHS.report
      ),
      gitText(
        projectRoot,
        "log",
        "-1",
        "--format=%H",
        "--",
        EXP0020_BOUNDARY_PATHS.receipt
      )
    ]);
    invariant(
      /^[a-f0-9]{40}$/u.test(reportCommit) &&
        reportCommit === receiptCommit,
      "report e receipt precisam nascer no mesmo commit de evidência"
    );
    invariant(
      await gitText(projectRoot, "rev-parse", `${reportCommit}^`) ===
        boundary.attemptCommit,
      "commit de evidência precisa ser filho direto da tentativa"
    );
    invariant(
      isDeepStrictEqual(
        await changedPaths(projectRoot, reportCommit),
        [
          EXP0020_BOUNDARY_PATHS.receipt,
          EXP0020_BOUNDARY_PATHS.report
        ].toSorted()
      ),
      "commit de evidência pode adicionar somente report e receipt"
    );
    const [committedReport, committedReceipt, headReport, headReceipt] =
      await Promise.all([
        gitBytes(
          projectRoot,
          "show",
          `${reportCommit}:${EXP0020_BOUNDARY_PATHS.report}`
        ),
        gitBytes(
          projectRoot,
          "show",
          `${receiptCommit}:${EXP0020_BOUNDARY_PATHS.receipt}`
        ),
        gitBytes(
          projectRoot,
          "show",
          `HEAD:${EXP0020_BOUNDARY_PATHS.report}`
        ),
        gitBytes(
          projectRoot,
          "show",
          `HEAD:${EXP0020_BOUNDARY_PATHS.receipt}`
        )
      ]);
    invariant(
      committedReport.equals(reportBytes) &&
        committedReceipt.equals(receiptBytes) &&
        headReport.equals(reportBytes) &&
        headReceipt.equals(receiptBytes),
      "blobs de evidência divergiram do commit e de HEAD"
    );
    await gitBytes(
      projectRoot,
      "merge-base",
      "--is-ancestor",
      reportCommit,
      "HEAD"
    );
  }
  return Object.freeze({ boundary, report, receipt, reportBytes, receiptBytes });
}

async function fetchHealth(targetUrl, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(new URL("/api/health", targetUrl), {
    signal: AbortSignal.timeout(10_000)
  });
  invariant(response.ok, `/api/health retornou HTTP ${response.status}`);
  return response.json();
}

export function validateExp0020HealthPreflight(health) {
  const errors = [];
  const fingerprint = normalizeSha256(
    health?.process?.runtimeFingerprint?.sha256
  );
  if (
    typeof health?.process?.runId !== "string" ||
    health.process.runId.length === 0 ||
    fingerprint === null
  ) {
    errors.push("processo ou fingerprint ausente");
  }
  if (
    health?.brain !== EXP0020_CONFIG.provider ||
    health?.asr?.state !== EXP0020_CONFIG.asrState ||
    health?.vadControl?.engine !== EXP0020_CONFIG.vadControlEngine ||
    health?.vadShadow?.state !== EXP0020_CONFIG.vadShadowState
  ) {
    errors.push("provider, ASR ou VAD fora do contrato local");
  }
  if (
    health?.tts?.state !== "ready" ||
    health?.tts?.engine !== EXP0020_CONFIG.ttsEngine ||
    typeof health?.tts?.voice !== "string" ||
    health.tts.voice.length === 0 ||
    typeof health?.tts?.culture !== "string" ||
    health.tts.culture.length === 0
  ) {
    errors.push("TTS local não está pronto ou identificado");
  }
  for (const field of [
    "requests",
    "inputTokens",
    "outputTokens",
    "totalTokens"
  ]) {
    if (!Number.isFinite(health?.usage?.[field]) || health.usage[field] < 0) {
      errors.push(`telemetria de custo inválida: ${field}`);
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors });
}

function flattenDiagnostics(navigations) {
  const output = { consoleErrors: [], runtimeErrors: [], httpErrors: [] };
  for (const navigation of navigations) {
    const diagnostics = navigation.diagnostics ?? {};
    output.consoleErrors.push(...(diagnostics.consoleErrors ?? []));
    output.runtimeErrors.push(...(diagnostics.runtimeErrors ?? []));
    output.runtimeErrors.push(...(diagnostics.ttsCaptureErrors ?? []));
    output.runtimeErrors.push(...(diagnostics.networkViolations ?? []).map(
      (item) => `rede não local: ${item.url}`
    ));
    output.httpErrors.push(...(diagnostics.httpErrors ?? []));
  }
  return output;
}

function projectTrial(trial) {
  invariant(
    trial?.tts?.wavSha256 === trial?.tts?.sha256 &&
      HASH_PATTERN.test(trial.tts.wavSha256 ?? ""),
    `WAV ${trial?.navigationIndex}.${trial?.trialIndex} sem hash CDP íntegro`
  );
  return {
    navigationIndex: trial.navigationIndex,
    trialIndex: trial.trialIndex,
    turnId: trial.turnId,
    tts: {
      wavSha256: trial.tts.wavSha256,
      byteLength: trial.tts.byteLength,
      rate: trial.tts.rate,
      requestText: trial.tts.requestBody?.text ?? null,
      requestUrl: trial.tts.url,
      method: trial.tts.method,
      status: trial.tts.status,
      mimeType: trial.tts.mimeType
    },
    timing: structuredClone(trial.timing),
    startSnapshot: structuredClone(trial.startSnapshot),
    renderStopAtMarkers: structuredClone(trial.renderStopAtMarkers),
    finalSnapshot: structuredClone(trial.finalSnapshot)
  };
}

export function projectExp0020HarnessCampaign(input) {
  const rawFingerprint =
    input.healthBefore?.process?.runtimeFingerprint?.sha256;
  const fingerprint = normalizeSha256(rawFingerprint);
  invariant(fingerprint !== null, "fingerprint ausente");
  invariant(
    input.healthAfter?.process?.runtimeFingerprint?.sha256 === rawFingerprint,
    "fingerprint mudou durante a campanha"
  );
  invariant(
    input.harness?.runtimeFingerprintSha256 === fingerprint,
    "harness não foi ligado ao fingerprint da campanha"
  );
  const navigations = input.harness.navigations.map((navigation) => ({
    index: navigation.navigationIndex,
    targetUrl: navigation.targetUrl,
    runtimeFingerprintSha256: fingerprint,
    browser: structuredClone(
      navigation.browser ?? input.harness.browser ?? { product: "unknown" }
    ),
    networkRequests: (navigation.networkRequests ?? []).map(
      (request) => typeof request === "string" ? request : request.url
    ),
    trials: navigation.trials.map(projectTrial)
  }));
  return {
    boundary: campaignBoundaryRecord(
      input.boundary,
      input.receipt.fileSha256
    ),
    health: {
      before: structuredClone(input.healthBefore),
      after: structuredClone(input.healthAfter)
    },
    cost: { gpuRuns: 0 },
    authority: { canProduceNewEffects: false },
    diagnostics: flattenDiagnostics(input.harness.navigations),
    navigations
  };
}

async function checkReport(projectRoot = PROJECT_ROOT) {
  const { report } = await verifyExp0020RecordedEvidence({
    projectRoot,
    requireCommitted: true
  });
  console.log(
    `EXP-0020 report PASS: ${report.decision} · ${report.reportSha256}`
  );
  return report;
}

export async function runExp0020OfficialCampaign(options = {}) {
  const boundary = await verifyExp0020ExecutionBoundary({
    projectRoot: options.projectRoot
  });
  const startedAt = new Date().toISOString();
  const receipt = await consumeExp0020Attempt(boundary, { startedAt });
  const healthBefore = await fetchHealth(
    EXP0020_CONFIG.targetUrl,
    options.fetchImpl
  );
  const healthPreflight = validateExp0020HealthPreflight(healthBefore);
  invariant(healthPreflight.valid, healthPreflight.errors.join("; "));
  const harness = await (options.runBrowserCampaign ??
    runExp0020BrowserCampaign)({
      cdpUrl: options.cdpUrl ?? discoverExp0020CdpUrl(),
      targetUrl: EXP0020_CONFIG.targetUrl,
      runtimeFingerprintSha256:
        normalizeSha256(healthBefore.process.runtimeFingerprint.sha256)
    });
  const healthAfter = await fetchHealth(
    EXP0020_CONFIG.targetUrl,
    options.fetchImpl
  );
  const campaign = projectExp0020HarnessCampaign({
    boundary,
    receipt,
    healthBefore,
    healthAfter,
    harness
  });
  const report = createExp0020Report({
    startedAt,
    completedAt: new Date().toISOString(),
    campaign
  });
  const reportPath = resolve(boundary.projectRoot, EXP0020_BOUNDARY_PATHS.report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx"
  });
  await verifyExp0020RecordedEvidence({
    projectRoot: boundary.projectRoot,
    requireCommitted: false
  });
  console.log(
    `EXP-0020 ${report.decision}: ` +
      `${report.analysis.metrics.classes.PAUSE_THEN_RENDER.count}/` +
      `${report.analysis.metrics.classes.RENDER_THEN_PAUSE.count} por ordem`
  );
  console.log(`Report: ${EXP0020_BOUNDARY_PATHS.report}`);
  return report;
}

async function main() {
  const options = parseExp0020BrowserArgs(process.argv.slice(2));
  if (options.check) {
    await checkReport();
    return;
  }
  await runExp0020OfficialCampaign({ cdpUrl: options.cdpUrl });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
