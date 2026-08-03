import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  EXP0024_JOURNAL_FORBIDDEN_KEYS,
  EXP0024_JOURNAL_FRAME_TYPES,
  EXP0024_JOURNAL_INSPECTION_STATES,
  EXP0024_JOURNAL_NONCE,
  EXP0024_JOURNAL_PAYLOAD_KEYS,
  EXP0024_JOURNAL_SCHEMA,
  createExp0024JournalFrame,
  inspectExp0024Journal,
  serializeExp0024Journal,
  serializeExp0024JournalFrame,
  validateExp0024JournalFrame
} from "../src/eval/exp-0024-journal.mjs";

const NOW = "2026-08-03T12:00:00.000Z";
const LATER = "2026-08-03T12:00:01.000Z";
const HASH = `sha256:${"a".repeat(64)}`;
const COMMIT = "b".repeat(40);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function payload(type) {
  switch (type) {
    case EXP0024_JOURNAL_FRAME_TYPES.inProgress:
      return {
        deadlineMs: 600_000,
        opening: {
          canonicalSha256: HASH,
          commit: COMMIT,
          fileSha256: HASH,
          path: "eval/commitments/exp-0024-attempt-v0.1.json"
        },
        pid: 123,
        startedAt: NOW
      };
    case EXP0024_JOURNAL_FRAME_TYPES.workerStarted:
      return { command: "node worker.mjs", pid: 124, startedAt: NOW };
    case EXP0024_JOURNAL_FRAME_TYPES.healthBefore:
    case EXP0024_JOURNAL_FRAME_TYPES.healthAfter:
      return {
        health: {
          brain: "local",
          process: { runtimeFingerprint: { sha256: "c".repeat(64) } }
        },
        observedAt: NOW
      };
    case EXP0024_JOURNAL_FRAME_TYPES.browserBound:
      return {
        browser: { product: "Chrome/150", protocolVersion: "1.3" },
        observedAt: NOW
      };
    case EXP0024_JOURNAL_FRAME_TYPES.navigationStarted:
      return {
        navigationIndex: 1,
        startedAt: NOW,
        targetUrl: "http://localhost:4173/?automation=1&experiment=0024"
      };
    case EXP0024_JOURNAL_FRAME_TYPES.navigationAudited:
      return {
        auditRequestId: "audit-1",
        bootstrapRequestId: "bootstrap-1",
        frameId: "frame-1",
        health: { brain: "local" },
        loaderId: "loader-1",
        navigationIndex: 1,
        observedAt: NOW,
        probeId: "nav-1"
      };
    case EXP0024_JOURNAL_FRAME_TYPES.networkRequest:
      return {
        auditProbeHeader: null,
        frameId: "frame-1",
        loaderId: "loader-1",
        method: "POST",
        navigationIndex: 1,
        postData: {
          text: "Esta fala contínua mede uma única parada física do assistente."
        },
        redirected: false,
        requestId: "request-1",
        requestOrdinal: 1,
        resourceType: "Fetch",
        timestamp: 1.1,
        trialId: "trial-1",
        url: "http://localhost:4173/api/tts"
      };
    case EXP0024_JOURNAL_FRAME_TYPES.networkResponse:
      return {
        frameId: "frame-1",
        fromDiskCache: false,
        fromServiceWorker: false,
        loaderId: "loader-1",
        mimeType: "audio/wav",
        navigationIndex: 1,
        requestId: "request-1",
        responseOrdinal: 2,
        status: 200,
        timestamp: 1.2,
        trialId: "trial-1",
        url: "http://localhost:4173/api/tts"
      };
    case EXP0024_JOURNAL_FRAME_TYPES.networkTerminal:
      return {
        encodedDataLength: 237_232,
        navigationIndex: 1,
        requestId: "request-1",
        terminalOrdinal: 3,
        timestamp: 1.3,
        trialId: "trial-1"
      };
    case EXP0024_JOURNAL_FRAME_TYPES.networkFailure:
      return {
        blockedReason: null,
        canceled: false,
        errorText: "net::ERR_ABORTED",
        navigationIndex: 1,
        requestId: "request-failed",
        terminalOrdinal: 6,
        timestamp: 1.4,
        trialId: null
      };
    case EXP0024_JOURNAL_FRAME_TYPES.diagnostic:
      return {
        category: "console",
        code: "CONSOLE_INFO",
        message: "diagnóstico local",
        navigationIndex: 1,
        observedAt: NOW,
        trialId: "trial-1"
      };
    case EXP0024_JOURNAL_FRAME_TYPES.physicalTrialCompleted:
      return {
        completedAt: LATER,
        navigationIndex: 1,
        requestId: "request-1",
        trial: {
          finalSnapshot: { state: { assistantSpeaking: false } },
          timing: { postLatestMarkerHorizonMs: 250 }
        },
        trialId: "trial-1",
        trialIndex: 1,
        turnId: "turn-1"
      };
    case EXP0024_JOURNAL_FRAME_TYPES.captureCompleted:
      return {
        accumulatedWaitMs: 8,
        byteLength: 237_232,
        code: null,
        completedAt: LATER,
        navigationIndex: 1,
        readCount: 2,
        requestId: "request-1",
        sha256: HASH,
        status: "qualified",
        trialId: "trial-1",
        trialIndex: 1,
        turnId: "turn-1"
      };
    case EXP0024_JOURNAL_FRAME_TYPES.navigationCompleted:
      return { completedAt: LATER, navigationIndex: 1 };
    case EXP0024_JOURNAL_FRAME_TYPES.budgetInputs:
      return {
        inputs: { challengerRuns: 0, externalRequests: 0, gpuRuns: 0 },
        observedAt: LATER
      };
    case EXP0024_JOURNAL_FRAME_TYPES.workerOutcome:
      return {
        code: null,
        completedAt: LATER,
        exitCode: 0,
        outcome: {
          kind: "campaign-completed",
          protocolError: null,
          recordCount: 0,
          stderrByteLength: 0,
          stderrSha256:
            "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          stderrTruncated: false
        },
        signal: null,
        status: "completed"
      };
    default:
      throw new Error(`fixture ausente para ${type}`);
  }
}

function frame(type, ordinal) {
  return createExp0024JournalFrame({
    ordinal,
    type,
    payload: payload(type)
  });
}

function allFrames() {
  return Object.values(EXP0024_JOURNAL_FRAME_TYPES)
    .map((type, index) => frame(type, index + 1));
}

test("expõe schemas fechados para todos os fatos autoritativos", () => {
  assert.equal(EXP0024_JOURNAL_SCHEMA, "exp-0024-journal-frame-v1");
  assert.equal(EXP0024_JOURNAL_NONCE, "exp-0024-official-v0.1");
  assert.deepEqual(Object.values(EXP0024_JOURNAL_FRAME_TYPES), [
    "IN_PROGRESS",
    "WORKER_STARTED",
    "HEALTH_BEFORE",
    "BROWSER_BOUND",
    "NAVIGATION_STARTED",
    "NAVIGATION_AUDITED",
    "NETWORK_REQUEST",
    "NETWORK_RESPONSE",
    "NETWORK_TERMINAL",
    "NETWORK_FAILURE",
    "DIAGNOSTIC",
    "PHYSICAL_TRIAL_COMPLETED",
    "CAPTURE_COMPLETED",
    "NAVIGATION_COMPLETED",
    "HEALTH_AFTER",
    "BUDGET_INPUTS",
    "WORKER_OUTCOME"
  ]);
  assert.deepEqual(
    Object.keys(EXP0024_JOURNAL_PAYLOAD_KEYS).toSorted(),
    Object.values(EXP0024_JOURNAL_FRAME_TYPES).toSorted()
  );
  for (const key of [
    "body",
    "bodyBase64",
    "bytes",
    "buffer",
    "Buffer",
    "Uint8Array",
    "base64"
  ]) assert.ok(EXP0024_JOURNAL_FORBIDDEN_KEYS.includes(key));
});

test("cria e valida cada frame com nonce, ordinal e payload exatos", () => {
  for (const candidate of allFrames()) {
    assert.equal(candidate.schemaVersion, EXP0024_JOURNAL_SCHEMA);
    assert.equal(candidate.nonce, EXP0024_JOURNAL_NONCE);
    assert.equal(
      validateExp0024JournalFrame(candidate, {
        expectedOrdinal: candidate.ordinal
      }).valid,
      true
    );
    assert.equal(Object.isFrozen(candidate), true);
    assert.deepEqual(
      Object.keys(candidate.payload).toSorted(),
      [...EXP0024_JOURNAL_PAYLOAD_KEYS[candidate.type]].toSorted()
    );
  }
});

test("serializa NDJSON canônico e reconstrói apenas frames completos", () => {
  const frames = allFrames();
  const serialized = serializeExp0024Journal(frames);
  assert.equal(serialized.endsWith("\n"), true);
  assert.equal(serialized.split("\n").length, frames.length + 1);
  assert.doesNotMatch(serialized, /bodyBase64|Uint8Array|SECRET_WAV/u);

  const inspected = inspectExp0024Journal(Buffer.from(serialized));
  assert.equal(inspected.status, EXP0024_JOURNAL_INSPECTION_STATES.valid);
  assert.equal(inspected.valid, true);
  assert.equal(inspected.completeFrameCount, frames.length);
  assert.equal(inspected.nextOrdinal, frames.length + 1);
  assert.deepEqual(inspected.frames, frames);
  assert.equal(inspected.sha256, sha256(Buffer.from(serialized)));
  assert.equal(inspected.byteLength, Buffer.byteLength(serialized));
  assert.equal(inspected.tailByteLength, 0);
  assert.equal(inspected.tailSha256, sha256(Buffer.alloc(0)));
});

test("EMPTY e prefixo IN_PROGRESS completo são estados distintos", () => {
  const empty = inspectExp0024Journal(Buffer.alloc(0));
  assert.equal(empty.status, EXP0024_JOURNAL_INSPECTION_STATES.empty);
  assert.equal(empty.valid, false);
  assert.deepEqual(empty.frames, []);
  assert.equal(empty.sha256, sha256(Buffer.alloc(0)));

  const onlyOpening = serializeExp0024Journal([frame(
    EXP0024_JOURNAL_FRAME_TYPES.inProgress,
    1
  )]);
  const validPrefix = inspectExp0024Journal(Buffer.from(onlyOpening));
  assert.equal(validPrefix.status, EXP0024_JOURNAL_INSPECTION_STATES.valid);
  assert.equal(validPrefix.completeFrameCount, 1);
});

test("TRUNCATED_TAIL preserva prefixo e hashes sem interpretar a tail", () => {
  const first = serializeExp0024Journal([frame(
    EXP0024_JOURNAL_FRAME_TYPES.inProgress,
    1
  )]);
  const tail = Buffer.from('{"nonce":"exp-0024');
  const bytes = Buffer.concat([Buffer.from(first), tail]);
  const inspected = inspectExp0024Journal(bytes);
  assert.equal(
    inspected.status,
    EXP0024_JOURNAL_INSPECTION_STATES.truncatedTail
  );
  assert.equal(inspected.valid, false);
  assert.equal(inspected.completeFrameCount, 1);
  assert.equal(inspected.tailByteLength, tail.byteLength);
  assert.equal(inspected.tailSha256, sha256(tail));
  assert.equal(inspected.sha256, sha256(bytes));

  const tailOnly = inspectExp0024Journal(new Uint8Array([0xff, 0xfe, 0x7b]));
  assert.equal(
    tailOnly.status,
    EXP0024_JOURNAL_INSPECTION_STATES.truncatedTail
  );
  assert.equal(tailOnly.completeFrameCount, 0);
  assert.equal(tailOnly.tailByteLength, 3);
});

test("frame completo malformado nunca vira tail recuperável", () => {
  for (const bytes of [
    Buffer.from("{}\n"),
    Buffer.from("not-json\n"),
    Buffer.from("\n"),
    Buffer.from([0xff, 0x0a])
  ]) {
    const inspected = inspectExp0024Journal(bytes);
    assert.equal(
      inspected.status,
      EXP0024_JOURNAL_INSPECTION_STATES.invalidCompleteFrame
    );
    assert.equal(inspected.valid, false);
  }

  const opening = serializeExp0024Journal([frame(
    EXP0024_JOURNAL_FRAME_TYPES.inProgress,
    1
  )]);
  const tail = Buffer.from('{"partial":');
  const mixed = Buffer.concat([
    Buffer.from(opening),
    Buffer.from("{}\nignored-complete-line\n"),
    tail
  ]);
  const invalidWithTail = inspectExp0024Journal(mixed);
  assert.equal(
    invalidWithTail.status,
    EXP0024_JOURNAL_INSPECTION_STATES.invalidCompleteFrame
  );
  assert.equal(invalidWithTail.completeFrameCount, 1);
  assert.equal(invalidWithTail.tailByteLength, tail.byteLength);
  assert.equal(invalidWithTail.tailSha256, sha256(tail));
});

test("rejeita nonce, gap ordinal, primeiro tipo e outcome não terminal", () => {
  const opening = frame(EXP0024_JOURNAL_FRAME_TYPES.inProgress, 1);
  const worker = frame(EXP0024_JOURNAL_FRAME_TYPES.workerStarted, 2);
  const outcome = frame(EXP0024_JOURNAL_FRAME_TYPES.workerOutcome, 3);

  const wrongNonce = { ...opening, nonce: "outro" };
  assert.equal(validateExp0024JournalFrame(wrongNonce).valid, false);
  assert.equal(validateExp0024JournalFrame(wrongNonce, {
    nonce: "outro"
  }).valid, false);
  assert.throws(() => serializeExp0024JournalFrame(wrongNonce), /nonce/u);

  assert.throws(
    () => serializeExp0024Journal([
      opening,
      { ...worker, ordinal: 3 }
    ]),
    /ordinal/u
  );
  const workerFirst = frame(EXP0024_JOURNAL_FRAME_TYPES.workerStarted, 1);
  assert.throws(() => serializeExp0024Journal([workerFirst]), /IN_PROGRESS/u);
  assert.throws(
    () => serializeExp0024Journal([opening, worker, outcome,
      frame(EXP0024_JOURNAL_FRAME_TYPES.healthAfter, 4)]),
    /WORKER_OUTCOME/u
  );
});

test("rejeita recursivamente bytes, base64 e nomes de chave proibidos", () => {
  const forbiddenValues = [
    { body: "RIFF" },
    { nested: { bodyBase64: "UklGRg==" } },
    { nested: { Buffer: [1, 2] } },
    { nested: { Uint8Array: [1, 2] } },
    { nested: { bytes: [1, 2] } },
    { nested: { payload: Buffer.from("RIFF") } },
    { nested: { payload: new Uint8Array([1, 2, 3]) } },
    { nested: { payload: "A".repeat(128) } },
    { nested: { payload: Array.from({ length: 45 }, (_, index) => index) } }
  ];
  for (const trial of forbiddenValues) {
    const physicalPayload = payload(
      EXP0024_JOURNAL_FRAME_TYPES.physicalTrialCompleted
    );
    physicalPayload.trial = trial;
    assert.throws(() => createExp0024JournalFrame({
      ordinal: 1,
      type: EXP0024_JOURNAL_FRAME_TYPES.physicalTrialCompleted,
      payload: physicalPayload
    }), /proibida|bytes|base64/u);
  }
});

test("rejeita chaves extras em todos os payloads tipados", () => {
  for (const [index, type] of
    Object.values(EXP0024_JOURNAL_FRAME_TYPES).entries()) {
    const candidate = payload(type);
    candidate.extra = true;
    assert.throws(() => createExp0024JournalFrame({
      ordinal: index + 1,
      type,
      payload: candidate
    }), /chaves divergentes/u);
  }
});

test("ledger aceita URL blob bruta sem aplicar política de origem", () => {
  const request = payload(EXP0024_JOURNAL_FRAME_TYPES.networkRequest);
  request.method = "GET";
  request.postData = null;
  request.resourceType = "Media";
  request.url = "blob:http://localhost:4173/6e93026e-a3cc-4baf-b975-f8ae125c8242";
  assert.doesNotThrow(() => createExp0024JournalFrame({
    ordinal: 1,
    type: EXP0024_JOURNAL_FRAME_TYPES.networkRequest,
    payload: request
  }));
});

test("capture-completed é limitado e nunca carrega corpo", () => {
  const valid = frame(EXP0024_JOURNAL_FRAME_TYPES.captureCompleted, 1);
  assert.equal(validateExp0024JournalFrame(valid).valid, true);

  for (const mutation of [
    { readCount: 5 },
    { accumulatedWaitMs: 97 },
    { byteLength: 44 },
    { sha256: null },
    { code: "UNEXPECTED" }
  ]) {
    const changed = {
      ...valid,
      payload: { ...valid.payload, ...mutation }
    };
    assert.equal(validateExp0024JournalFrame(changed).valid, false);
  }

  const failed = createExp0024JournalFrame({
    ordinal: 1,
    type: EXP0024_JOURNAL_FRAME_TYPES.captureCompleted,
    payload: {
      ...payload(EXP0024_JOURNAL_FRAME_TYPES.captureCompleted),
      accumulatedWaitMs: 96,
      byteLength: null,
      code: "EMPTY_BODY",
      readCount: 4,
      requestId: null,
      sha256: null,
      status: "failed"
    }
  });
  assert.equal(validateExp0024JournalFrame(failed).valid, true);

  const physicalWithoutBinding = createExp0024JournalFrame({
    ordinal: 1,
    type: EXP0024_JOURNAL_FRAME_TYPES.physicalTrialCompleted,
    payload: {
      ...payload(EXP0024_JOURNAL_FRAME_TYPES.physicalTrialCompleted),
      requestId: null
    }
  });
  assert.equal(
    validateExp0024JournalFrame(physicalWithoutBinding).valid,
    true
  );

  const qualifiedWithoutBinding = {
    ...valid,
    payload: { ...valid.payload, requestId: null }
  };
  assert.equal(
    validateExp0024JournalFrame(qualifiedWithoutBinding).valid,
    false
  );
});

test("worker outcome fecha schema de processo e stderr", () => {
  const valid = frame(EXP0024_JOURNAL_FRAME_TYPES.workerOutcome, 1);
  assert.equal(validateExp0024JournalFrame(valid).valid, true);
  for (const outcome of [
    { ...valid.payload.outcome, stderrSha256: "inválido" },
    { ...valid.payload.outcome, recordCount: -1 },
    { ...valid.payload.outcome, stderrTruncated: null },
    { kind: "campaign-completed" },
    { ...valid.payload.outcome, extra: true }
  ]) {
    assert.equal(validateExp0024JournalFrame({
      ...valid,
      payload: { ...valid.payload, outcome }
    }).valid, false);
  }
});

test("JSON completo não canônico, duplicado ou CRLF é inválido", () => {
  const opening = frame(EXP0024_JOURNAL_FRAME_TYPES.inProgress, 1);
  const reordered = {
    schemaVersion: opening.schemaVersion,
    nonce: opening.nonce,
    ordinal: opening.ordinal,
    type: opening.type,
    payload: opening.payload
  };
  const pretty = Buffer.from(`${JSON.stringify(reordered)}\n`);
  assert.equal(
    inspectExp0024Journal(pretty).status,
    EXP0024_JOURNAL_INSPECTION_STATES.invalidCompleteFrame
  );
  const canonical = serializeExp0024Journal([opening]);
  const crlf = Buffer.from(canonical.replace(/\n$/u, "\r\n"));
  assert.equal(
    inspectExp0024Journal(crlf).status,
    EXP0024_JOURNAL_INSPECTION_STATES.invalidCompleteFrame
  );
  const duplicate = Buffer.from(
    canonical.replace('{"nonce":', '{"nonce":"duplicado","nonce":')
  );
  assert.equal(
    inspectExp0024Journal(duplicate).status,
    EXP0024_JOURNAL_INSPECTION_STATES.invalidCompleteFrame
  );
});

test("validação é fail-closed para ciclos e tipos não JSON", () => {
  const cycle = payload(EXP0024_JOURNAL_FRAME_TYPES.budgetInputs);
  cycle.inputs.self = cycle.inputs;
  const candidate = {
    schemaVersion: EXP0024_JOURNAL_SCHEMA,
    nonce: EXP0024_JOURNAL_NONCE,
    ordinal: 1,
    type: EXP0024_JOURNAL_FRAME_TYPES.budgetInputs,
    payload: cycle
  };
  const validation = validateExp0024JournalFrame(candidate);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /circular/u);
  assert.throws(() => inspectExp0024Journal("not-bytes"), /Buffer|Uint8Array/u);
});
