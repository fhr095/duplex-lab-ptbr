import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { createExp0026SessionStore } from
  "../src/eval/exp-0026-session-store.mjs";

const sourcePack = JSON.parse(await readFile(new URL(
  "../eval/experiments/exp-0026-experience-pack.pt-BR.json",
  import.meta.url
), "utf8"));

function runtime() {
  return {
    processRunId: "process-store-test",
    runtimeFingerprint: { sha256: "a".repeat(64) },
    brain: "openai",
    interactionModel: "gpt-5.6-luna",
    taskModel: "gpt-5.6-luna",
    requests: 0,
    requestLimit: 25,
    activeKernelSessions: 0,
    asr: { state: "ready" },
    tts: { state: "ready" }
  };
}

async function fixture(t, alias) {
  const root = await mkdtemp(join(tmpdir(), "exp0026-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const noise = Buffer.from("deterministic-noise-fixture");
  const pack = structuredClone(sourcePack);
  pack.noise.artifactPath = "noise.wav";
  pack.noise.sha256 = createHash("sha256").update(noise).digest("hex");
  await writeFile(resolve(root, "noise.wav"), noise);
  await writeFile(resolve(root, "pack.json"), JSON.stringify(pack));
  const store = await createExp0026SessionStore({
    projectRoot: root,
    packPath: "pack.json",
    dataRoot: "private",
    role: "dry-run",
    participantAlias: alias,
    orderIndex: 0,
    processRunId: "process-store-test",
    accessToken: "a".repeat(64),
    idFactory: () => alias.toLowerCase(),
    runtimeSnapshot: runtime
  });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://test.local");
    await store.handle(request, response, url);
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const sessionId = store.session.sessionId;
  const request = async (path, options = {}) => fetch(`${origin}/api/exp-0026/${path}`, {
    method: options.method ?? "POST",
    headers: {
      "x-exp0026-session-id": sessionId,
      "x-exp0026-access-token": "a".repeat(64),
      ...(options.json === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers
    },
    body: options.json === undefined ? options.body : JSON.stringify(options.json)
  });
  return { root, store, request, sessionId, origin };
}

test("API privada exige token efêmero e binding da sessão", async (t) => {
  const fixtureValue = await fixture(t, "PRIVATE-API");
  const noToken = await fetch(`${fixtureValue.origin}/api/exp-0026/session`);
  assert.equal(noToken.status, 403);
  const wrongBinding = await fetch(
    `${fixtureValue.origin}/api/exp-0026/consent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-exp0026-session-id": "another-session",
        "x-exp0026-access-token": "a".repeat(64)
      },
      body: JSON.stringify({ participation: true })
    }
  );
  assert.equal(wrongBinding.status, 403);
  assert.equal(fixtureValue.store.snapshot().phase, "CONSENT");
});

test("store persiste trace consentido e recusa snapshot sem consentimento", async (t) => {
  const allowed = await fixture(t, "TRACE-YES");
  await allowed.request("consent", { json: {
    participation: true,
    trace: true,
    audio: false,
    commercial: false
  }});
  await allowed.request("preflight", { json: {
    deviceMatch: true,
    roomMatch: true,
    noiseProbe: true,
    recordingDefaultsOff: true
  }});
  await allowed.request("block/start", { json: { blockId: "S1" } });
  const result = await allowed.request("block", { json: {
    blockId: "S1",
    category: "NENHUM_PROBLEMA_MATERIAL",
    severity: 0,
    comment: null,
    snapshot: { trace: [{ type: "test", detail: "consented" }] }
  }});
  assert.equal(result.status, 200);
  const persisted = allowed.store.snapshot();
  assert.match(persisted.annotations[0].traceArtifact.path, /s1\.json$/u);
  const trace = JSON.parse(await readFile(resolve(
    allowed.store.sessionRoot,
    persisted.annotations[0].traceArtifact.path
  ), "utf8"));
  assert.equal(trace.fitEligibility, "evaluation-only");

  const denied = await fixture(t, "TRACE-NO");
  await denied.request("consent", { json: { participation: true, trace: false } });
  await denied.request("preflight", { json: {
    deviceMatch: true,
    roomMatch: true,
    noiseProbe: true,
    recordingDefaultsOff: true
  }});
  await denied.request("block/start", { json: { blockId: "S1" } });
  const refusal = await denied.request("block", { json: {
    blockId: "S1",
    category: "NENHUM_PROBLEMA_MATERIAL",
    severity: 0,
    snapshot: { trace: [] }
  }});
  assert.equal(refusal.status, 422);
  assert.equal(denied.store.snapshot().annotations.length, 0);
});

test("áudio só persiste com consentimento e retirada apaga a sessão", async (t) => {
  const allowed = await fixture(t, "AUDIO-YES");
  await allowed.request("consent", { json: {
    participation: true,
    audio: true,
    trace: false
  }});
  const bytes = Buffer.from("fake-webm-audio");
  const audio = await allowed.request("audio", {
    body: bytes,
    headers: { "content-type": "audio/webm" }
  });
  assert.equal(audio.status, 200);
  assert.equal(allowed.store.snapshot().audio.bytes, bytes.length);
  assert.deepEqual(
    await readFile(resolve(allowed.store.sessionRoot, "microphone.webm")),
    bytes
  );
  const idempotentRetry = await allowed.request("audio", {
    body: bytes,
    headers: { "content-type": "audio/webm" }
  });
  assert.equal(idempotentRetry.status, 200);
  const divergentRetry = await allowed.request("audio", {
    body: Buffer.from("different-audio"),
    headers: { "content-type": "audio/webm" }
  });
  assert.equal(divergentRetry.status, 422);
  const withdrawn = await allowed.request("withdraw", { json: {} });
  assert.equal(withdrawn.status, 200);
  assert.equal(allowed.store.snapshot().phase, "WITHDRAWN");
  await assert.rejects(
    readFile(resolve(allowed.store.sessionRoot, "session.private.json")),
    /ENOENT/u
  );
  const tombstone = JSON.parse(await readFile(resolve(
    allowed.root,
    "private/withdrawn-tombstones",
    `${allowed.sessionId}.json`
  ), "utf8"));
  assert.equal(tombstone.fitEligibility, "none-withdrawn");
  assert.equal("participantAlias" in tombstone, false);

  const denied = await fixture(t, "AUDIO-NO");
  await denied.request("consent", { json: {
    participation: true,
    audio: false
  }});
  const refusal = await denied.request("audio", {
    body: bytes,
    headers: { "content-type": "audio/webm" }
  });
  assert.equal(refusal.status, 422);
  assert.equal(denied.store.snapshot().audio, null);
});
