import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  finalizeTimingCalibrationPack
} from "../src/eval/calibration/blind-session.mjs";
import {
  createTimingCalibrationServer
} from "../src/eval/calibration/server.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("servidor entrega sessão cega, áudio íntegro e persiste sem PII", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "duplex-calibration-test-"));
  const webRoot = resolve(root, "web");
  const annotationsRoot = resolve(root, "annotations");
  const audioRoot = resolve(root, "audio");
  await Promise.all([
    mkdir(webRoot, { recursive: true }),
    mkdir(annotationsRoot, { recursive: true }),
    mkdir(audioRoot, { recursive: true })
  ]);
  await Promise.all([
    writeFile(resolve(webRoot, "index.html"), "<h1>calibration</h1>"),
    writeFile(resolve(webRoot, "app.mjs"), "export {};"),
    writeFile(resolve(webRoot, "styles.css"), "body{}")
  ]);
  const actions = [
    "WAIT_FOR_EVIDENCE",
    "PAUSE_OUTPUT",
    "CONTINUE_OUTPUT"
  ];
  const artifacts = {};
  for (const [index, action] of actions.entries()) {
    const bytes = Buffer.from(`RIFF-fixture-${action}`);
    const path = `audio/${index}.wav`;
    await writeFile(resolve(root, path), bytes);
    artifacts[action] = {
      path,
      sha256: `sha256:${sha256(bytes)}`,
      durationMs: 1_000,
      channels: 2
    };
  }
  const pack = finalizeTimingCalibrationPack({
    schemaVersion: "timing-calibration-pack-v1",
    packId: "server-pack-v1",
    locale: "pt-BR",
    actions,
    protocol: {
      minimumCompletedPlaybacksPerOption: 1,
      allowedReasonTags: [],
      minimumParticipants: 3,
      minimumVotesPerScene: 3,
      minimumConsensusShare: 2 / 3,
      minimumLabelCoverage: 1,
      minimumAttentionPassRate: 0.8,
      unitOfAnalysis: "participant",
      identityPolicy:
        "pseudonymous-local-token-hashed-before-persistence"
    },
    scenes: [{
      sceneId: "semantic-name-must-stay-private",
      family: "fixture",
      fitEligibility: "development-synthetic",
      artifacts,
      attentionControl: null
    }],
    retention: {
      audioInGit: false,
      annotationsContainRawAudio: false
    },
    buildGate: { pass: true }
  });
  let sequence = 0;
  const calibration = await createTimingCalibrationServer({
    pack,
    projectRoot: root,
    webRoot,
    annotationsRoot,
    idFactory: () => `fixed-${sequence++}`,
    clock: () => 1_234
  });
  const address = await calibration.listen();
  t.after(() => calibration.close());
  const origin = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${origin}/api/health`).then((response) =>
    response.json()
  );
  assert.equal(health.ok, true);
  assert.equal(health.paidApiCalls, 0);

  const malformed = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{"
  });
  assert.equal(malformed.status, 400);

  const participantToken = "participant-secret-local";
  const sessionResponse = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantToken })
  });
  assert.equal(sessionResponse.status, 201);
  const session = await sessionResponse.json();
  const serialized = JSON.stringify(session);
  assert.equal(serialized.includes("PAUSE_OUTPUT"), false);
  assert.equal(serialized.includes("semantic-name"), false);
  assert.equal(serialized.includes(participantToken), false);

  const option = session.scenes[0].options[0];
  const audioResponse = await fetch(`${origin}${option.audioUrl}`, {
    headers: { range: "bytes=0-3" }
  });
  assert.equal(audioResponse.status, 206);
  assert.equal(Buffer.from(await audioResponse.arrayBuffer()).toString(), "RIFF");

  const concurrentSessionResponse = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantToken })
  });
  assert.equal(concurrentSessionResponse.status, 201);
  const concurrentSession = await concurrentSessionResponse.json();
  const submissionFor = (candidate) => ({
    schemaVersion: "timing-calibration-submission-v1",
    sessionId: candidate.sessionId,
    packSha256: candidate.packSha256,
    responses: candidate.scenes.map((scene) => ({
      sceneId: scene.sceneId,
      selectedOptionId: null,
      uncertain: true,
      confidence: 2,
      reasonTags: [],
      playbacks: scene.options.map((entry) => ({
        optionId: entry.optionId,
        completed: 1
      }))
    }))
  });
  const responses = await Promise.all([session, concurrentSession].map(
    (candidate) => fetch(`${origin}/api/annotations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submissionFor(candidate))
    })
  ));
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [201, 409]
  );
  const acceptedResponse = responses.find((response) => response.status === 201);
  const accepted = await acceptedResponse.json();
  const stored = JSON.parse(await readFile(
    resolve(annotationsRoot, `${accepted.annotationId}.json`),
    "utf8"
  ));
  assert.equal(JSON.stringify(stored).includes(participantToken), false);
  assert.match(stored.participantHash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(stored.submittedAtEpochMs, 1_234);

  const duplicateResponse = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantToken })
  });
  assert.equal(duplicateResponse.status, 409);

  stored.responses[0].confidence = 1;
  await writeFile(
    resolve(annotationsRoot, `${accepted.annotationId}.json`),
    `${JSON.stringify(stored, null, 2)}\n`
  );
  await assert.rejects(
    createTimingCalibrationServer({
      pack,
      projectRoot: root,
      webRoot,
      annotationsRoot
    }),
    /anotação persistida inválida/u
  );
});
