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
  EXP0023_ATTEMPT_NONCE,
  EXP0023_BOUNDARY_PATHS,
  EXP0023_EXP0022_SOURCE_COMMIT,
  EXP0023_INHERITED_INSTRUMENTATION_SOURCE_PATHS,
  EXP0023_INHERITED_WORKER_COMMAND,
  EXP0023_RUNTIME_FINGERPRINT_ALGORITHM,
  EXP0023_RUNTIME_FINGERPRINT_ROOTS,
  validateExp0023C0Boundary,
  validateExp0023CaptureAttempt,
  validateExp0023InstrumentationFreeze
} from "../src/eval/exp-0023-boundary.mjs";
import {
  EXP0023_AUDIT_KEYS,
  EXP0023_DECISIONS,
  EXP0023_POST_COMMIT_AUDIT_KEYS,
  createExp0023Report,
  validateExp0023Report
} from "../src/eval/exp-0023-cdp-ordinal-timestamp-semantics.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const RECEIPT_SCHEMA = "exp-0023-capture-attempt-consumption-v1";
const WORKER_TIMEOUT_MS = 5 * 60_000;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const MAX_WORKER_OUTPUT_BYTES = 20 * 1024 * 1024;

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0023 supervisor: ${message}`);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
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
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx" });
  try {
    await link(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
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

export function createExp0023RuntimeFingerprintRecord(files) {
  invariant(Array.isArray(files) && files.length > 0,
    "fingerprint do runtime exige arquivos");
  const ordered = files.map((file) => {
    invariant(
      typeof file?.path === "string" && file.path.length > 0 &&
        (Buffer.isBuffer(file?.bytes) || file?.bytes instanceof Uint8Array),
      "registro de arquivo do runtime inválido"
    );
    return { path: file.path, bytes: Buffer.from(file.bytes) };
  }).toSorted((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  invariant(
    new Set(ordered.map(({ path }) => path)).size === ordered.length,
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
    algorithm: EXP0023_RUNTIME_FINGERPRINT_ALGORITHM,
    sha256: digest.digest("hex"),
    fileCount: ordered.length,
    roots: [...EXP0023_RUNTIME_FINGERPRINT_ROOTS]
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
    ...EXP0023_RUNTIME_FINGERPRINT_ROOTS
  );
  const paths = listing.toString("utf8").split("\0").filter(Boolean);
  const files = [];
  for (const path of paths) {
    files.push({
      path,
      bytes: await gitBytes(projectRoot, "show", `${commit}:${path}`)
    });
  }
  return createExp0023RuntimeFingerprintRecord(files);
}

export function exp0023FileRecordMatchesBytes(record, bytes) {
  return typeof record?.path === "string" && record.path.length > 0 &&
    (Buffer.isBuffer(bytes) || bytes instanceof Uint8Array) &&
    bytes.byteLength > 0 && sha256(Buffer.from(bytes)) === record.fileSha256;
}

async function verifySourceRecords(projectRoot, commit, records) {
  for (const record of records) {
    const bytes = await gitBytes(projectRoot, "show", `${commit}:${record.path}`);
    invariant(
      exp0023FileRecordMatchesBytes(record, bytes),
      `fonte congelada divergiu: ${record.path}`
    );
  }
}

export async function verifyExp0023CommittedBoundary(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const allowOrphanReceipt = options.allowOrphanReceipt === true;
  const allowEvidenceDescendants = options.allowEvidenceDescendants === true;
  const status = await gitText(
    projectRoot,
    "status",
    "--porcelain=v1",
    "--untracked-files=all"
  );
  const allowedStatus = allowOrphanReceipt
    ? `?? ${EXP0023_BOUNDARY_PATHS.receipt}`
    : "";
  invariant(
    status === allowedStatus,
    allowOrphanReceipt
      ? "worktree precisa conter somente o receipt órfão permitido"
      : "worktree precisa estar limpa"
  );
  const freezePath = resolve(projectRoot, EXP0023_BOUNDARY_PATHS.freeze);
  const attemptPath = resolve(projectRoot, EXP0023_BOUNDARY_PATHS.attempt);
  const [freezeBytes, attemptBytes] = await Promise.all([
    readFile(freezePath),
    readFile(attemptPath)
  ]);
  const freeze = JSON.parse(freezeBytes.toString("utf8"));
  const attempt = JSON.parse(attemptBytes.toString("utf8"));
  const freezeValidation = validateExp0023InstrumentationFreeze(freeze);
  const attemptValidation = validateExp0023CaptureAttempt(attempt);
  invariant(freezeValidation.valid, freezeValidation.errors.join("; "));
  invariant(attemptValidation.valid, attemptValidation.errors.join("; "));
  if (!allowEvidenceDescendants) {
    invariant(
      process.version === freeze.nodeVersion,
      "versão Node da execução divergiu do freeze"
    );
  }

  const [head, freezeCommit, attemptCommit] = await Promise.all([
    gitText(projectRoot, "rev-parse", "HEAD"),
    gitText(projectRoot, "log", "-1", "--format=%H", "--",
      EXP0023_BOUNDARY_PATHS.freeze),
    gitText(projectRoot, "log", "-1", "--format=%H", "--",
      EXP0023_BOUNDARY_PATHS.attempt)
  ]);
  if (allowEvidenceDescendants) {
    await gitBytes(
      projectRoot,
      "merge-base",
      "--is-ancestor",
      attemptCommit,
      head
    );
  } else {
    invariant(head === attemptCommit,
      "execução oficial exige HEAD no commit isolado da abertura");
  }
  invariant(
    attempt.freeze.freezeCommit === freezeCommit &&
      attempt.openingSourceCommit === freezeCommit,
    "tentativa não aponta para o freeze commit"
  );
  invariant(
    await gitText(projectRoot, "rev-parse", `${attemptCommit}^`) ===
      freezeCommit,
    "opening precisa ser filho direto do freeze"
  );
  invariant(
    isDeepStrictEqual(await changedPaths(projectRoot, attemptCommit), [
      EXP0023_BOUNDARY_PATHS.attempt
    ]),
    "opening commit precisa conter somente a tentativa"
  );
  invariant(
    await gitText(projectRoot, "rev-parse", `${freezeCommit}^`) ===
      freeze.runnerSourceCommit,
    "freeze precisa ser filho direto do C0"
  );
  invariant(
    isDeepStrictEqual(await changedPaths(projectRoot, freezeCommit), [
      EXP0023_BOUNDARY_PATHS.freeze
    ]),
    "freeze commit precisa conter somente o freeze"
  );
  const c0Parent = await gitText(
    projectRoot,
    "rev-parse",
    `${freeze.runnerSourceCommit}^`
  );
  const runtimeChangedPaths = (await gitText(
    projectRoot,
    "diff",
    "--name-only",
    EXP0023_EXP0022_SOURCE_COMMIT,
    freeze.runnerSourceCommit,
    "--",
    ...EXP0023_RUNTIME_FINGERPRINT_ROOTS
  )).split(/\r?\n/u).filter(Boolean).toSorted();
  invariant(validateExp0023C0Boundary({
    runnerSourceCommit: freeze.runnerSourceCommit,
    parentCommit: c0Parent,
    changedPaths: await changedPaths(projectRoot, freeze.runnerSourceCommit),
    runtimeChangedPaths
  }), "boundary exato do C0 divergiu");
  invariant(
    attempt.freeze.fileSha256 === sha256(freezeBytes) &&
      attempt.freeze.instrumentationFreezeSha256 ===
        freeze.instrumentationFreezeSha256 &&
      attempt.freeze.runnerSourceCommit === freeze.runnerSourceCommit,
    "attempt não liga os bytes exatos do freeze"
  );
  const [committedFreeze, committedAttempt, runtimeBinding] = await Promise.all([
    gitBytes(projectRoot, "show",
      `${freezeCommit}:${EXP0023_BOUNDARY_PATHS.freeze}`),
    gitBytes(projectRoot, "show",
      `${attemptCommit}:${EXP0023_BOUNDARY_PATHS.attempt}`),
    runtimeFingerprintAtCommit(projectRoot, freeze.runnerSourceCommit)
  ]);
  invariant(committedFreeze.equals(freezeBytes),
    "freeze atual divergiu do commit isolado");
  invariant(committedAttempt.equals(attemptBytes),
    "tentativa atual divergiu do commit isolado");
  invariant(isDeepStrictEqual(runtimeBinding, freeze.runtimeBinding),
    "fingerprint do runtime no C0 divergiu do freeze");
  await verifySourceRecords(
    projectRoot,
    freeze.runnerSourceCommit,
    freeze.productionSources
  );
  await verifySourceRecords(
    projectRoot,
    freeze.runnerSourceCommit,
    freeze.instrumentationSources
  );
  await verifySourceRecords(
    projectRoot,
    freeze.runnerSourceCommit,
    Object.values(freeze.artifacts)
  );
  for (const record of freeze.instrumentationSources.filter(({ path }) =>
    EXP0023_INHERITED_INSTRUMENTATION_SOURCE_PATHS.includes(path))) {
    const inheritedBytes = await gitBytes(
      projectRoot,
      "show",
      `${EXP0023_EXP0022_SOURCE_COMMIT}:${record.path}`
    );
    invariant(sha256(inheritedBytes) === record.exp0022FileSha256,
      `fonte herdada divergiu: ${record.path}`);
  }
  for (const record of freeze.productionSources) {
    const baseline = await gitBytes(
      projectRoot,
      "show",
      `${EXP0023_EXP0022_SOURCE_COMMIT}:${record.path}`
    );
    invariant(sha256(baseline) === record.exp0022FileSha256,
      `fonte produtiva baseline divergiu: ${record.path}`);
  }
  return Object.freeze({
    projectRoot,
    freeze,
    freezeBytes,
    freezeCommit,
    attempt,
    attemptBytes,
    attemptCommit,
    expectedRuntimeFingerprintSha256:
      `sha256:${freeze.runtimeBinding.sha256}`
  });
}

function receiptCore(input) {
  return {
    schemaVersion: RECEIPT_SCHEMA,
    experimentId: "EXP-0023",
    status: "consumed-before-worker",
    consumedAt: input.consumedAt,
    attempt: {
      path: EXP0023_BOUNDARY_PATHS.attempt,
      fileSha256: sha256(input.boundary.attemptBytes),
      captureAttemptSha256: input.boundary.attempt.captureAttemptSha256,
      attemptCommit: input.boundary.attemptCommit,
      nonce: EXP0023_ATTEMPT_NONCE
    },
    workerCommand: EXP0023_INHERITED_WORKER_COMMAND,
    boundary: {
      receiptBeforeWorker: true,
      receiptBeforeNetwork: true,
      rerunAllowed: false
    },
    authority: {
      mode: "measurement-only",
      canProduceNewEffects: false
    }
  };
}

export function createExp0023AttemptReceipt(input = {}) {
  const core = receiptCore(input);
  return Object.freeze({
    ...core,
    receiptSha256: `sha256:${canonicalSha256(core)}`
  });
}

export function validateExp0023AttemptReceipt(receipt, boundary) {
  try {
    if (!exactKeys(receipt, [
      "attempt", "authority", "boundary", "consumedAt", "experimentId",
      "receiptSha256", "schemaVersion", "status", "workerCommand"
    ]) || receipt?.schemaVersion !== RECEIPT_SCHEMA ||
      receipt?.experimentId !== "EXP-0023" ||
      receipt?.status !== "consumed-before-worker" ||
      !Number.isFinite(Date.parse(receipt?.consumedAt)) ||
      !isDeepStrictEqual(receipt?.attempt, {
        path: EXP0023_BOUNDARY_PATHS.attempt,
        fileSha256: sha256(boundary.attemptBytes),
        captureAttemptSha256: boundary.attempt.captureAttemptSha256,
        attemptCommit: boundary.attemptCommit,
        nonce: EXP0023_ATTEMPT_NONCE
      }) || receipt?.workerCommand !== EXP0023_INHERITED_WORKER_COMMAND ||
      !isDeepStrictEqual(receipt?.boundary, {
        receiptBeforeWorker: true,
        receiptBeforeNetwork: true,
        rerunAllowed: false
      }) || !isDeepStrictEqual(receipt?.authority, {
        mode: "measurement-only",
        canProduceNewEffects: false
      })) return false;
    const core = structuredClone(receipt);
    delete core.receiptSha256;
    return receipt.receiptSha256 === `sha256:${canonicalSha256(core)}`;
  } catch {
    return false;
  }
}

export async function consumeExp0023Attempt(boundary, options = {}) {
  const receiptPath = resolve(
    boundary.projectRoot ?? PROJECT_ROOT,
    EXP0023_BOUNDARY_PATHS.receipt
  );
  invariant(!await exists(receiptPath), "tentativa já consumida; rerun recusado");
  const receipt = createExp0023AttemptReceipt({
    boundary,
    consumedAt: options.consumedAt ?? new Date().toISOString()
  });
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  await (options.writeOnce ?? writeAtomicWriteOnce)(receiptPath, receiptBytes);
  invariant(await exists(receiptPath), "receipt não foi materializado");
  return Object.freeze({ receipt, receiptBytes });
}

export async function runExp0023WorkerProcess(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const timeoutMs = options.timeoutMs ?? WORKER_TIMEOUT_MS;
  return new Promise((resolveResult) => {
    const startedAt = new Date().toISOString();
    const child = (options.spawn ?? spawn)(
      process.execPath,
      [resolve(projectRoot, "scripts/run-exp-0022-worker.mjs")],
      {
        cwd: projectRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const stdout = [];
    const stderr = [];
    let size = 0;
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolveResult({ startedAt, completedAt: new Date().toISOString(), ...result });
    };
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size <= MAX_WORKER_OUTPUT_BYTES) stdout.push(chunk);
      else child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => finish({ kind: "spawn-error", error }));
    child.once("close", (code, signal) => {
      if (size > MAX_WORKER_OUTPUT_BYTES) {
        finish({ kind: "output-limit", code, signal });
        return;
      }
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0 || signal !== null) {
        finish({ kind: "exit-error", code, signal, errorText });
        return;
      }
      try {
        const envelope = JSON.parse(output);
        finish({ kind: "success", envelope, errorText });
      } catch (error) {
        finish({ kind: "malformed-output", error, errorText });
      }
    });
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ kind: "timeout" });
    }, timeoutMs);
  });
}

function invalidWorkerEnvelope(result) {
  const code = {
    "spawn-error": "WORKER_SPAWN_ERROR",
    "output-limit": "WORKER_OUTPUT_LIMIT",
    "exit-error": "WORKER_EXIT_ERROR",
    "malformed-output": "WORKER_MALFORMED_OUTPUT",
    timeout: "WORKER_TIMEOUT",
    "orphan-receipt": "ORPHAN_RECEIPT"
  }[result.kind] ?? "WORKER_UNKNOWN_ERROR";
  return {
    schemaVersion: "exp-0022-worker-envelope-v1",
    status: "supervisor-failure",
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    campaign: null,
    failure: {
      code,
      message: "worker herdado não produziu campanha avaliável"
    }
  };
}

function receiptFacts(boundary, receiptBytes, workerStartedAt) {
  try {
    const receipt = JSON.parse(Buffer.from(receiptBytes).toString("utf8"));
    const receiptValid = validateExp0023AttemptReceipt(receipt, boundary);
    const consumedAtMs = Date.parse(receipt?.consumedAt);
    const workerStartedAtMs = Date.parse(workerStartedAt);
    return Object.freeze({
      receiptValid,
      receiptBeforeWorker: receiptValid &&
        Number.isFinite(consumedAtMs) && Number.isFinite(workerStartedAtMs) &&
        consumedAtMs <= workerStartedAtMs
    });
  } catch {
    return Object.freeze({
      receiptValid: false,
      receiptBeforeWorker: false
    });
  }
}

function boundaryRecord(boundary, receiptBytes, facts) {
  return {
    freezePath: EXP0023_BOUNDARY_PATHS.freeze,
    freezeFileSha256: sha256(boundary.freezeBytes),
    freezeCanonicalSha256:
      boundary.freeze.instrumentationFreezeSha256,
    freezeVerified: true,
    attemptPath: EXP0023_BOUNDARY_PATHS.attempt,
    attemptFileSha256: sha256(boundary.attemptBytes),
    attemptCanonicalSha256:
      boundary.attempt.captureAttemptSha256,
    attemptVerified: true,
    receiptPath: EXP0023_BOUNDARY_PATHS.receipt,
    receiptFileSha256: sha256(receiptBytes),
    receiptVerified: facts.receiptValid,
    receiptWriteOnce: true,
    receiptBeforeNetwork: facts.receiptBeforeWorker,
    expectedRuntimeFingerprintSha256:
      boundary.expectedRuntimeFingerprintSha256,
    rerunAllowed: false
  };
}

function auditRecord(facts) {
  const audits = Object.fromEntries(
    EXP0023_AUDIT_KEYS.map((key) => [key, true])
  );
  audits.receiptValid = facts.receiptValid;
  audits.receiptBeforeNetwork = facts.receiptBeforeWorker;
  return audits;
}

export function classifyExp0023WorkerResult(
  result,
  boundary,
  receiptBytes
) {
  const workerEnvelope = result.kind === "success"
    ? result.envelope
    : invalidWorkerEnvelope(result);
  const facts = receiptFacts(
    boundary,
    receiptBytes,
    workerEnvelope.startedAt ?? result.startedAt
  );
  const campaign = {
    boundary: boundaryRecord(boundary, receiptBytes, facts),
    workerEnvelope,
    audits: auditRecord(facts)
  };
  return createExp0023Report({
    startedAt: workerEnvelope.startedAt ?? result.startedAt,
    completedAt: workerEnvelope.completedAt ?? result.completedAt,
    campaign
  });
}

export async function runExp0023Supervisor(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const reportPath = resolve(projectRoot, EXP0023_BOUNDARY_PATHS.report);
  const receiptPath = resolve(projectRoot, EXP0023_BOUNDARY_PATHS.receipt);
  invariant(!await exists(reportPath), "relatório já existe; rerun recusado");
  const orphanReceiptPresent = await exists(receiptPath);
  const boundary = await (options.verifyBoundary ??
    verifyExp0023CommittedBoundary)({
    projectRoot,
    allowOrphanReceipt: orphanReceiptPresent
  });
  let receipt;
  let receiptBytes;
  let result;
  let state;
  if (orphanReceiptPresent) {
    receiptBytes = await readFile(receiptPath);
    receipt = JSON.parse(receiptBytes.toString("utf8"));
    invariant(validateExp0023AttemptReceipt(receipt, boundary),
      "receipt órfão inválido");
    const now = new Date().toISOString();
    result = {
      kind: "orphan-receipt",
      startedAt: receipt.consumedAt,
      completedAt: now
    };
    state = "orphan-recovery-no-worker";
  } else {
    ({ receipt, receiptBytes } = await (options.consumeAttempt ??
      consumeExp0023Attempt)(boundary));
    invariant(validateExp0023AttemptReceipt(receipt, boundary),
      "receipt recém-criado inválido");
    result = await (options.runWorker ?? runExp0023WorkerProcess)({
      projectRoot
    });
    state = "fresh";
  }
  const report = classifyExp0023WorkerResult(result, boundary, receiptBytes);
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  await (options.writeReport ?? writeAtomicWriteOnce)(reportPath, reportBytes);
  return Object.freeze({ report, reportBytes, receipt, receiptBytes, state });
}

export function evaluateExp0023PostCommitEvidence(input = {}) {
  const errors = [];
  const byteFields = [
    input.receiptBytes,
    input.reportBytes,
    input.committedReceipt,
    input.committedReport,
    input.headReceipt,
    input.headReport
  ];
  const bytesPresent = byteFields.every((value) =>
    (Buffer.isBuffer(value) || value instanceof Uint8Array) &&
    value.byteLength > 0);
  const checks = {
    reportBindingValid: input.reportBindingValid === true,
    canonicalHashValid: input.canonicalHashValid === true,
    gitTopologyValid:
      COMMIT_PATTERN.test(input.attemptCommit ?? "") &&
      COMMIT_PATTERN.test(input.receiptCommit ?? "") &&
      COMMIT_PATTERN.test(input.reportCommit ?? "") &&
      COMMIT_PATTERN.test(input.reportCommitParent ?? "") &&
      input.receiptCommit === input.reportCommit &&
      input.reportCommitParent === input.attemptCommit &&
      input.reportCommitAncestor === true,
    evidenceCommitIsolated: isDeepStrictEqual(
      input.changedPaths,
      [EXP0023_BOUNDARY_PATHS.receipt, EXP0023_BOUNDARY_PATHS.report].toSorted()
    ) && bytesPresent && Buffer.from(input.receiptBytes).equals(
      Buffer.from(input.committedReceipt)) &&
      Buffer.from(input.reportBytes).equals(
        Buffer.from(input.committedReport)) &&
      Buffer.from(input.receiptBytes).equals(
        Buffer.from(input.headReceipt)) &&
      Buffer.from(input.reportBytes).equals(
        Buffer.from(input.headReport))
  };
  for (const key of EXP0023_POST_COMMIT_AUDIT_KEYS) {
    if (checks[key] !== true) errors.push(`${key} falhou`);
  }
  return Object.freeze({ valid: errors.length === 0, checks, errors });
}

export function evaluateExp0023ReportBindings(input = {}) {
  try {
    const facts = receiptFacts(
      input.boundary,
      input.receiptBytes,
      input.report?.campaign?.workerEnvelope?.startedAt
    );
    const expectedBoundary = boundaryRecord(
      input.boundary,
      input.receiptBytes,
      facts
    );
    const expectedAudits = auditRecord(facts);
    const errors = [];
    if (!facts.receiptValid) errors.push("receipt inválido");
    if (!isDeepStrictEqual(
      input.report?.campaign?.boundary,
      expectedBoundary
    )) errors.push("boundary do relatório não foi reconstruído");
    if (!isDeepStrictEqual(
      input.report?.campaign?.audits,
      expectedAudits
    )) errors.push("audits do relatório não foram reconstruídos");
    return Object.freeze({ valid: errors.length === 0, facts, errors });
  } catch (error) {
    return Object.freeze({
      valid: false,
      facts: Object.freeze({
        receiptValid: false,
        receiptBeforeWorker: false
      }),
      errors: [`bindings malformados: ${error.message}`]
    });
  }
}

export function formatExp0023CheckSuccess(report) {
  invariant(Object.values(EXP0023_DECISIONS).includes(report?.decision),
    "decisão ausente no relatório verificado");
  return `EXP-0023 CHECK PASS · decision=${report.decision} · ` +
    report.reportSha256;
}

export async function verifyExp0023RecordedEvidence(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const boundary = await verifyExp0023CommittedBoundary({
    projectRoot,
    allowEvidenceDescendants: true
  });
  const [receiptBytes, reportBytes] = await Promise.all([
    readFile(resolve(projectRoot, EXP0023_BOUNDARY_PATHS.receipt)),
    readFile(resolve(projectRoot, EXP0023_BOUNDARY_PATHS.report))
  ]);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  const report = JSON.parse(reportBytes.toString("utf8"));
  invariant(validateExp0023AttemptReceipt(receipt, boundary),
    "receipt gravado divergiu");
  const reportValidation = validateExp0023Report(report);
  invariant(reportValidation.valid, reportValidation.errors.join("; "));
  const reportBindings = evaluateExp0023ReportBindings({
    report,
    receiptBytes,
    boundary
  });
  invariant(reportBindings.valid, reportBindings.errors.join("; "));
  const [receiptCommit, reportCommit] = await Promise.all([
    gitText(projectRoot, "log", "-1", "--format=%H", "--",
      EXP0023_BOUNDARY_PATHS.receipt),
    gitText(projectRoot, "log", "-1", "--format=%H", "--",
      EXP0023_BOUNDARY_PATHS.report)
  ]);
  const [reportCommitParent, evidenceChangedPaths, committedReceipt,
    committedReport, headReceipt, headReport] = await Promise.all([
    gitText(projectRoot, "rev-parse", `${reportCommit}^`),
    changedPaths(projectRoot, reportCommit),
    gitBytes(projectRoot, "show",
      `${receiptCommit}:${EXP0023_BOUNDARY_PATHS.receipt}`),
    gitBytes(projectRoot, "show",
      `${reportCommit}:${EXP0023_BOUNDARY_PATHS.report}`),
    gitBytes(projectRoot, "show", `HEAD:${EXP0023_BOUNDARY_PATHS.receipt}`),
    gitBytes(projectRoot, "show", `HEAD:${EXP0023_BOUNDARY_PATHS.report}`)
  ]);
  let ancestor = true;
  try {
    await gitBytes(projectRoot, "merge-base", "--is-ancestor", reportCommit,
      "HEAD");
  } catch {
    ancestor = false;
  }
  const postCommit = evaluateExp0023PostCommitEvidence({
    attemptCommit: boundary.attemptCommit,
    receiptCommit,
    reportCommit,
    reportCommitParent,
    reportCommitAncestor: ancestor,
    changedPaths: evidenceChangedPaths,
    receiptBytes,
    reportBytes,
    committedReceipt,
    committedReport,
    headReceipt,
    headReport,
    reportBindingValid: true,
    canonicalHashValid: reportValidation.valid
  });
  invariant(postCommit.valid, postCommit.errors.join("; "));
  return Object.freeze({ report, receipt, postCommit });
}

export function parseExp0023SupervisorArgs(args) {
  invariant(
    args.length === 0 || (args.length === 1 && args[0] === "--check"),
    "aceita somente --check"
  );
  return Object.freeze({ check: args[0] === "--check" });
}

async function main() {
  const options = parseExp0023SupervisorArgs(process.argv.slice(2));
  if (options.check) {
    const { report } = await verifyExp0023RecordedEvidence();
    console.log(formatExp0023CheckSuccess(report));
    return;
  }
  const { report, state } = await runExp0023Supervisor();
  console.log(
    `EXP-0023 ${report.decision} (${state}) · ${report.reportSha256}`
  );
  console.log(`Report: ${EXP0023_BOUNDARY_PATHS.report}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) await main();
