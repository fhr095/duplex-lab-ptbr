import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

import {
  createBlindCalibrationSession,
  validateTimingCalibrationRecord,
  validateTimingCalibrationPack,
  validateTimingCalibrationSubmission
} from "./blind-session.mjs";

const STATIC_FILES = Object.freeze(new Map([
  ["/", "index.html"],
  ["/app.mjs", "app.mjs"],
  ["/styles.css", "styles.css"]
]));

const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8"
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) {
      throw new RangeError("corpo excede 128 KiB");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function securityHeaders(contentType) {
  return {
    "cache-control": "no-store",
    "content-type": contentType,
    "content-security-policy":
      "default-src 'self'; media-src 'self'; script-src 'self'; " +
      "style-src 'self'; connect-src 'self'; img-src 'self' data:",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
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

function sendBytes(request, response, bytes, contentType) {
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/u.exec(range);
    if (!match) {
      response.writeHead(416, { "content-range": `bytes */${bytes.length}` });
      response.end();
      return;
    }
    const start = Number(match[1]);
    const end = match[2] === ""
      ? bytes.length - 1
      : Math.min(Number(match[2]), bytes.length - 1);
    if (start > end || start >= bytes.length) {
      response.writeHead(416, { "content-range": `bytes */${bytes.length}` });
      response.end();
      return;
    }
    const part = bytes.subarray(start, end + 1);
    response.writeHead(206, {
      ...securityHeaders(contentType),
      "accept-ranges": "bytes",
      "content-length": part.length,
      "content-range": `bytes ${start}-${end}/${bytes.length}`
    });
    response.end(part);
    return;
  }
  response.writeHead(200, {
    ...securityHeaders(contentType),
    "accept-ranges": "bytes",
    "content-length": bytes.length
  });
  response.end(bytes);
}

async function loadExistingParticipants(annotationsRoot, pack) {
  await mkdir(annotationsRoot, { recursive: true });
  const participants = new Map();
  for (const entry of await readdir(annotationsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const record = JSON.parse(await readFile(
      resolve(annotationsRoot, entry.name),
      "utf8"
    ));
    if (record.packSha256 === pack.packSha256) {
      const validation = validateTimingCalibrationRecord(pack, record);
      if (!validation.valid) {
        throw new Error(
          `anotação persistida inválida (${entry.name}): ` +
            validation.errors.join("; ")
        );
      }
      if (entry.name !== `${record.annotationId}.json`) {
        throw new Error(`arquivo de anotação divergente: ${entry.name}`);
      }
      if (participants.has(record.participantHash)) {
        throw new Error("anotações persistidas duplicam participante");
      }
      participants.set(record.participantHash, record.participantRole);
    }
  }
  return participants;
}

async function loadArtifactBytes(pack, projectRoot) {
  const artifacts = new Map();
  for (const scene of pack.scenes) {
    for (const artifact of Object.values(scene.artifacts)) {
      if (artifacts.has(artifact.path)) {
        continue;
      }
      const path = resolve(projectRoot, artifact.path);
      const relativePath = relative(projectRoot, path);
      if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
        throw new Error(`áudio escapa do projeto: ${artifact.path}`);
      }
      const bytes = await readFile(path);
      if (`sha256:${sha256(bytes)}` !== artifact.sha256) {
        throw new Error(`áudio diverge do pack: ${artifact.path}`);
      }
      artifacts.set(artifact.path, bytes);
    }
  }
  return artifacts;
}

export async function createTimingCalibrationServer(options = {}) {
  const pack = structuredClone(options.pack);
  const validation = validateTimingCalibrationPack(pack);
  if (!validation.valid || pack.buildGate?.pass !== true) {
    throw new TypeError(`pack inválido: ${validation.errors.join("; ")}`);
  }
  const projectRoot = resolve(options.projectRoot);
  const webRoot = resolve(options.webRoot);
  const annotationsRoot = resolve(options.annotationsRoot);
  const idFactory = options.idFactory ?? randomUUID;
  const clock = options.clock ?? Date.now;
  const [artifactBytes, existingParticipants, staticBytes] = await Promise.all([
    loadArtifactBytes(pack, projectRoot),
    loadExistingParticipants(annotationsRoot, pack),
    Promise.all([...STATIC_FILES.entries()].map(async ([route, file]) => [
      route,
      {
        file,
        bytes: await readFile(resolve(webRoot, file))
      }
    ])).then((entries) => new Map(entries))
  ]);
  const sessions = new Map();
  const pendingParticipants = new Set();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://calibration.local");
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, {
          ok: true,
          schemaVersion: "timing-calibration-server-v2",
          packId: pack.packId,
          packSha256: pack.packSha256,
          scenes: pack.scenes.length,
          participants: existingParticipants.size,
          externalParticipants: [...existingParticipants.values()].filter(
            (role) => role === "external"
          ).length,
          internalParticipants: [...existingParticipants.values()].filter(
            (role) => role === "internal"
          ).length,
          paidApiCalls: 0
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/session") {
        const body = await readJsonBody(request);
        const session = createBlindCalibrationSession(pack, {
          sessionId: `session-${idFactory()}`,
          participantToken: body.participantToken,
          participantRole: body.participantRole
        });
        if (
          existingParticipants.has(session.internalSession.participantHash) ||
          pendingParticipants.has(session.internalSession.participantHash)
        ) {
          sendJson(response, 409, {
            error: "este participante já concluiu o pack corrente"
          });
          return;
        }
        sessions.set(
          session.internalSession.sessionId,
          session.internalSession
        );
        sendJson(response, 201, session.publicSession);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/annotations") {
        const body = await readJsonBody(request);
        const internalSession = sessions.get(body.sessionId);
        if (!internalSession) {
          sendJson(response, 404, { error: "sessão desconhecida ou expirada" });
          return;
        }
        const result = validateTimingCalibrationSubmission(
          pack,
          internalSession,
          body
        );
        if (!result.valid) {
          sendJson(response, 422, { error: result.errors });
          return;
        }
        if (
          existingParticipants.has(result.record.participantHash) ||
          pendingParticipants.has(result.record.participantHash)
        ) {
          sessions.delete(body.sessionId);
          sendJson(response, 409, {
            error: "este participante já concluiu o pack corrente"
          });
          return;
        }
        pendingParticipants.add(result.record.participantHash);
        try {
          const persisted = {
            ...result.record,
            submittedAtEpochMs: clock()
          };
          const path = resolve(
            annotationsRoot,
            `${persisted.annotationId}.json`
          );
          await writeFile(
            path,
            `${JSON.stringify(persisted, null, 2)}\n`,
            { flag: "wx" }
          );
          existingParticipants.set(
            persisted.participantHash,
            persisted.participantRole
          );
          sessions.delete(body.sessionId);
          sendJson(response, 201, {
            accepted: true,
            annotationId: persisted.annotationId,
            participants: existingParticipants.size,
            externalParticipants: [...existingParticipants.values()].filter(
              (role) => role === "external"
            ).length
          });
        } finally {
          pendingParticipants.delete(result.record.participantHash);
        }
        return;
      }
      const audioMatch = request.method === "GET"
        ? /^\/api\/audio\/([^/]+)\/([^/]+)\/([^/]+)$/u.exec(url.pathname)
        : null;
      if (audioMatch) {
        const [, encodedSession, encodedScene, encodedOption] = audioMatch;
        const sessionId = decodeURIComponent(encodedSession);
        const sceneId = decodeURIComponent(encodedScene);
        const optionId = decodeURIComponent(encodedOption);
        const internalSession = sessions.get(sessionId);
        const assignment = internalSession?.assignments.find(
          (entry) => entry.publicSceneId === sceneId
        );
        const option = assignment?.options.find(
          (entry) => entry.optionId === optionId
        );
        const bytes = option ? artifactBytes.get(option.artifact.path) : null;
        if (!bytes) {
          sendJson(response, 404, { error: "áudio não encontrado" });
          return;
        }
        sendBytes(request, response, bytes, "audio/wav");
        return;
      }
      if (request.method === "GET" && STATIC_FILES.has(url.pathname)) {
        const asset = staticBytes.get(url.pathname);
        sendBytes(
          request,
          response,
          asset.bytes,
          CONTENT_TYPES[extname(asset.file)] ?? "application/octet-stream"
        );
        return;
      }
      sendJson(response, 404, { error: "rota não encontrada" });
    } catch (error) {
      const status =
        error instanceof SyntaxError ||
        error instanceof TypeError ||
        error instanceof RangeError
        ? 400
        : 500;
      if (status === 500) {
        console.error(`Erro interno na calibração: ${error.message}`);
      }
      sendJson(response, status, {
        error: status === 500
          ? "erro interno no instrumento de calibração"
          : error.message
      });
    }
  });
  return Object.freeze({
    pack: Object.freeze(pack),
    server,
    get snapshot() {
      return Object.freeze({
        sessions: sessions.size,
        pendingParticipants: pendingParticipants.size,
        participants: existingParticipants.size,
        externalParticipants: [...existingParticipants.values()].filter(
          (role) => role === "external"
        ).length,
        internalParticipants: [...existingParticipants.values()].filter(
          (role) => role === "internal"
        ).length,
        artifacts: artifactBytes.size
      });
    },
    listen({ port = 0, host = "127.0.0.1" } = {}) {
      return new Promise((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(port, host, () => {
          server.off("error", rejectListen);
          resolveListen(server.address());
        });
      });
    },
    close() {
      return new Promise((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
  });
}
