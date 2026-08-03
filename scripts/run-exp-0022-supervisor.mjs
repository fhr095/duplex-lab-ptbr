import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  link,
  mkdir,
  readFile,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  EXP0022_ATTEMPT_NONCE,
  EXP0022_BOUNDARY_PATHS,
  EXP0022_EXP0021_SOURCE_COMMIT,
  EXP0022_INHERITED_INSTRUMENTATION_SOURCE_PATHS,
  EXP0022_INSTRUMENTATION_SOURCE_PATHS,
  EXP0022_OFFICIAL_COMMAND,
  EXP0022_PRODUCTION_SOURCE_PATHS,
  EXP0022_RUNTIME_FINGERPRINT_ALGORITHM,
  EXP0022_RUNTIME_FINGERPRINT_ROOTS,
  validateExp0022C0Boundary,
  validateExp0022CaptureAttempt,
  validateExp0022InstrumentationFreeze
} from "../src/eval/exp-0022-boundary.mjs";
import {
  EXP0022_AUDIT_KEYS,
  EXP0022_CONFIG,
  EXP0022_DECISIONS,
  EXP0022_POST_COMMIT_AUDIT_KEYS,
  EXP0022_WORKER_ENVELOPE_SCHEMA,
  createExp0022Report,
  validateExp0022WorkerEnvelopeSchema,
  validateExp0022Report
} from "../src/eval/exp-0022-bootstrap-audit-health-binding.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import { createSourceFingerprint } from
  "../src/eval/source-fingerprint.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const RECEIPT_SCHEMA = "exp-0022-capture-attempt-consumption-v1";
const WORKER_TIMEOUT_MS = 5 * 60_000;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0022 supervisor: ${message}`);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function writeAtomicWriteOnce(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, bytes, { flag: "wx" });
  try {
    await link(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

async function execGit(projectRoot, args, encoding = "buffer") {
  return new Promise((resolveGit, rejectGit) => {
    const child = spawn("git", args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", rejectGit);
    child.once("close", (code, signal) => {
      if (code !== 0) {
        const error = new Error(
          `git ${args[0]} falhou (${code ?? signal}): ` +
            Buffer.concat(stderr).toString("utf8").trim()
        );
        error.code = code;
        error.signal = signal;
        rejectGit(error);
        return;
      }
      const bytes = Buffer.concat(stdout);
      resolveGit(encoding === "buffer" ? bytes : bytes.toString(encoding));
    });
  });
}

async function gitBytes(projectRoot, ...args) {
  return execGit(projectRoot, args, "buffer");
}

async function gitText(projectRoot, ...args) {
  return (await execGit(projectRoot, args, "utf8")).trim();
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

function bytewiseTextOrder(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createExp0022RuntimeFingerprintRecord(files) {
  invariant(
    Array.isArray(files) && files.length > 0,
    "fingerprint do runtime exige arquivos"
  );
  const ordered = files.map((file) => {
    invariant(
      nonEmptyText(file?.path) &&
        (Buffer.isBuffer(file?.bytes) || file?.bytes instanceof Uint8Array),
      "registro de arquivo do runtime inválido"
    );
    return { path: file.path, bytes: Buffer.from(file.bytes) };
  }).sort((left, right) => bytewiseTextOrder(left.path, right.path));
  invariant(
    new Set(ordered.map((file) => file.path)).size === ordered.length,
    "fingerprint do runtime recebeu path duplicado"
  );
  const digest = createHash("sha256");
  for (const file of ordered) {
    digest.update(
      `${file.path.length}:${file.path}:${file.bytes.length}:`,
      "utf8"
    );
    digest.update(file.bytes);
  }
  return Object.freeze({
    algorithm: EXP0022_RUNTIME_FINGERPRINT_ALGORITHM,
    sha256: digest.digest("hex"),
    fileCount: ordered.length,
    roots: [...EXP0022_RUNTIME_FINGERPRINT_ROOTS]
  });
}

async function runtimeFingerprintAtCommit(projectRoot, commit) {
  const listing = await gitBytes(
    projectRoot,
    "ls-tree",
    "-rz",
    "--name-only",
    commit,
    "--",
    ...EXP0022_RUNTIME_FINGERPRINT_ROOTS
  );
  const paths = listing.toString("utf8").split("\0").filter(Boolean);
  const files = [];
  for (const path of paths) {
    files.push({
      path,
      bytes: await gitBytes(projectRoot, "show", `${commit}:${path}`)
    });
  }
  return createExp0022RuntimeFingerprintRecord(files);
}

function artifactRecord(path, bytes, canonicalSha256Value) {
  return {
    path,
    fileSha256: sha256(bytes),
    canonicalSha256: canonicalSha256Value
  };
}

export async function verifyExp0022CommittedBoundary(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const freezePath = resolve(projectRoot, EXP0022_BOUNDARY_PATHS.freeze);
  const attemptPath = resolve(projectRoot, EXP0022_BOUNDARY_PATHS.attempt);
  const [freezeBytes, attemptBytes] = await Promise.all([
    readFile(freezePath),
    readFile(attemptPath)
  ]);
  const freeze = JSON.parse(freezeBytes.toString("utf8"));
  const attempt = JSON.parse(attemptBytes.toString("utf8"));
  const freezeValidation = validateExp0022InstrumentationFreeze(freeze);
  const attemptValidation = validateExp0022CaptureAttempt(attempt);
  invariant(freezeValidation.valid, freezeValidation.errors.join("; "));
  invariant(attemptValidation.valid, attemptValidation.errors.join("; "));

  const [c0ParentCommit, c0ChangedPaths, runtimeChangedPathText] =
    await Promise.all([
      gitText(projectRoot, "rev-parse", `${freeze.runnerSourceCommit}^`),
      changedPaths(projectRoot, freeze.runnerSourceCommit),
      gitText(
        projectRoot,
        "diff",
        "--name-only",
        EXP0022_EXP0021_SOURCE_COMMIT,
        freeze.runnerSourceCommit,
        "--",
        ...EXP0022_RUNTIME_FINGERPRINT_ROOTS
      )
    ]);
  invariant(
    validateExp0022C0Boundary({
      runnerSourceCommit: freeze.runnerSourceCommit,
      parentCommit: c0ParentCommit,
      changedPaths: c0ChangedPaths,
      runtimeChangedPaths: runtimeChangedPathText
        .split(/\r?\n/u).filter(Boolean).toSorted()
    }),
    "C0 alterou parent, allowlist ou runtime fora da fronteira congelada"
  );

  const attemptCommit = await gitText(
    projectRoot,
    "log",
    "-1",
    "--format=%H",
    "--",
    EXP0022_BOUNDARY_PATHS.attempt
  );
  invariant(COMMIT_PATTERN.test(attemptCommit), "commit da abertura ausente");
  invariant(
    (await gitBytes(
      projectRoot,
      "show",
      `${attemptCommit}:${EXP0022_BOUNDARY_PATHS.attempt}`
    )).equals(attemptBytes),
    "abertura precisa estar commitada byte a byte"
  );
  invariant(
    isDeepStrictEqual(
      await changedPaths(projectRoot, attemptCommit),
      [EXP0022_BOUNDARY_PATHS.attempt]
    ),
    "commit da abertura pode alterar somente a abertura"
  );

  const freezeCommit = attempt.openingSourceCommit;
  invariant(
    await gitText(projectRoot, "rev-parse", `${attemptCommit}^`) ===
      freezeCommit,
    "abertura precisa ser filha direta do freeze"
  );
  invariant(
    await gitText(
      projectRoot,
      "log",
      "-1",
      "--format=%H",
      "--",
      EXP0022_BOUNDARY_PATHS.freeze
    ) === freezeCommit,
    "freeze foi alterado depois de congelado"
  );
  invariant(
    (await gitBytes(
      projectRoot,
      "show",
      `${freezeCommit}:${EXP0022_BOUNDARY_PATHS.freeze}`
    )).equals(freezeBytes),
    "freeze commitado divergiu dos bytes atuais"
  );
  invariant(
    isDeepStrictEqual(
      await changedPaths(projectRoot, freezeCommit),
      [EXP0022_BOUNDARY_PATHS.freeze]
    ),
    "commit do freeze pode alterar somente o freeze"
  );
  invariant(
    await gitText(projectRoot, "rev-parse", `${freezeCommit}^`) ===
      freeze.runnerSourceCommit,
    "freeze precisa ser filho direto de C0"
  );
  invariant(
    attempt.freeze.freezeCommit === freezeCommit &&
      attempt.freeze.runnerSourceCommit === freeze.runnerSourceCommit &&
      attempt.freeze.path === EXP0022_BOUNDARY_PATHS.freeze &&
      attempt.freeze.fileSha256 === sha256(freezeBytes) &&
      attempt.freeze.instrumentationFreezeSha256 ===
        freeze.instrumentationFreezeSha256,
    "abertura não está ligada ao freeze canônico"
  );
  invariant(
    attempt.campaign.command === EXP0022_OFFICIAL_COMMAND &&
      attempt.campaign.nonce === EXP0022_ATTEMPT_NONCE &&
      attempt.boundary.rerunAllowed === false,
    "abertura ampliou comando, nonce ou rerun"
  );

  const [attemptAtFreeze, freezeAtC0] = await Promise.all([
    gitBytes(
      projectRoot,
      "show",
      `${freezeCommit}:${EXP0022_BOUNDARY_PATHS.attempt}`
    ).then(() => true, () => false),
    gitBytes(
      projectRoot,
      "show",
      `${freeze.runnerSourceCommit}:${EXP0022_BOUNDARY_PATHS.freeze}`
    ).then(() => true, () => false)
  ]);
  invariant(!attemptAtFreeze && !freezeAtC0,
    "freeze/abertura já existiam antes da etapa autorizada");
  for (const path of [
    EXP0022_BOUNDARY_PATHS.receipt,
    EXP0022_BOUNDARY_PATHS.report
  ]) {
    const existed = await gitBytes(
      projectRoot,
      "show",
      `${attemptCommit}:${path}`
    ).then(() => true, () => false);
    invariant(!existed, `${path} já existia no commit de abertura`);
  }
  await gitBytes(projectRoot, "merge-base", "--is-ancestor", attemptCommit, "HEAD");

  for (const record of freeze.productionSources) {
    const [c0Bytes, baselineBytes] = await Promise.all([
      gitBytes(
        projectRoot,
        "show",
        `${freeze.runnerSourceCommit}:${record.path}`
      ),
      gitBytes(
        projectRoot,
        "show",
        `${freeze.sourceBaseline.evidenceCommit}:${record.path}`
      )
    ]);
    invariant(
      sha256(c0Bytes) === record.fileSha256 &&
        sha256(baselineBytes) === record.exp0021FileSha256 &&
        c0Bytes.equals(baselineBytes),
      `${record.path} divergiu da baseline produtiva EXP-0021`
    );
    if (options.requireCurrentFrozenSources === true) {
      invariant(
        (await readFile(resolve(projectRoot, record.path))).equals(c0Bytes),
        `${record.path} mudou depois do freeze`
      );
    }
  }
  for (const record of freeze.instrumentationSources) {
    const c0Bytes = await gitBytes(
      projectRoot,
      "show",
      `${freeze.runnerSourceCommit}:${record.path}`
    );
    invariant(
      sha256(c0Bytes) === record.fileSha256,
      `${record.path} divergiu da instrumentação congelada`
    );
    if (EXP0022_INHERITED_INSTRUMENTATION_SOURCE_PATHS.includes(record.path)) {
      const baselineBytes = await gitBytes(
        projectRoot,
        "show",
        `${freeze.sourceBaseline.evidenceCommit}:${record.path}`
      );
      invariant(
        sha256(baselineBytes) === record.exp0021FileSha256 &&
          c0Bytes.equals(baselineBytes),
        `${record.path} divergiu do adaptador/teste herdado do EXP-0021`
      );
    }
    if (options.requireCurrentFrozenSources === true) {
      invariant(
        (await readFile(resolve(projectRoot, record.path))).equals(c0Bytes),
        `${record.path} mudou depois do freeze`
      );
    }
  }
  invariant(
    freeze.productionSources.length === EXP0022_PRODUCTION_SOURCE_PATHS.length &&
      freeze.instrumentationSources.length ===
        EXP0022_INSTRUMENTATION_SOURCE_PATHS.length,
    "allowlists congelados ficaram incompletos"
  );
  const committedRuntimeFingerprint = await runtimeFingerprintAtCommit(
    projectRoot,
    freeze.runnerSourceCommit
  );
  invariant(
    isDeepStrictEqual(committedRuntimeFingerprint, freeze.runtimeBinding),
    "fingerprint esperado não corresponde à árvore de runtime do C0"
  );
  if (options.requireCurrentFrozenSources === true) {
    const currentRuntimeFingerprint = await createSourceFingerprint(
      projectRoot,
      { roots: EXP0022_RUNTIME_FINGERPRINT_ROOTS }
    );
    invariant(
      isDeepStrictEqual(currentRuntimeFingerprint, freeze.runtimeBinding),
      "árvore de runtime atual divergiu do fingerprint congelado no C0"
    );
  }
  for (const artifact of Object.values(freeze.artifacts)) {
    const bytes = await gitBytes(
      projectRoot,
      "show",
      `${freeze.runnerSourceCommit}:${artifact.path}`
    );
    invariant(
      sha256(bytes) === artifact.fileSha256,
      `${artifact.path} divergiu no C0`
    );
    if (options.requireCurrentFrozenSources === true) {
      invariant(
        (await readFile(resolve(projectRoot, artifact.path))).equals(bytes),
        `${artifact.path} mudou depois do freeze`
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
      EXP0022_BOUNDARY_PATHS.freeze,
      freezeBytes,
      freeze.instrumentationFreezeSha256
    ),
    attemptRecord: artifactRecord(
      EXP0022_BOUNDARY_PATHS.attempt,
      attemptBytes,
      attempt.captureAttemptSha256
    )
  });
}

function receiptCore(boundary, startedAt, processId) {
  return {
    schemaVersion: RECEIPT_SCHEMA,
    experimentId: "EXP-0022",
    status: "capture-attempt-consumed",
    startedAt,
    processId,
    executionCommit: boundary.attemptCommit,
    attemptPath: EXP0022_BOUNDARY_PATHS.attempt,
    attemptFileSha256: boundary.attemptRecord.fileSha256,
    attemptCanonicalSha256: boundary.attemptRecord.canonicalSha256,
    nonce: boundary.attempt.campaign.nonce,
    command: boundary.attempt.campaign.command,
    targetUrl: boundary.attempt.campaign.targetUrl,
    reportPath: boundary.attempt.campaign.reportPath,
    rerunAllowed: false
  };
}

export function createExp0022AttemptReceipt(input) {
  const core = receiptCore(
    input.boundary,
    input.startedAt,
    input.processId
  );
  return Object.freeze({
    ...core,
    receiptSha256: `sha256:${canonicalSha256(core)}`
  });
}

export function validateExp0022AttemptReceipt(receipt, boundary) {
  try {
    const expected = receiptCore(
      boundary,
      receipt?.startedAt,
      receipt?.processId
    );
    const core = structuredClone(receipt ?? {});
    delete core.receiptSha256;
    return Number.isFinite(Date.parse(receipt?.startedAt ?? "")) &&
      Number.isSafeInteger(receipt?.processId) && receipt.processId > 0 &&
      isDeepStrictEqual(core, expected) &&
      receipt.receiptSha256 === `sha256:${canonicalSha256(core)}`;
  } catch {
    return false;
  }
}

export async function consumeExp0022Attempt(boundary, options = {}) {
  const receipt = createExp0022AttemptReceipt({
    boundary,
    startedAt: options.startedAt ?? new Date().toISOString(),
    processId: options.processId ?? process.pid
  });
  invariant(
    validateExp0022AttemptReceipt(receipt, boundary),
    "recibo gerado é inválido"
  );
  const path = resolve(boundary.projectRoot, EXP0022_BOUNDARY_PATHS.receipt);
  await writeAtomicWriteOnce(
    path,
    `${JSON.stringify(receipt, null, 2)}\n`
  );
  const bytes = await readFile(path);
  return Object.freeze({
    receipt,
    bytes,
    fileSha256: sha256(bytes)
  });
}

function campaignBoundaryRecord(boundary, receiptFileSha256) {
  return {
    freezePath: EXP0022_BOUNDARY_PATHS.freeze,
    attemptPath: EXP0022_BOUNDARY_PATHS.attempt,
    receiptPath: EXP0022_BOUNDARY_PATHS.receipt,
    freezeVerified: true,
    attemptVerified: true,
    receiptVerified: true,
    receiptWriteOnce: true,
    receiptBeforeNetwork: true,
    rerunAllowed: false,
    freezeCanonicalSha256: boundary.freezeRecord.canonicalSha256,
    freezeFileSha256: boundary.freezeRecord.fileSha256,
    attemptCanonicalSha256: boundary.attemptRecord.canonicalSha256,
    attemptFileSha256: boundary.attemptRecord.fileSha256,
    receiptFileSha256,
    expectedRuntimeFingerprintSha256:
      `sha256:${boundary.freeze.runtimeBinding.sha256}`
  };
}

function successfulAudits() {
  return Object.freeze(Object.fromEntries(
    EXP0022_AUDIT_KEYS.map((key) => [key, true])
  ));
}

function invalidWorkerEnvelope(input) {
  return {
    schemaVersion: EXP0022_WORKER_ENVELOPE_SCHEMA,
    status: "invalidated",
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    campaign: null,
    failure: {
      code: input.code,
      message: String(input.message ?? input.code).slice(0, 500)
    }
  };
}

export function validateExp0022WorkerEnvelopeShape(envelope) {
  return validateExp0022WorkerEnvelopeSchema(envelope) &&
    Number.isFinite(Date.parse(envelope.startedAt ?? "")) &&
    Number.isFinite(Date.parse(envelope.completedAt ?? "")) &&
    Date.parse(envelope.completedAt) >= Date.parse(envelope.startedAt);
}

export async function runExp0022WorkerProcess(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const timeoutMs = options.timeoutMs ?? WORKER_TIMEOUT_MS;
  return new Promise((resolveWorker) => {
    const child = spawn(
      process.execPath,
      ["scripts/run-exp-0022-worker.mjs"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          ...(options.startedAt
            ? { EXP0022_ATTEMPT_STARTED_AT: options.startedAt }
            : {})
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let forceKillTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      resolveWorker({
        exitCode: null,
        signal: null,
        timedOut,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: String(error.message).slice(0, 2_000)
      });
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      resolveWorker({
        exitCode,
        signal,
        timedOut,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8").slice(0, 2_000)
      });
    });
  });
}

export function classifyExp0022WorkerResult(result, startedAt, completedAt) {
  if (result?.timedOut === true) {
    return invalidWorkerEnvelope({
      startedAt,
      completedAt,
      code: "WORKER_TIMEOUT",
      message: "worker excedeu o timeout congelado"
    });
  }
  if (nonEmptyText(result?.signal)) {
    return invalidWorkerEnvelope({
      startedAt,
      completedAt,
      code: "WORKER_SIGNAL",
      message: `worker terminou por ${result.signal}`
    });
  }
  if (result?.exitCode !== 0) {
    return invalidWorkerEnvelope({
      startedAt,
      completedAt,
      code: "WORKER_EXIT",
      message: result?.stderr || `worker terminou com ${result?.exitCode}`
    });
  }
  let envelope = null;
  try {
    envelope = JSON.parse(result?.stdout?.trim() ?? "");
  } catch (error) {
    return invalidWorkerEnvelope({
      startedAt,
      completedAt,
      code: "WORKER_MALFORMED_ENVELOPE",
      message: error.message
    });
  }
  if (!validateExp0022WorkerEnvelopeShape(envelope)) {
    return invalidWorkerEnvelope({
      startedAt,
      completedAt,
      code: "WORKER_MALFORMED_ENVELOPE",
      message: "worker não retornou o envelope congelado"
    });
  }
  return envelope;
}

export async function prepareExp0022SupervisorState(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const receiptPath = resolve(projectRoot, EXP0022_BOUNDARY_PATHS.receipt);
  const reportPath = resolve(projectRoot, EXP0022_BOUNDARY_PATHS.report);
  const [receiptExists, reportExists] = await Promise.all([
    exists(receiptPath),
    exists(reportPath)
  ]);
  invariant(
    receiptExists || !reportExists,
    "relatório existe sem receipt de consumo"
  );

  if (receiptExists) {
    const boundary = await verifyExp0022CommittedBoundary({
      projectRoot,
      requireCurrentFrozenSources: true
    });
    const receiptBytes = await readFile(receiptPath);
    const receipt = JSON.parse(receiptBytes.toString("utf8"));
    invariant(
      validateExp0022AttemptReceipt(receipt, boundary),
      "receipt existente não corresponde à abertura"
    );
    const receiptRecord = Object.freeze({
      receipt,
      bytes: receiptBytes,
      fileSha256: sha256(receiptBytes)
    });
    return Object.freeze({
      mode: reportExists ? "recorded" : "orphan",
      boundary,
      receiptRecord
    });
  }

  invariant(
    await gitText(
      projectRoot,
      "status",
      "--porcelain=v1",
      "--untracked-files=all"
    ) === "",
    "worktree precisa estar limpo antes do receipt"
  );
  const boundary = await verifyExp0022CommittedBoundary({
    projectRoot,
    requireCurrentFrozenSources: true
  });
  invariant(
    await gitText(projectRoot, "rev-parse", "HEAD") ===
      boundary.attemptCommit,
    "HEAD precisa ser exatamente o commit isolado da abertura"
  );
  return Object.freeze({ mode: "fresh", boundary, receiptRecord: null });
}

export function validateExp0022RecordedBinding(input) {
  const errors = [];
  try {
    const parsedReceipt = JSON.parse(input.receiptBytes.toString("utf8"));
    if (!isDeepStrictEqual(parsedReceipt, input.receipt)) {
      errors.push("bytes do receipt divergem do objeto validado");
    }
    if (!validateExp0022AttemptReceipt(input.receipt, input.boundary)) {
      errors.push("receipt não corresponde à abertura commitada");
    }
    const expectedBoundary = campaignBoundaryRecord(
      input.boundary,
      sha256(input.receiptBytes)
    );
    if (!isDeepStrictEqual(
      input.report?.campaign?.boundary,
      expectedBoundary
    )) {
      errors.push("relatório não está ligado ao freeze/attempt/receipt");
    }
    if (
      input.report?.startedAt !== input.receipt?.startedAt ||
      Date.parse(input.report?.campaign?.workerEnvelope?.startedAt ?? "") <
        Date.parse(input.receipt?.startedAt ?? "")
    ) {
      errors.push("worker/report antecedeu o receipt write-once");
    }
    const reportValidation = validateExp0022Report(input.report);
    if (!reportValidation.valid) errors.push(...reportValidation.errors);
  } catch (error) {
    errors.push(`binding registrado malformado: ${error.message}`);
  }
  return Object.freeze({ valid: errors.length === 0, errors });
}

export function evaluateExp0022PostCommitEvidence(input = {}) {
  const expectedEvidencePaths = [
    EXP0022_BOUNDARY_PATHS.receipt,
    EXP0022_BOUNDARY_PATHS.report
  ].toSorted();
  const gitTopologyValid = COMMIT_PATTERN.test(input.receiptCommit ?? "") &&
    input.receiptCommit === input.reportCommit &&
    input.reportCommitParent === input.attemptCommit &&
    input.reportCommitAncestor === true;
  const evidenceCommitIsolated = isDeepStrictEqual(
    input.changedPaths,
    expectedEvidencePaths
  ) && Buffer.isBuffer(input.receiptBytes) &&
    Buffer.isBuffer(input.reportBytes) &&
    [
      input.committedReceipt,
      input.headReceipt
    ].every((bytes) =>
      Buffer.isBuffer(bytes) && bytes.equals(input.receiptBytes)) &&
    [
      input.committedReport,
      input.headReport
    ].every((bytes) =>
      Buffer.isBuffer(bytes) && bytes.equals(input.reportBytes));
  const checks = Object.freeze({
    reportBindingValid: input.reportBindingValid === true,
    canonicalHashValid: input.canonicalHashValid === true,
    gitTopologyValid,
    evidenceCommitIsolated
  });
  const errors = [];
  for (const key of EXP0022_POST_COMMIT_AUDIT_KEYS) {
    if (checks[key] !== true) errors.push(`${key} falhou`);
  }
  return Object.freeze({
    valid: errors.length === 0,
    checks,
    errors: Object.freeze(errors)
  });
}

export function formatExp0022CheckSuccess(report) {
  invariant(
    Object.values(EXP0022_DECISIONS).includes(report?.decision) &&
      HASH_PATTERN.test(report?.reportSha256 ?? ""),
    "resultado do checker não possui decisão/hash canônicos"
  );
  return `EXP-0022 CHECK PASS · decision=${report.decision} · ` +
    report.reportSha256;
}

async function writeCanonicalReport(projectRoot, report) {
  const path = resolve(projectRoot, EXP0022_BOUNDARY_PATHS.report);
  await writeAtomicWriteOnce(
    path,
    `${JSON.stringify(report, null, 2)}\n`
  );
  return readFile(path);
}

export async function runExp0022Supervisor(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const now = options.now ?? (() => new Date().toISOString());
  const state = options.preparedState ??
    await (options.prepareState ?? prepareExp0022SupervisorState)({
      projectRoot
    });
  invariant(state.mode !== "recorded", "tentativa já possui relatório");
  invariant(
    ["fresh", "orphan"].includes(state.mode),
    `estado de supervisor desconhecido: ${state.mode}`
  );

  let receiptRecord = state.receiptRecord;
  if (state.mode === "fresh") {
    receiptRecord = await (options.consumeAttempt ?? consumeExp0022Attempt)(
      state.boundary,
      { startedAt: now() }
    );
  }
  invariant(
    receiptRecord && validateExp0022AttemptReceipt(
      receiptRecord.receipt,
      state.boundary
    ),
    "supervisor não possui receipt válido"
  );

  let workerEnvelope;
  if (state.mode === "orphan") {
    workerEnvelope = invalidWorkerEnvelope({
      startedAt: receiptRecord.receipt.startedAt,
      completedAt: now(),
      code: "ORPHANED_RECEIPT_RECOVERY",
      message: "receipt prévio sem relatório; recovery não abriu rede ou Chrome"
    });
  } else {
    const runWorker = options.runWorker ?? runExp0022WorkerProcess;
    let workerResult;
    try {
      workerResult = await runWorker({
        projectRoot,
        startedAt: receiptRecord.receipt.startedAt
      });
    } catch (error) {
      workerResult = {
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: `spawn throw: ${error.message}`
      };
    }
    workerEnvelope = classifyExp0022WorkerResult(
      workerResult,
      receiptRecord.receipt.startedAt,
      now()
    );
    if (workerEnvelope.startedAt !== receiptRecord.receipt.startedAt) {
      workerEnvelope = invalidWorkerEnvelope({
        startedAt: receiptRecord.receipt.startedAt,
        completedAt: now(),
        code: "WORKER_RECEIPT_TIME_BINDING_INVALID",
        message: "worker não preservou o startedAt do receipt"
      });
    }
  }

  const campaign = {
    boundary: campaignBoundaryRecord(
      state.boundary,
      receiptRecord.fileSha256
    ),
    workerEnvelope,
    audits: successfulAudits()
  };
  const createReport = options.createReport ?? createExp0022Report;
  const report = createReport({
    startedAt: workerEnvelope.startedAt,
    completedAt: workerEnvelope.completedAt,
    campaign
  });
  const writeReport = options.writeReport ?? writeCanonicalReport;
  const reportBytes = await writeReport(projectRoot, report);
  const validation = validateExp0022RecordedBinding({
    boundary: state.boundary,
    receipt: receiptRecord.receipt,
    receiptBytes: receiptRecord.bytes,
    report
  });
  invariant(validation.valid, validation.errors.join("; "));
  return Object.freeze({
    state: state.mode,
    boundary: state.boundary,
    receipt: receiptRecord.receipt,
    receiptBytes: receiptRecord.bytes,
    report,
    reportBytes
  });
}

export async function verifyExp0022RecordedEvidence(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const boundary = await verifyExp0022CommittedBoundary({ projectRoot });
  const [receiptBytes, reportBytes] = await Promise.all([
    readFile(resolve(projectRoot, EXP0022_BOUNDARY_PATHS.receipt)),
    readFile(resolve(projectRoot, EXP0022_BOUNDARY_PATHS.report))
  ]);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  const report = JSON.parse(reportBytes.toString("utf8"));
  const validation = validateExp0022RecordedBinding({
    boundary,
    receipt,
    receiptBytes,
    report
  });
  invariant(validation.valid, validation.errors.join("; "));
  const canonicalValidation = validateExp0022Report(report);
  invariant(canonicalValidation.valid, canonicalValidation.errors.join("; "));
  let evidenceAcceptance = Object.freeze({
    status: "NOT_CHECKED",
    checks: null
  });

  if (options.requireCommitted === true) {
    const [receiptCommit, reportCommit] = await Promise.all([
      gitText(
        projectRoot,
        "log",
        "-1",
        "--format=%H",
        "--",
        EXP0022_BOUNDARY_PATHS.receipt
      ),
      gitText(
        projectRoot,
        "log",
        "-1",
        "--format=%H",
        "--",
        EXP0022_BOUNDARY_PATHS.report
      )
    ]);
    const [
      reportCommitParent,
      evidenceChangedPaths,
      committedReceipt,
      committedReport,
      headReceipt,
      headReport
    ] =
      await Promise.all([
        gitText(projectRoot, "rev-parse", `${reportCommit}^`),
        changedPaths(projectRoot, reportCommit),
        gitBytes(
          projectRoot,
          "show",
          `${receiptCommit}:${EXP0022_BOUNDARY_PATHS.receipt}`
        ),
        gitBytes(
          projectRoot,
          "show",
          `${reportCommit}:${EXP0022_BOUNDARY_PATHS.report}`
        ),
        gitBytes(projectRoot, "show", `HEAD:${EXP0022_BOUNDARY_PATHS.receipt}`),
        gitBytes(projectRoot, "show", `HEAD:${EXP0022_BOUNDARY_PATHS.report}`)
      ]);
    await gitBytes(
      projectRoot,
      "merge-base",
      "--is-ancestor",
      reportCommit,
      "HEAD"
    );
    const postCommit = evaluateExp0022PostCommitEvidence({
      attemptCommit: boundary.attemptCommit,
      receiptCommit,
      reportCommit,
      reportCommitParent,
      reportCommitAncestor: true,
      changedPaths: evidenceChangedPaths,
      receiptBytes,
      reportBytes,
      committedReceipt,
      committedReport,
      headReceipt,
      headReport,
      reportBindingValid: validation.valid,
      canonicalHashValid: canonicalValidation.valid
    });
    invariant(postCommit.valid, postCommit.errors.join("; "));
    evidenceAcceptance = Object.freeze({
      status: "ACCEPTED",
      checks: postCommit.checks
    });
  }
  return Object.freeze({
    boundary,
    receipt,
    receiptBytes,
    report,
    reportBytes,
    evidenceAcceptance
  });
}

export function parseExp0022SupervisorArgs(args) {
  invariant(
    args.length === 0 ||
      (args.length === 1 && args[0] === "--check"),
    "aceita somente --check"
  );
  return Object.freeze({ check: args[0] === "--check" });
}

async function main() {
  const options = parseExp0022SupervisorArgs(process.argv.slice(2));
  if (options.check) {
    const { report } = await verifyExp0022RecordedEvidence({
      requireCommitted: true
    });
    console.log(formatExp0022CheckSuccess(report));
    return;
  }
  const { report, state } = await runExp0022Supervisor();
  console.log(
    `EXP-0022 ${report.decision} (${state}) · ${report.reportSha256}`
  );
  console.log(`Report: ${EXP0022_BOUNDARY_PATHS.report}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
