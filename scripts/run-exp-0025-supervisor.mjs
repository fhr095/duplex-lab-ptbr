import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  link,
  mkdir,
  open,
  readFile,
  unlink
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  EXP0025_BOUNDARY_PATHS,
  EXP0025_CONFIG,
  EXP0025_EXP0019_EVIDENCE_COMMIT,
  EXP0025_INSTRUMENTATION_SOURCE_PATHS,
  EXP0025_OFFICIAL_COMMAND,
  EXP0025_PRODUCTION_SOURCE_PATHS,
  EXP0025_RUNTIME_FINGERPRINT_ALGORITHM,
  EXP0025_RUNTIME_FINGERPRINT_ROOTS,
  validateExp0025C0Boundary,
  validateExp0025EvidenceCommitBoundary,
  validateExp0025FreezeCommitBoundary,
  validateExp0025InstrumentationFreeze,
  validateExp0025OpeningCommitBoundary,
  validateExp0025PhysicalStopAttempt
} from "../src/eval/exp-0025-boundary.mjs";
import {
  EXP0025_JOURNAL_FRAME_TYPES,
  EXP0025_JOURNAL_INSPECTION_STATES,
  createExp0025JournalFrame,
  inspectExp0025Journal,
  serializeExp0025JournalFrame
} from "../src/eval/exp-0025-journal.mjs";
import {
  EXP0025_DECISIONS,
  EXP0025_EXECUTION_STATES,
  createExp0025Report,
  validateExp0025Report
} from "../src/eval/exp-0025-stop-order.mjs";
import { canonicalSha256, canonicalJson } from
  "../src/eval/factory/canonical-hash.mjs";
import {
  EXP0025_SUPERVISOR_ACK_SCHEMA,
  EXP0025_SUPERVISOR_START_SCHEMA,
  EXP0025_WORKER_COMMAND,
  validateExp0025WorkerMessage
} from "./run-exp-0025-worker.mjs";

export const EXP0025_RECEIPT_SCHEMA =
  "exp-0025-causal-render-onset-attempt-consumption-v1";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_WORKER_STDOUT_BYTES = 32 * 1024 * 1024;
const MAX_WORKER_STDERR_BYTES = 128 * 1024;
const MAX_WORKER_LINE_CHARS = 5 * 1024 * 1024;
const SUPERVISOR_OWNED_TYPES = new Set([
  EXP0025_JOURNAL_FRAME_TYPES.inProgress,
  EXP0025_JOURNAL_FRAME_TYPES.workerStarted,
  EXP0025_JOURNAL_FRAME_TYPES.workerOutcome
]);

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0025 supervisor: ${message}`);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) && isDeepStrictEqual(
      Object.keys(value).toSorted(),
      [...keys].toSorted()
    );
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

async function exists(path) {
  return access(path).then(() => true, () => false);
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
        rejectGit(new Error(
          `git ${args[0]} falhou (${code ?? signal}): ` +
            Buffer.concat(stderr).toString("utf8").trim()
        ));
        return;
      }
      const bytes = Buffer.concat(stdout);
      resolveGit(encoding === "buffer" ? bytes : bytes.toString(encoding));
    });
  });
}

async function gitText(projectRoot, ...args) {
  return (await execGit(projectRoot, args, "utf8")).trim();
}

async function gitBytes(projectRoot, ...args) {
  return execGit(projectRoot, args, "buffer");
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

function runtimeFingerprint(files) {
  const ordered = files.toSorted((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const digest = createHash("sha256");
  for (const file of ordered) {
    digest.update(
      `${file.path.length}:${file.path}:${file.bytes.length}:`,
      "utf8"
    );
    digest.update(file.bytes);
  }
  return {
    algorithm: EXP0025_RUNTIME_FINGERPRINT_ALGORITHM,
    sha256: digest.digest("hex"),
    fileCount: ordered.length,
    roots: [...EXP0025_RUNTIME_FINGERPRINT_ROOTS]
  };
}

async function runtimeFingerprintAtCommit(projectRoot, commit) {
  const listing = await gitBytes(
    projectRoot,
    "ls-tree",
    "-rz",
    "--name-only",
    commit,
    "--",
    ...EXP0025_RUNTIME_FINGERPRINT_ROOTS
  );
  const paths = listing.toString("utf8").split("\0").filter(Boolean);
  const files = [];
  for (const path of paths) {
    files.push({
      path,
      bytes: await gitBytes(projectRoot, "show", `${commit}:${path}`)
    });
  }
  return runtimeFingerprint(files);
}

async function verifyArtifactAtCommit(projectRoot, commit, record) {
  const bytes = await gitBytes(projectRoot, "show", `${commit}:${record.path}`);
  invariant(sha256(bytes) === record.fileSha256,
    `artefato congelado divergiu: ${record.path}`);
}

async function verifyFrozenSources(projectRoot, freeze) {
  for (const record of freeze.productionSources) {
    const [c0Bytes, baselineBytes] = await Promise.all([
      gitBytes(projectRoot, "show", `${freeze.runnerSourceCommit}:${record.path}`),
      gitBytes(projectRoot, "show",
        `${EXP0025_EXP0019_EVIDENCE_COMMIT}:${record.path}`)
    ]);
    invariant(
      sha256(c0Bytes) === record.fileSha256 &&
        sha256(baselineBytes) === record.exp0019FileSha256 &&
        c0Bytes.equals(baselineBytes),
      `fonte produtiva divergiu: ${record.path}`
    );
  }
  for (const record of freeze.instrumentationSources) {
    invariant(
      sha256(await gitBytes(
        projectRoot,
        "show",
        `${freeze.runnerSourceCommit}:${record.path}`
      )) === record.fileSha256,
      `fonte de instrumentação divergiu: ${record.path}`
    );
  }
  for (const record of Object.values(freeze.artifacts)) {
    await verifyArtifactAtCommit(projectRoot, freeze.runnerSourceCommit, record);
  }
  invariant(isDeepStrictEqual(
    await runtimeFingerprintAtCommit(projectRoot, freeze.runnerSourceCommit),
    freeze.runtimeBinding
  ), "fingerprint do runtime C0 divergiu");
}

function expectedStatusPaths(receiptPresent, journalPresent) {
  return [
    ...(journalPresent ? [EXP0025_BOUNDARY_PATHS.journal] : []),
    ...(receiptPresent ? [EXP0025_BOUNDARY_PATHS.receipt] : [])
  ].toSorted().map((path) => `?? ${path}`).join("\n");
}

export async function verifyExp0025CommittedBoundary(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const allowEvidenceDescendants = options.allowEvidenceDescendants === true;
  const receiptPresent = options.receiptPresent === true;
  const journalPresent = options.journalPresent === true;
  const status = await gitText(
    projectRoot,
    "status",
    "--porcelain=v1",
    "--untracked-files=all"
  );
  const expectedStatus = allowEvidenceDescendants
    ? ""
    : expectedStatusPaths(receiptPresent, journalPresent);
  invariant(status === expectedStatus,
    `worktree fora da fronteira: ${status || "(limpa)"}`);

  const freezePath = resolve(projectRoot, EXP0025_BOUNDARY_PATHS.freeze);
  const openingPath = resolve(projectRoot, EXP0025_BOUNDARY_PATHS.opening);
  const [freezeBytes, openingBytes] = await Promise.all([
    readFile(freezePath),
    readFile(openingPath)
  ]);
  const freeze = JSON.parse(freezeBytes.toString("utf8"));
  const opening = JSON.parse(openingBytes.toString("utf8"));
  const freezeValidation = validateExp0025InstrumentationFreeze(freeze);
  const openingValidation = validateExp0025PhysicalStopAttempt(opening);
  invariant(freezeValidation.valid, freezeValidation.errors.join("; "));
  invariant(openingValidation.valid, openingValidation.errors.join("; "));
  invariant(process.version === freeze.nodeVersion,
    "Node divergiu do freeze");

  const [head, freezeCommit, openingCommit] = await Promise.all([
    gitText(projectRoot, "rev-parse", "HEAD"),
    gitText(projectRoot, "log", "-1", "--format=%H", "--",
      EXP0025_BOUNDARY_PATHS.freeze),
    gitText(projectRoot, "log", "-1", "--format=%H", "--",
      EXP0025_BOUNDARY_PATHS.opening)
  ]);
  invariant(COMMIT_PATTERN.test(freezeCommit) &&
    COMMIT_PATTERN.test(openingCommit), "commits freeze/opening ausentes");
  if (allowEvidenceDescendants) {
    await gitBytes(projectRoot, "merge-base", "--is-ancestor", openingCommit,
      head);
  } else {
    invariant(head === openingCommit,
      "execução/recovery exige HEAD no opening commit");
  }

  const c0Commit = freeze.runnerSourceCommit;
  const [c0Parent, c0Paths, runtimeChangedPaths, freezeParent, openingParent] =
    await Promise.all([
      gitText(projectRoot, "rev-parse", `${c0Commit}^`),
      changedPaths(projectRoot, c0Commit),
      gitText(
        projectRoot,
        "diff",
        "--name-only",
        `${c0Commit}^`,
        c0Commit,
        "--",
        ...EXP0025_RUNTIME_FINGERPRINT_ROOTS
      ).then((value) => value.split(/\r?\n/u).filter(Boolean).toSorted()),
      gitText(projectRoot, "rev-parse", `${freezeCommit}^`),
      gitText(projectRoot, "rev-parse", `${openingCommit}^`)
    ]);
  invariant(validateExp0025C0Boundary({
    runnerSourceCommit: c0Commit,
    parentCommit: c0Parent,
    changedPaths: c0Paths,
    runtimeChangedPaths
  }), "C0 divergiu da fronteira exata");
  invariant(validateExp0025FreezeCommitBoundary({
    c0Commit,
    freezeCommit,
    parentCommit: freezeParent,
    changedPaths: await changedPaths(projectRoot, freezeCommit)
  }), "freeze commit não é isolado");
  invariant(validateExp0025OpeningCommitBoundary({
    freezeCommit,
    openingCommit,
    parentCommit: openingParent,
    changedPaths: await changedPaths(projectRoot, openingCommit)
  }), "opening commit não é isolado");
  invariant(
    (await gitBytes(projectRoot, "show",
      `${freezeCommit}:${EXP0025_BOUNDARY_PATHS.freeze}`)).equals(freezeBytes),
    "freeze worktree/commit divergiu"
  );
  invariant(
    (await gitBytes(projectRoot, "show",
      `${openingCommit}:${EXP0025_BOUNDARY_PATHS.opening}`)).equals(openingBytes),
    "opening worktree/commit divergiu"
  );
  invariant(
    opening.freeze.freezeCommit === freezeCommit &&
      opening.openingParentCommit === freezeCommit &&
      opening.freeze.runnerSourceCommit === c0Commit &&
      opening.freeze.fileSha256 === sha256(freezeBytes) &&
      opening.freeze.instrumentationFreezeSha256 ===
        freeze.instrumentationFreezeSha256 &&
      opening.freeze.expectedRuntimeFingerprintSha256 ===
        freeze.runtimeBinding.sha256,
    "opening não liga freeze/C0/runtime"
  );
  await verifyFrozenSources(projectRoot, freeze);
  return Object.freeze({
    projectRoot,
    freeze,
    freezeBytes,
    freezeCommit,
    opening,
    openingBytes,
    openingCommit,
    expectedRuntimeFingerprintSha256: freeze.runtimeBinding.sha256
  });
}

function receiptCore(boundary, input) {
  return {
    schemaVersion: EXP0025_RECEIPT_SCHEMA,
    experimentId: "EXP-0025",
    nonce: openingNonce(boundary),
    consumedAt: input.consumedAt,
    deadlineMs: EXP0025_CONFIG.attemptDeadlineMs,
    supervisorPid: input.supervisorPid,
    workerCommand: EXP0025_WORKER_COMMAND,
    opening: {
      path: EXP0025_BOUNDARY_PATHS.opening,
      fileSha256: sha256(boundary.openingBytes),
      canonicalSha256: boundary.opening.physicalStopAttemptSha256,
      commit: boundary.openingCommit
    },
    rerunAllowed: false
  };
}

function openingNonce(boundary) {
  return boundary?.opening?.campaign?.nonce ?? null;
}

export function createExp0025AttemptReceipt(boundary, input = {}) {
  const core = receiptCore(boundary, input);
  const receipt = Object.freeze({
    ...core,
    receiptSha256: `sha256:${canonicalSha256(core)}`
  });
  invariant(validateExp0025AttemptReceipt(receipt, boundary),
    "receipt criado é inválido");
  return receipt;
}

export function validateExp0025AttemptReceipt(receipt, boundary) {
  try {
    if (!exactKeys(receipt, [
      "consumedAt",
      "deadlineMs",
      "experimentId",
      "nonce",
      "opening",
      "receiptSha256",
      "rerunAllowed",
      "schemaVersion",
      "supervisorPid",
      "workerCommand"
    ]) || receipt.schemaVersion !== EXP0025_RECEIPT_SCHEMA ||
      receipt.experimentId !== "EXP-0025" ||
      receipt.nonce !== openingNonce(boundary) ||
      !validDate(receipt.consumedAt) ||
      receipt.deadlineMs !== EXP0025_CONFIG.attemptDeadlineMs ||
      !Number.isSafeInteger(receipt.supervisorPid) ||
      receipt.supervisorPid <= 0 ||
      receipt.workerCommand !== EXP0025_WORKER_COMMAND ||
      receipt.rerunAllowed !== false ||
      !exactKeys(receipt.opening, [
        "canonicalSha256", "commit", "fileSha256", "path"
      ]) || receipt.opening.path !== EXP0025_BOUNDARY_PATHS.opening ||
      receipt.opening.fileSha256 !== sha256(boundary.openingBytes) ||
      receipt.opening.canonicalSha256 !==
        boundary.opening.physicalStopAttemptSha256 ||
      receipt.opening.commit !== boundary.openingCommit) return false;
    const core = structuredClone(receipt);
    delete core.receiptSha256;
    return receipt.receiptSha256 === `sha256:${canonicalSha256(core)}`;
  } catch {
    return false;
  }
}

async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeExp0025AtomicWriteOnce(path, bytes) {
  const target = resolve(path);
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, target);
    await syncDirectory(parent);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function consumeExp0025Attempt(boundary, options = {}) {
  const consumedAt = options.consumedAt ?? new Date().toISOString();
  const receipt = createExp0025AttemptReceipt(boundary, {
    consumedAt,
    supervisorPid: options.supervisorPid ?? process.pid
  });
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const receiptPath = resolve(
    boundary.projectRoot,
    EXP0025_BOUNDARY_PATHS.receipt
  );
  await (options.writeOnce ?? writeExp0025AtomicWriteOnce)(
    receiptPath,
    receiptBytes
  );
  return Object.freeze({ receipt, receiptBytes });
}

export async function createExp0025JournalWriter(options = {}) {
  const path = resolve(options.path);
  const firstFrame = createExp0025JournalFrame({
    ordinal: 1,
    type: EXP0025_JOURNAL_FRAME_TYPES.inProgress,
    payload: options.inProgress
  });
  const firstBytes = Buffer.from(serializeExp0025JournalFrame(firstFrame, {
    expectedOrdinal: 1
  }));
  await (options.writeOnce ?? writeExp0025AtomicWriteOnce)(path, firstBytes);
  const handle = await open(path, "a", 0o600);
  let ordinal = 1;
  let closed = false;

  async function append(type, payload) {
    invariant(!closed, "journal já fechado");
    const frame = createExp0025JournalFrame({
      ordinal: ordinal + 1,
      type,
      payload
    });
    const bytes = Buffer.from(serializeExp0025JournalFrame(frame, {
      expectedOrdinal: ordinal + 1
    }));
    await handle.writeFile(bytes);
    await handle.sync();
    ordinal += 1;
    return frame;
  }

  return Object.freeze({
    firstFrame,
    append,
    get ordinal() { return ordinal; },
    async close() {
      if (closed) return;
      closed = true;
      await handle.sync();
      await handle.close();
    }
  });
}

function workerOutcomePayload(result) {
  return {
    status: result.status,
    code: result.code,
    completedAt: result.completedAt,
    exitCode: result.exitCode,
    signal: result.signal,
    outcome: {
      kind: result.kind,
      protocolError: result.protocolError,
      recordCount: result.recordCount,
      stderrByteLength: result.stderrByteLength,
      stderrSha256: result.stderrSha256,
      stderrTruncated: result.stderrTruncated
    }
  };
}

function writeStreamLine(stream, value) {
  return new Promise((resolveWrite, rejectWrite) => {
    const line = `${canonicalJson(value)}\n`;
    const onError = (error) => {
      stream.off?.("drain", onDrain);
      rejectWrite(error);
    };
    const onDrain = () => {
      stream.off?.("error", onError);
      resolveWrite();
    };
    stream.once?.("error", onError);
    if (stream.write(line)) {
      stream.off?.("error", onError);
      resolveWrite();
    } else {
      stream.once?.("drain", onDrain);
    }
  });
}

export async function runExp0025WorkerProcess(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const append = options.append;
  invariant(typeof append === "function", "append do journal ausente");
  const child = (options.spawn ?? spawn)(
    process.execPath,
    [resolve(projectRoot, "scripts/run-exp-0025-worker.mjs")],
    {
      cwd: projectRoot,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
  const startedAt = options.startedAt ?? new Date().toISOString();
  const stderrChunks = [];
  let stderrSeen = 0;
  let stderrStored = 0;
  let stderrTruncated = false;
  let stdoutSeen = 0;
  let stdoutBuffer = "";
  let expectedSequence = 1;
  let recordCount = 0;
  let protocolError = null;
  let timedOut = false;
  let processing = Promise.resolve();

  child.stderr?.on("data", (chunk) => {
    const bytes = Buffer.from(chunk);
    stderrSeen += bytes.byteLength;
    const remaining = MAX_WORKER_STDERR_BYTES - stderrStored;
    if (remaining > 0) {
      const stored = bytes.subarray(0, remaining);
      stderrChunks.push(stored);
      stderrStored += stored.byteLength;
    }
    if (stderrSeen > MAX_WORKER_STDERR_BYTES) stderrTruncated = true;
  });

  const failProtocol = (error) => {
    if (protocolError !== null) return;
    protocolError = String(error?.message ?? error).slice(0, 500);
    child.kill?.("SIGTERM");
  };

  async function processLine(line) {
    invariant(line.length > 0 && line.length <= MAX_WORKER_LINE_CHARS,
      "linha IPC vazia ou excedida");
    invariant(!line.includes("\r"), "IPC CRLF recusado");
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      throw new Error(`IPC não é JSON: ${error.message}`);
    }
    invariant(validateExp0025WorkerMessage(message),
      "mensagem IPC não respeita schema/journal");
    invariant(message.sequence === expectedSequence,
      `sequência IPC esperada ${expectedSequence}`);
    invariant(!SUPERVISOR_OWNED_TYPES.has(message.type),
      `worker tentou emitir frame supervisor-owned: ${message.type}`);
    await append(message.type, message.payload);
    await writeStreamLine(child.stdin, {
      schemaVersion: EXP0025_SUPERVISOR_ACK_SCHEMA,
      sequence: expectedSequence,
      status: "persisted"
    });
    expectedSequence += 1;
    recordCount += 1;
  }

  child.stdout?.setEncoding?.("utf8");
  child.stdout?.on("data", (chunk) => {
    stdoutSeen += Buffer.byteLength(chunk);
    if (stdoutSeen > MAX_WORKER_STDOUT_BYTES) {
      failProtocol(new Error("stdout IPC excedeu limite"));
      return;
    }
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop();
    for (const line of lines) {
      processing = processing.then(() => processLine(line));
      processing.catch(failProtocol);
    }
  });

  const closeResult = new Promise((resolveClose) => {
    child.once("error", (error) => resolveClose({ spawnError: error }));
    child.once("close", (exitCode, signal) =>
      resolveClose({ exitCode, signal, spawnError: null }));
  });

  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
    const closed = await closeResult;
    return {
      status: "failed",
      code: "WORKER_SPAWN_ERROR",
      completedAt: new Date().toISOString(),
      exitCode: closed.exitCode ?? null,
      signal: closed.signal ?? null,
      kind: "spawn-error",
      protocolError: closed.spawnError?.message?.slice(0, 500) ?? null,
      recordCount: 0,
      stderrByteLength: stderrSeen,
      stderrSha256: sha256(Buffer.concat(stderrChunks)),
      stderrTruncated
    };
  }

  await append(EXP0025_JOURNAL_FRAME_TYPES.workerStarted, {
    command: EXP0025_WORKER_COMMAND,
    pid: child.pid,
    startedAt
  });
  await writeStreamLine(child.stdin, {
    schemaVersion: EXP0025_SUPERVISOR_START_SCHEMA,
    startedAt,
    status: "authorized"
  });

  const deadlineMs = options.deadlineAtMs === undefined
    ? options.deadlineMs ?? EXP0025_CONFIG.attemptDeadlineMs
    : Math.max(1, options.deadlineAtMs - Date.now());
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill?.("SIGTERM");
    setTimeout(() => child.kill?.("SIGKILL"), 1_000).unref?.();
  }, deadlineMs);
  const closed = await closeResult;
  clearTimeout(timer);
  await processing.catch(() => {});
  if (stdoutBuffer.length > 0) {
    failProtocol(new Error("stdout IPC terminou com fragmento sem newline"));
  }
  child.stdin?.end?.();
  const stderr = Buffer.concat(stderrChunks);
  const success = !timedOut && protocolError === null &&
    closed.spawnError === null && closed.exitCode === 0 &&
    closed.signal === null;
  return {
    status: success ? "completed" : timedOut ? "timed-out" : "failed",
    code: success ? null : timedOut
      ? "WORKER_DEADLINE_EXCEEDED"
      : protocolError !== null
        ? "WORKER_IPC_INVALID"
        : closed.spawnError !== null
          ? "WORKER_SPAWN_ERROR"
          : "WORKER_EXIT_FAILURE",
    completedAt: new Date().toISOString(),
    exitCode: closed.exitCode ?? null,
    signal: closed.signal ?? null,
    kind: success ? "campaign-completed" : timedOut
      ? "deadline-exceeded"
      : protocolError !== null ? "protocol-error" : "worker-failure",
    protocolError,
    recordCount,
    stderrByteLength: stderrSeen,
    stderrSha256: sha256(stderr),
    stderrTruncated
  };
}

function lastJournalDate(inspection, fallback) {
  const candidates = inspection.frames.flatMap((frame) => [
    frame?.payload?.completedAt,
    frame?.payload?.observedAt,
    frame?.payload?.startedAt
  ]).filter(validDate);
  return candidates.at(-1) ?? fallback;
}

function recoveryStateFor(inspection, journalPresent) {
  if (!journalPresent) {
    return {
      executionState: EXP0025_EXECUTION_STATES.recoveryWithoutJournal,
      failureCode: "RECOVERY_RECEIPT_WITHOUT_JOURNAL"
    };
  }
  if (inspection.status === EXP0025_JOURNAL_INSPECTION_STATES.truncatedTail) {
    return {
      executionState: EXP0025_EXECUTION_STATES.recoveryTruncatedTail,
      failureCode: "RECOVERY_TRUNCATED_JOURNAL_TAIL"
    };
  }
  return {
    executionState: EXP0025_EXECUTION_STATES.recoveryValidJournal,
    failureCode: "RECOVERY_SURVIVING_VALID_JOURNAL"
  };
}

export function createExp0025BoundarySummary(input = {}) {
  const worker = input.inspection.frames.find((frame) =>
    frame.type === EXP0025_JOURNAL_FRAME_TYPES.workerStarted);
  return {
    executionState: input.executionState,
    expectedRuntimeFingerprintSha256:
      input.boundary.expectedRuntimeFingerprintSha256,
    failureCode: input.failureCode,
    freezePath: EXP0025_BOUNDARY_PATHS.freeze,
    freezeVerified: true,
    gitTopologyVerified: true,
    journalAppendOnly: input.journalPresent,
    journalByteLength: input.inspection.byteLength,
    journalFsyncBeforeAck: input.executionState ===
      EXP0025_EXECUTION_STATES.fresh,
    journalPath: EXP0025_BOUNDARY_PATHS.journal,
    journalSha256: input.inspection.sha256,
    journalVerified: input.inspection.status ===
      EXP0025_JOURNAL_INSPECTION_STATES.valid,
    openingPath: EXP0025_BOUNDARY_PATHS.opening,
    openingVerified: true,
    receiptConsumedAt: input.receipt.consumedAt,
    receiptPath: EXP0025_BOUNDARY_PATHS.receipt,
    receiptVerified: true,
    receiptWriteOnce: true,
    recoveryOnly: input.executionState !== EXP0025_EXECUTION_STATES.fresh,
    rerunAllowed: false,
    runtimeBindingsVerified: true,
    sourceBindingsVerified: true,
    workerStartedAt: worker?.payload?.startedAt ?? null
  };
}

export function createExp0025ReportFromArtifacts(input = {}) {
  const inspection = input.inspection ?? inspectExp0025Journal(
    input.journalBytes ?? Buffer.alloc(0)
  );
  const campaign = {
    boundary: createExp0025BoundarySummary({ ...input, inspection }),
    journal: inspection
  };
  return createExp0025Report({
    startedAt: input.receipt.consumedAt,
    completedAt: lastJournalDate(inspection, input.receipt.consumedAt),
    campaign
  });
}

export async function runExp0025Supervisor(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const receiptPath = resolve(projectRoot, EXP0025_BOUNDARY_PATHS.receipt);
  const journalPath = resolve(projectRoot, EXP0025_BOUNDARY_PATHS.journal);
  const reportPath = resolve(projectRoot, EXP0025_BOUNDARY_PATHS.report);
  const [receiptPresent, journalPresent, reportPresent] = await Promise.all([
    exists(receiptPath), exists(journalPath), exists(reportPath)
  ]);
  invariant(!reportPresent, "relatório já existe; use somente --check");
  invariant(receiptPresent || !journalPresent,
    "journal sem receipt válido é combinação recusada");
  const boundary = await (options.verifyBoundary ??
    verifyExp0025CommittedBoundary)({
    projectRoot,
    receiptPresent,
    journalPresent
  });

  let receipt;
  let receiptBytes;
  let journalBytes;
  let inspection;
  let executionState;
  let failureCode;
  if (receiptPresent) {
    receiptBytes = await readFile(receiptPath);
    try {
      receipt = JSON.parse(receiptBytes.toString("utf8"));
    } catch {
      invariant(false, "receipt existente não é JSON");
    }
    invariant(validateExp0025AttemptReceipt(receipt, boundary),
      "receipt existente inválido");
    if (journalPresent) {
      journalBytes = await readFile(journalPath);
      inspection = inspectExp0025Journal(journalBytes);
      invariant([
        EXP0025_JOURNAL_INSPECTION_STATES.valid,
        EXP0025_JOURNAL_INSPECTION_STATES.truncatedTail
      ].includes(inspection.status),
      "journal recovery possui frame completo inválido ou estado não permitido");
    } else {
      journalBytes = Buffer.alloc(0);
      inspection = inspectExp0025Journal(journalBytes);
    }
    ({ executionState, failureCode } = recoveryStateFor(
      inspection,
      journalPresent
    ));
  } else {
    invariant(!journalPresent, "execução fresca não aceita journal prévio");
    ({ receipt, receiptBytes } = await (options.consumeAttempt ??
      consumeExp0025Attempt)(boundary));
    invariant(validateExp0025AttemptReceipt(receipt, boundary),
      "receipt recém-criado inválido");
    const writer = await (options.createJournalWriter ??
      createExp0025JournalWriter)({
      path: journalPath,
      inProgress: {
        deadlineMs: EXP0025_CONFIG.attemptDeadlineMs,
        opening: structuredClone(receipt.opening),
        pid: receipt.supervisorPid,
        startedAt: receipt.consumedAt
      }
    });
    let workerResult;
    try {
      try {
        workerResult = await (options.runWorker ?? runExp0025WorkerProcess)({
          projectRoot,
          append: writer.append,
          deadlineAtMs: Date.parse(receipt.consumedAt) +
            EXP0025_CONFIG.attemptDeadlineMs
        });
      } catch (error) {
        workerResult = {
          status: "failed",
          code: "SUPERVISOR_WORKER_PROCESS_ERROR",
          completedAt: new Date().toISOString(),
          exitCode: null,
          signal: null,
          kind: "supervisor-worker-error",
          protocolError: String(error?.message ?? error).slice(0, 500),
          recordCount: 0,
          stderrByteLength: 0,
          stderrSha256: sha256(Buffer.alloc(0)),
          stderrTruncated: false
        };
      }
      await writer.append(
        EXP0025_JOURNAL_FRAME_TYPES.workerOutcome,
        workerOutcomePayload(workerResult)
      );
    } finally {
      await writer.close();
    }
    journalBytes = await readFile(journalPath);
    inspection = inspectExp0025Journal(journalBytes);
    invariant(inspection.status === EXP0025_JOURNAL_INSPECTION_STATES.valid,
      "journal fresco não terminou válido");
    executionState = EXP0025_EXECUTION_STATES.fresh;
    failureCode = null;
  }

  const report = createExp0025ReportFromArtifacts({
    boundary,
    receipt,
    receiptBytes,
    journalBytes,
    journalPresent: journalPresent || !receiptPresent,
    inspection,
    executionState,
    failureCode
  });
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  await (options.writeReport ?? writeExp0025AtomicWriteOnce)(
    reportPath,
    reportBytes
  );
  return Object.freeze({
    state: executionState,
    report,
    reportBytes,
    receipt,
    receiptBytes,
    journalBytes,
    inspection
  });
}

async function runCommand(command, args, cwd) {
  return new Promise((resolveCommand) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => resolveCommand({ code: null, error }));
    child.once("close", (code) => resolveCommand({
      code,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr)
    }));
  });
}

export async function verifyExp0025CliLock(projectRoot = PROJECT_ROOT) {
  const lockPath = resolve(projectRoot, EXP0025_BOUNDARY_PATHS.lock);
  invariant(await exists(lockPath), "lock oficial não foi criado pelo flock");
  const parentCmdline = await readFile(`/proc/${process.ppid}/cmdline`)
    .then((bytes) => bytes.toString("utf8").replaceAll("\0", " "), () => "");
  invariant(parentCmdline.includes("flock") &&
    parentCmdline.includes(EXP0025_BOUNDARY_PATHS.lock),
  "supervisor precisa ser filho do flock oficial");
  const probe = await runCommand(
    "flock",
    ["--exclusive", "--nonblock", lockPath, "true"],
    projectRoot
  );
  invariant(probe.code !== 0,
    "lock oficial não está mantido por owner concorrente");
  return true;
}

export function parseExp0025SupervisorArgs(args) {
  invariant(
    args.length === 0 || (args.length === 1 && args[0] === "--check"),
    "aceita somente --check"
  );
  return Object.freeze({ check: args[0] === "--check" });
}

export function formatExp0025CheckSuccess(report) {
  invariant(Object.values(EXP0025_DECISIONS).includes(report?.decision),
    "decisão ausente no relatório");
  return `EXP-0025 CHECK PASS · decision=${report.decision} · ` +
    report.reportSha256;
}

export async function verifyExp0025RecordedEvidence(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const boundary = await verifyExp0025CommittedBoundary({
    projectRoot,
    allowEvidenceDescendants: true
  });
  const receiptPath = resolve(projectRoot, EXP0025_BOUNDARY_PATHS.receipt);
  const journalPath = resolve(projectRoot, EXP0025_BOUNDARY_PATHS.journal);
  const reportPath = resolve(projectRoot, EXP0025_BOUNDARY_PATHS.report);
  const journalPresent = await exists(journalPath);
  const [receiptBytes, journalBytes, reportBytes] = await Promise.all([
    readFile(receiptPath),
    journalPresent ? readFile(journalPath) : Promise.resolve(Buffer.alloc(0)),
    readFile(reportPath)
  ]);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  const report = JSON.parse(reportBytes.toString("utf8"));
  invariant(validateExp0025AttemptReceipt(receipt, boundary),
    "receipt gravado inválido");
  const validation = validateExp0025Report(report);
  invariant(validation.valid, validation.errors.join("; "));
  const inspection = inspectExp0025Journal(journalBytes);
  const expectedReport = createExp0025ReportFromArtifacts({
    boundary,
    receipt,
    receiptBytes,
    journalBytes,
    journalPresent,
    inspection,
    executionState: report.campaign.boundary.executionState,
    failureCode: report.campaign.boundary.failureCode
  });
  invariant(isDeepStrictEqual(report, expectedReport),
    "relatório não foi reconstruído dos artefatos");

  const [receiptCommit, reportCommit] = await Promise.all([
    gitText(projectRoot, "log", "-1", "--format=%H", "--",
      EXP0025_BOUNDARY_PATHS.receipt),
    gitText(projectRoot, "log", "-1", "--format=%H", "--",
      EXP0025_BOUNDARY_PATHS.report)
  ]);
  const journalCommit = journalPresent
    ? await gitText(projectRoot, "log", "-1", "--format=%H", "--",
      EXP0025_BOUNDARY_PATHS.journal)
    : null;
  invariant(receiptCommit === reportCommit &&
    (!journalPresent || journalCommit === reportCommit),
  "evidence artifacts precisam compartilhar commit");
  const evidenceParent = await gitText(
    projectRoot,
    "rev-parse",
    `${reportCommit}^`
  );
  invariant(validateExp0025EvidenceCommitBoundary({
    evidenceCommit: reportCommit,
    openingCommit: boundary.openingCommit,
    parentCommit: evidenceParent,
    changedPaths: await changedPaths(projectRoot, reportCommit),
    recoveryBeforeJournal: !journalPresent
  }), "evidence commit/topologia divergiram");
  for (const [path, bytes] of [
    [EXP0025_BOUNDARY_PATHS.receipt, receiptBytes],
    ...(journalPresent ? [[EXP0025_BOUNDARY_PATHS.journal, journalBytes]] : []),
    [EXP0025_BOUNDARY_PATHS.report, reportBytes]
  ]) {
    invariant(
      (await gitBytes(projectRoot, "show", `${reportCommit}:${path}`))
        .equals(bytes),
      `evidence bytes divergiram: ${path}`
    );
  }
  return Object.freeze({ boundary, receipt, report, inspection });
}

async function main() {
  const args = parseExp0025SupervisorArgs(process.argv.slice(2));
  if (args.check) {
    const { report } = await verifyExp0025RecordedEvidence();
    console.log(formatExp0025CheckSuccess(report));
    return;
  }
  await verifyExp0025CliLock();
  const { report, state } = await runExp0025Supervisor();
  console.log(`EXP-0025 ${report.decision} (${state}) · ${report.reportSha256}`);
  console.log(`Report: ${EXP0025_BOUNDARY_PATHS.report}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) await main();
