import { createHash, randomBytes } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

import { canonicalSha256 } from "./factory/canonical-hash.mjs";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

async function exists(path) {
  return access(path).then(() => true, (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await rename(temporary, path);
}

function safeSessionId(value) {
  invariant(
    typeof value === "string" && /^exp0026-[A-Za-z0-9-]{8,100}$/u.test(value),
    "sessionId EXP-0026 inválido"
  );
  return value;
}

function assertScopedRoot(dataRoot) {
  const root = resolve(dataRoot);
  invariant(root !== "/" && basename(root) !== "", "dataRoot destrutivo inválido");
  return root;
}

function safePublishedArtifact(projectRoot, path) {
  invariant(typeof path === "string", "path de artefato publicado inválido");
  invariant(
    /^eval\/reports\/exp-0026-[A-Za-z0-9._-]+\.json$/u.test(path),
    "retirada só pode remover relatório público EXP-0026 explicitamente listado"
  );
  const root = resolve(projectRoot);
  const target = resolve(root, path);
  invariant(
    relative(root, target) !== "" && !relative(root, target).startsWith(".."),
    "artefato publicado escapou do projeto"
  );
  return target;
}

export function createExp0026WithdrawalCode() {
  return `wd-${randomBytes(24).toString("base64url")}`;
}

export function hashExp0026WithdrawalCode(code) {
  invariant(
    typeof code === "string" && /^wd-[A-Za-z0-9_-]{24,80}$/u.test(code),
    "código de retirada inválido"
  );
  return createHash("sha256").update(`EXP-0026:${code}`).digest("hex");
}

export function createExp0026WithdrawalTombstone(input) {
  const core = {
    schemaVersion: "exp-0026-withdrawal-tombstone-v2",
    experimentId: "EXP-0026",
    status: input.status,
    sessionId: safeSessionId(input.sessionId),
    rosterSlotId: input.rosterSlotId ?? null,
    withdrawalReceiptHash: input.withdrawalReceiptHash,
    fitEligibility: "none-withdrawn",
    previousSessionPhase: input.previousSessionPhase,
    invalidatedAnalysisPhase: input.invalidatedAnalysisPhase ?? null,
    invalidatedCoderId: input.invalidatedCoderId ?? null,
    freshCoderRequired: input.freshCoderRequired === true,
    publicCloseoutInvalidationRequired:
      input.publicCloseoutInvalidationRequired === true,
    invalidatedPublishedArtifacts:
      input.invalidatedPublishedArtifacts ?? [],
    withdrawnAt: input.withdrawnAt
  };
  invariant(/^[a-f0-9]{64}$/u.test(core.withdrawalReceiptHash), "hash de recibo inválido");
  invariant(
    core.rosterSlotId === null || /^SLOT-[1-6]$/u.test(core.rosterSlotId),
    "rosterSlotId de tombstone inválido"
  );
  invariant(
    Array.isArray(core.invalidatedPublishedArtifacts) &&
      core.invalidatedPublishedArtifacts.every((path) =>
        /^eval\/reports\/exp-0026-[A-Za-z0-9._-]+\.json$/u.test(path)),
    "lista de artefatos publicados inválida"
  );
  invariant(["PENDING_DELETE", "WITHDRAWN_AND_DELETED"].includes(core.status), "status de tombstone inválido");
  invariant(Number.isFinite(Date.parse(core.withdrawnAt)), "withdrawnAt inválido");
  return {
    ...core,
    tombstoneSha256: `sha256:${canonicalSha256(core)}`
  };
}

async function tombstonesByCode(dataRoot, receiptHash) {
  const roots = ["withdrawn-tombstones", "retention-tombstones"];
  const matches = [];
  for (const name of roots) {
    const root = resolve(dataRoot, name);
    const entries = await readdir(root, { withFileTypes: true })
      .catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const value = JSON.parse(await readFile(resolve(root, entry.name), "utf8"));
      if (value.withdrawalReceiptHash === receiptHash) {
        matches.push({ root: name, path: resolve(root, entry.name), value });
      }
    }
  }
  return matches;
}

async function activeSessionByCode(dataRoot, receiptHash) {
  const sessionsRoot = resolve(dataRoot, "sessions");
  const matches = [];
  const entries = await readdir(sessionsRoot, { withFileTypes: true })
    .catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = resolve(sessionsRoot, entry.name);
    const statePath = resolve(root, "session.private.json");
    const session = JSON.parse(await readFile(statePath, "utf8"));
    if (session.withdrawalReceiptHash === receiptHash) {
      matches.push({ root, session });
    }
  }
  invariant(matches.length <= 1, "código de retirada duplicado entre sessões");
  return matches[0] ?? null;
}

export async function withdrawExp0026PersistedSession(options) {
  const dataRoot = assertScopedRoot(options.dataRoot);
  const withdrawnAt = options.withdrawnAt ?? new Date().toISOString();
  const receiptHash = hashExp0026WithdrawalCode(options.code);
  const tombstoneMatches = await tombstonesByCode(dataRoot, receiptHash);
  invariant(tombstoneMatches.length <= 1, "recibo aparece em múltiplos tombstones");
  if (tombstoneMatches.length === 1 &&
      tombstoneMatches[0].value.status !== "PENDING_DELETE") {
    return {
      status: tombstoneMatches[0].root === "retention-tombstones"
        ? "ALREADY_PURGED_BY_RETENTION"
        : "ALREADY_WITHDRAWN",
      sessionId: tombstoneMatches[0].value.sessionId,
      idempotent: true,
      rawDataPresent: false
    };
  }
  const active = await activeSessionByCode(dataRoot, receiptHash);
  const pending = tombstoneMatches[0]?.value?.status === "PENDING_DELETE"
    ? tombstoneMatches[0]
    : null;
  invariant(active || pending, "nenhuma sessão corresponde ao recibo de retirada");
  const analysisRoot = resolve(dataRoot, "analysis");
  const analysisStatePath = resolve(analysisRoot, "analysis-state.private.json");
  const analysisState = await readFile(analysisStatePath, "utf8")
    .then(JSON.parse)
    .catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  const codingPath = resolve(analysisRoot, "technical-coding.sealed.json");
  const coding = await readFile(codingPath, "utf8")
    .then(JSON.parse)
    .catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  const closeoutPath = resolve(dataRoot, "closeout.private.json");
  const closeout = await readFile(closeoutPath, "utf8")
    .then(JSON.parse)
    .catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  if (closeout !== null) {
    const closeoutValidation = validateExp0026CloseoutManifest(closeout);
    invariant(closeoutValidation.valid, closeoutValidation.errors.join("; "));
  }
  const humanWasOpened = pending?.value?.freshCoderRequired === true ||
    ["HUMAN_OPENED", "ANALYSIS_COMPLETE", "CLOSEOUT"]
      .includes(analysisState?.phase) || closeout !== null;
  const sessionId = active?.session?.sessionId ?? pending.value.sessionId;
  const tombstonePath = resolve(
    dataRoot,
    "withdrawn-tombstones",
    `${safeSessionId(sessionId)}.json`
  );
  const base = pending?.value ?? {
    sessionId,
    rosterSlotId: active.session.rosterSlotId,
    withdrawalReceiptHash: receiptHash,
    previousSessionPhase: active.session.phase,
    invalidatedAnalysisPhase: analysisState?.phase ?? null,
    invalidatedCoderId: humanWasOpened ? coding?.coderId ?? null : null,
    freshCoderRequired: humanWasOpened,
    publicCloseoutInvalidationRequired:
      closeout !== null || pending?.value?.publicCloseoutInvalidationRequired === true,
    invalidatedPublishedArtifacts:
      closeout?.publishedArtifacts?.map((item) => item.path) ?? [],
    withdrawnAt
  };
  if (!pending) {
    await atomicJson(tombstonePath, createExp0026WithdrawalTombstone({
      ...base,
      status: "PENDING_DELETE"
    }));
  }
  if (active) await rm(active.root, { recursive: true, force: true });
  if (
    analysisState !== null ||
    pending?.value?.invalidatedAnalysisPhase !== null ||
    closeout !== null
  ) {
    await rm(analysisRoot, { recursive: true, force: true });
  }
  const publishedArtifacts = closeout?.publishedArtifacts ??
    (base.invalidatedPublishedArtifacts ?? []).map((path) => ({ path }));
  if (closeout !== null) {
    invariant(options.projectRoot, "projectRoot é obrigatório para invalidar closeout publicado");
    for (const artifact of publishedArtifacts) {
      const target = safePublishedArtifact(options.projectRoot, artifact.path);
      await rm(target, { force: true });
    }
    await rm(closeoutPath, { force: true });
  }
  const invalidation = {
    schemaVersion: "exp-0026-analysis-invalidation-v1",
    experimentId: "EXP-0026",
    sessionId,
    invalidatedAnalysisPhase:
      analysisState?.phase ?? pending?.value?.invalidatedAnalysisPhase ?? null,
    invalidatedCoderId: humanWasOpened
      ? coding?.coderId ?? pending?.value?.invalidatedCoderId ?? null
      : null,
    freshCoderRequired: humanWasOpened,
    publicCloseoutInvalidationRequired:
      closeout !== null || base.publicCloseoutInvalidationRequired === true,
    invalidatedPublishedArtifacts: publishedArtifacts.map((item) => item.path),
    invalidatedAt: withdrawnAt
  };
  invalidation.invalidationSha256 = `sha256:${canonicalSha256(invalidation)}`;
  await atomicJson(resolve(
    dataRoot,
    "analysis-invalidations",
    `${sessionId}.json`
  ), invalidation);
  const finalTombstone = createExp0026WithdrawalTombstone({
    ...base,
    status: "WITHDRAWN_AND_DELETED"
  });
  await atomicJson(tombstonePath, finalTombstone);
  return {
    status: "WITHDRAWN_AND_DELETED",
    sessionId,
    idempotent: false,
    rawDataPresent: false,
    invalidatedAnalysisPhase:
      analysisState?.phase ?? pending?.value?.invalidatedAnalysisPhase ?? null,
    freshCoderRequired: humanWasOpened,
    publicCloseoutInvalidationRequired:
      closeout !== null || base.publicCloseoutInvalidationRequired === true,
    tombstoneSha256: finalTombstone.tombstoneSha256
  };
}

export function validateExp0026CloseoutManifest(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== "exp-0026-private-closeout-v1") {
    errors.push("schemaVersion de closeout inválida");
  }
  if (manifest?.experimentId !== "EXP-0026") errors.push("experimentId inválido");
  if (!Number.isFinite(Date.parse(manifest?.closedAt ?? ""))) {
    errors.push("closedAt inválido");
  }
  if (
    !Array.isArray(manifest?.sessionIds) ||
    manifest.sessionIds.length !== 6 ||
    new Set(manifest.sessionIds).size !== 6
  ) errors.push("closeout exige seis sessionIds únicos");
  else {
    for (const id of manifest.sessionIds) {
      try { safeSessionId(id); } catch (error) { errors.push(error.message); }
    }
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(manifest?.analysisSha256 ?? "")) {
    errors.push("analysisSha256 inválido");
  }
  if (!Array.isArray(manifest?.publishedArtifacts)) {
    errors.push("publishedArtifacts precisa ser lista explícita");
  } else {
    for (const [index, artifact] of manifest.publishedArtifacts.entries()) {
      if (!/^eval\/reports\/exp-0026-[A-Za-z0-9._-]+\.json$/u.test(artifact?.path ?? "")) {
        errors.push(`publishedArtifacts[${index}].path inválido`);
      }
      if (!/^sha256:[a-f0-9]{64}$/u.test(artifact?.fileSha256 ?? "")) {
        errors.push(`publishedArtifacts[${index}].fileSha256 inválido`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export async function purgeExp0026Retention(options) {
  const dataRoot = assertScopedRoot(options.dataRoot);
  const manifest = options.closeoutManifest;
  const validation = validateExp0026CloseoutManifest(manifest);
  invariant(validation.valid, validation.errors.join("; "));
  const asOf = new Date(options.asOf ?? Date.now());
  invariant(Number.isFinite(asOf.valueOf()), "asOf inválido");
  const dueAt = new Date(
    new Date(manifest.closedAt).valueOf() + 30 * 24 * 60 * 60 * 1_000
  );
  const manifestSha256 = `sha256:${canonicalSha256(manifest)}`;
  const receiptPath = resolve(dataRoot, "retention-purge-receipt.private.json");
  if (await exists(receiptPath)) {
    const prior = JSON.parse(await readFile(receiptPath, "utf8"));
    invariant(prior.closeoutManifestSha256 === manifestSha256, "purge anterior aponta para outro closeout");
    return { ...prior, status: "ALREADY_PURGED", idempotent: true };
  }
  const targets = [
    ...manifest.sessionIds.map((id) => resolve(dataRoot, "sessions", id)),
    resolve(dataRoot, "analysis")
  ];
  if (asOf < dueAt) {
    return {
      schemaVersion: "exp-0026-retention-plan-v1",
      status: "BLOCKED_NOT_DUE",
      closeoutManifestSha256: manifestSha256,
      dueAt: dueAt.toISOString(),
      asOf: asOf.toISOString(),
      targetCount: targets.length,
      applied: false
    };
  }
  if (options.apply !== true) {
    return {
      schemaVersion: "exp-0026-retention-plan-v1",
      status: "READY_TO_PURGE",
      closeoutManifestSha256: manifestSha256,
      dueAt: dueAt.toISOString(),
      asOf: asOf.toISOString(),
      targetCount: targets.length,
      applied: false
    };
  }
  const tombstoneRoot = resolve(dataRoot, "retention-tombstones");
  await mkdir(tombstoneRoot, { recursive: true, mode: 0o700 });
  let sessionsDeleted = 0;
  for (const sessionId of manifest.sessionIds) {
    const root = resolve(dataRoot, "sessions", safeSessionId(sessionId));
    const statePath = resolve(root, "session.private.json");
    const session = await readFile(statePath, "utf8")
      .then(JSON.parse)
      .catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (session) {
      invariant(
        /^[a-f0-9]{64}$/u.test(session.withdrawalReceiptHash ?? ""),
        `${sessionId} não tem recibo de retirada`
      );
      const tombstone = {
        schemaVersion: "exp-0026-retention-tombstone-v1",
        experimentId: "EXP-0026",
        status: "PURGED_BY_RETENTION",
        sessionId,
        withdrawalReceiptHash: session.withdrawalReceiptHash,
        fitEligibility: "none-retention-purged",
        closedAt: manifest.closedAt,
        purgedAt: asOf.toISOString()
      };
      tombstone.tombstoneSha256 = `sha256:${canonicalSha256(tombstone)}`;
      await atomicJson(resolve(tombstoneRoot, `${sessionId}.json`), tombstone);
      await rm(root, { recursive: true, force: true });
      sessionsDeleted += 1;
    }
  }
  await rm(resolve(dataRoot, "analysis"), { recursive: true, force: true });
  const receipt = {
    schemaVersion: "exp-0026-retention-purge-receipt-v1",
    experimentId: "EXP-0026",
    status: "PURGED",
    closeoutManifestSha256: manifestSha256,
    closedAt: manifest.closedAt,
    dueAt: dueAt.toISOString(),
    purgedAt: asOf.toISOString(),
    sessionsDeleted,
    privateAnalysisDeleted: true,
    idempotent: false
  };
  receipt.purgeReceiptSha256 = `sha256:${canonicalSha256(receipt)}`;
  await atomicJson(receiptPath, receipt);
  return receipt;
}
