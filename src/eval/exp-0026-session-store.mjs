import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { resolve } from "node:path";

import {
  applyExp0026Consent,
  applyExp0026Preflight,
  completeExp0026Block,
  completeExp0026Commercial,
  createExp0026Session,
  publicExp0026Session,
  sealExp0026Top2,
  startExp0026Block,
  withdrawExp0026Session
} from "./exp-0026-instrument.mjs";

const JSON_LIMIT_BYTES = 8 * 1024 * 1024;
const AUDIO_LIMIT_BYTES = 32 * 1024 * 1024;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new RangeError(`corpo excede ${limit} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const bytes = await readBody(request, JSON_LIMIT_BYTES);
  return JSON.parse(bytes.toString("utf8") || "{}");
}

function securityHeaders(contentType) {
  return {
    "cache-control": "no-store",
    "content-type": contentType,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff"
  };
}

function sendJson(response, status, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`);
  response.writeHead(status, {
    ...securityHeaders("application/json; charset=utf-8"),
    "content-length": body.length
  });
  response.end(body);
}

async function atomicJson(path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, path);
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

function safeArtifactName(blockId) {
  if (!/^(S[1-6]|F0)$/u.test(blockId)) {
    throw new TypeError("ID de bloco não é seguro");
  }
  return blockId.toLowerCase();
}

function assertSnapshot(snapshot) {
  if (
    snapshot === null ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot) ||
    !Array.isArray(snapshot.trace)
  ) {
    throw new TypeError("snapshot técnico inválido");
  }
}

export async function createExp0026SessionStore(options) {
  if (
    typeof options.accessToken !== "string" ||
    options.accessToken.length < 32
  ) {
    throw new TypeError("accessToken privado do instrumento é obrigatório");
  }
  const projectRoot = resolve(options.projectRoot);
  const packPath = resolve(projectRoot, options.packPath);
  const pack = JSON.parse(await readFile(packPath, "utf8"));
  const dataRoot = resolve(projectRoot, options.dataRoot);
  const noiseBytes = await readFile(resolve(projectRoot, pack.noise.artifactPath));
  if (sha256(noiseBytes) !== pack.noise.sha256) {
    throw new Error("artefato de ruído S5 diverge do pack congelado");
  }
  const session = createExp0026Session(pack, {
    role: options.role,
    participantAlias: options.participantAlias,
    orderIndex: options.orderIndex,
    processRunId: options.processRunId,
    commercialAvailable: options.commercialAvailable,
    idFactory: options.idFactory,
    now: options.now
  });
  const sessionRoot = resolve(dataRoot, "sessions", session.sessionId);
  const traceRoot = resolve(sessionRoot, "technical-traces");
  await mkdir(traceRoot, { recursive: true, mode: 0o700 });
  const statePath = resolve(sessionRoot, "session.private.json");
  const receiptPath = resolve(sessionRoot, "session.receipt.json");
  const runtimeSnapshot = options.runtimeSnapshot;

  async function persist() {
    return atomicJson(statePath, session);
  }

  await persist();
  await atomicJson(receiptPath, {
    schemaVersion: "exp-0026-session-receipt-v1",
    sessionId: session.sessionId,
    processRunId: session.processRunId,
    role: session.role,
    analysisEligibility: session.analysisEligibility,
    fitEligibility: "evaluation-only",
    packPath: options.packPath,
    createdAt: session.createdAt
  });

  function accessAuthorized(request, url) {
    return request.headers["x-exp0026-access-token"] === options.accessToken ||
      url.searchParams.get("token") === options.accessToken;
  }

  function mutationAuthorized(request) {
    return request.headers["x-exp0026-session-id"] === session.sessionId;
  }

  async function persistTrace(blockId, snapshot) {
    assertSnapshot(snapshot);
    const artifact = {
      schemaVersion: "exp-0026-technical-trace-v1",
      sessionId: session.sessionId,
      participantHash: session.participantHash,
      role: session.role,
      blockId,
      fitEligibility: "evaluation-only",
      capturedAt: new Date().toISOString(),
      snapshot
    };
    const path = resolve(traceRoot, `${safeArtifactName(blockId)}.json`);
    const result = await atomicJson(path, artifact);
    return {
      path: `technical-traces/${safeArtifactName(blockId)}.json`,
      sha256: result.sha256,
      bytes: result.bytes
    };
  }

  async function handle(request, response, url) {
    if (!url.pathname.startsWith("/api/exp-0026/")) return false;

    try {
      if (request.method === "GET" && url.pathname === "/api/exp-0026/session") {
        if (!accessAuthorized(request, url)) {
          sendJson(response, 403, { error: "instrument_access_required" });
          return true;
        }
        sendJson(response, 200, publicExp0026Session(
          session,
          pack,
          runtimeSnapshot()
        ));
        return true;
      }
      if (!accessAuthorized(request, url) || !mutationAuthorized(request)) {
        sendJson(response, 403, { error: "session_binding_required" });
        return true;
      }
      if (request.method === "GET" && url.pathname === "/api/exp-0026/noise") {
        response.writeHead(200, {
          ...securityHeaders("audio/wav"),
          "content-length": noiseBytes.length,
          "x-content-sha256": pack.noise.sha256
        });
        response.end(noiseBytes);
        return true;
      }
      if (request.method === "POST" && url.pathname === "/api/exp-0026/consent") {
        applyExp0026Consent(session, await readJson(request), { now: options.now });
        await persist();
      } else if (request.method === "POST" && url.pathname === "/api/exp-0026/preflight") {
        applyExp0026Preflight(session, await readJson(request), runtimeSnapshot(), { now: options.now });
        await persist();
      } else if (request.method === "POST" && url.pathname === "/api/exp-0026/block/start") {
        const body = await readJson(request);
        startExp0026Block(session, body.blockId, {
          now: options.now,
          nowMs: options.nowMs
        });
        await persist();
      } else if (request.method === "POST" && url.pathname === "/api/exp-0026/block") {
        const body = await readJson(request);
        const completedAt = (options.now ?? (() => new Date().toISOString()))();
        const completedAtEpochMs = (options.nowMs ?? Date.now)();
        const completionClock = {
          now: () => completedAt,
          nowMs: () => completedAtEpochMs
        };
        completeExp0026Block(
          structuredClone(session),
          body,
          pack,
          completionClock
        );
        if (session.consent.trace) {
          const traceArtifact = await persistTrace(body.blockId, body.snapshot);
          completeExp0026Block(session, body, pack, completionClock);
          session.annotations.at(-1).traceArtifact = traceArtifact;
        } else {
          if (body.snapshot !== null && body.snapshot !== undefined) {
            throw new TypeError("snapshot não pode persistir sem consentimento de trace");
          }
          completeExp0026Block(session, body, pack, completionClock);
        }
        await persist();
      } else if (request.method === "POST" && url.pathname === "/api/exp-0026/top2") {
        const body = await readJson(request);
        sealExp0026Top2(session, body.selected, { now: options.now });
        await persist();
      } else if (request.method === "POST" && url.pathname === "/api/exp-0026/commercial") {
        const body = await readJson(request);
        completeExp0026Commercial(session, body.anchors, { now: options.now });
        await persist();
      } else if (request.method === "POST" && url.pathname === "/api/exp-0026/audio") {
        if (!session.consent?.audio) throw new TypeError("áudio não foi consentido");
        const bytes = await readBody(request, AUDIO_LIMIT_BYTES);
        if (bytes.length === 0) throw new TypeError("áudio vazio");
        const digest = sha256(bytes);
        if (session.audio !== null) {
          if (
            session.audio.bytes !== bytes.length ||
            session.audio.sha256 !== digest
          ) throw new TypeError("áudio divergente já foi persistido");
          sendJson(response, 200, publicExp0026Session(
            session,
            pack,
            runtimeSnapshot()
          ));
          return true;
        }
        const extension = request.headers["content-type"]?.includes("ogg")
          ? "ogg"
          : "webm";
        const path = resolve(sessionRoot, `microphone.${extension}`);
        await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
        session.audio = {
          path: `microphone.${extension}`,
          contentType: request.headers["content-type"] ?? "application/octet-stream",
          bytes: bytes.length,
          sha256: digest,
          fitEligibility: "evaluation-only"
        };
        await persist();
      } else if (request.method === "POST" && url.pathname === "/api/exp-0026/withdraw") {
        withdrawExp0026Session(session, { now: options.now });
        await rm(sessionRoot, { recursive: true, force: true });
        const tombstoneRoot = resolve(dataRoot, "withdrawn-tombstones");
        await mkdir(tombstoneRoot, { recursive: true, mode: 0o700 });
        await atomicJson(resolve(tombstoneRoot, `${session.sessionId}.json`), {
          schemaVersion: "exp-0026-withdrawal-tombstone-v1",
          sessionId: session.sessionId,
          participantHash: session.participantHash,
          processRunId: session.processRunId,
          fitEligibility: "none-withdrawn",
          withdrawnAt: session.withdrawnAt
        });
        sendJson(response, 200, publicExp0026Session(
          session,
          pack,
          runtimeSnapshot()
        ));
        return true;
      } else {
        sendJson(response, 404, { error: "exp0026_route_not_found" });
        return true;
      }

      sendJson(response, 200, publicExp0026Session(
        session,
        pack,
        runtimeSnapshot()
      ));
      return true;
    } catch (error) {
      sendJson(response, 422, {
        error: "exp0026_contract_violation",
        message: error.message
      });
      return true;
    }
  }

  return Object.freeze({
    handle,
    pack,
    session,
    sessionRoot,
    snapshot() {
      return structuredClone(session);
    }
  });
}
