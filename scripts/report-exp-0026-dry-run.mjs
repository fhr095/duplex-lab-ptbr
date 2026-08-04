import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const sessionsRoot = resolve(
  projectRoot,
  process.env.EXP0026_DRY_RUN_DATA_ROOT ??
    "eval/generated/exp-0026/dry-run/sessions"
);
const reportPath = resolve(
  projectRoot,
  process.env.EXP0026_DRY_RUN_REPORT ??
    "eval/reports/exp-0026-instrument-dry-run-v0.1.json"
);
const lifecyclePath = resolve(
  projectRoot,
  "eval/reports/exp-0026-lifecycle-smoke-v0.1.json"
);

const directories = [];
for (const entry of await readdir(sessionsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const path = resolve(sessionsRoot, entry.name);
  directories.push({ path, modifiedMs: (await stat(path)).mtimeMs });
}
directories.sort((left, right) => right.modifiedMs - left.modifiedMs);
let selected = null;
for (const candidate of directories) {
  const session = JSON.parse(await readFile(
    resolve(candidate.path, "session.private.json"),
    "utf8"
  ));
  if (
    session.role === "dry-run" &&
    session.analysisEligibility === "excluded-dry-run" &&
    session.phase === "COMPLETE"
  ) {
    selected = { ...candidate, session };
    break;
  }
}
if (!selected) throw new Error("dry-run concluído não encontrado");

const traceRoot = resolve(selected.path, "technical-traces");
const traces = [];
for (const annotation of selected.session.annotations) {
  assert.ok(annotation.traceArtifact, `${annotation.blockId} não tem trace`);
  const path = resolve(selected.path, annotation.traceArtifact.path);
  const bytes = await readFile(path);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    annotation.traceArtifact.sha256,
    `hash de ${annotation.blockId} divergiu`
  );
  const artifact = JSON.parse(bytes);
  assert.equal(artifact.blockId, annotation.blockId);
  assert.equal(artifact.fitEligibility, "evaluation-only");
  traces.push(artifact);
}
assert.equal((await readdir(traceRoot)).filter((name) => name.endsWith(".json")).length, 7);

const events = traces.flatMap((trace) => trace.snapshot.trace);
const committedTurns = events.filter(
  (event) => event.type === "turn.committed"
).length;
const successfulProviderStarts = events.filter(
  (event) => event.type === "brain.started" && /gpt-5\.6-luna/iu.test(event.detail)
).length;
const lifecycle = JSON.parse(await readFile(lifecyclePath, "utf8"));
assert.equal(lifecycle.pass, true);
const runtime = selected.session.preflight.runtime;
const f0 = selected.session.annotations.find((item) => item.blockId === "F0");
const prior = selected.session.annotations.find((item) => item.blockId === "S6");
const adjacentF0WindowMs =
  new Date(f0.completedAt).valueOf() - new Date(prior.completedAt).valueOf();

const report = {
  schemaVersion: "exp-0026-instrument-dry-run-v1",
  experimentId: "EXP-0026",
  status: "PASS_EXCLUDED_DRY_RUN",
  analysisEligibility: "excluded-dry-run",
  fitEligibility: "evaluation-only",
  sessionId: selected.session.sessionId,
  startedAt: selected.session.createdAt,
  completedAt: selected.session.completedAt,
  runtimeAtPreflight: {
    processRunId: runtime.processRunId,
    runtimeFingerprint: runtime.runtimeFingerprint,
    provider: runtime.brain,
    interactionModel: runtime.interactionModel,
    taskModel: runtime.taskModel,
    requests: runtime.requests,
    requestLimit: runtime.requestLimit,
    activeKernelSessions: runtime.activeKernelSessions,
    asrState: runtime.asr.state,
    ttsState: runtime.tts.state
  },
  executionEvidence: {
    blocksCompleted: selected.session.annotations.length,
    traceArtifacts: traces.length,
    traceHashesVerified: traces.length,
    committedTurns,
    successfulProviderStarts,
    providerRequestUpperBound: committedTurns,
    hardProcessLimit: runtime.requestLimit,
    top2Sealed: selected.session.top2SealedAt !== null,
    audioPersisted: selected.session.audio !== null,
    commercialEvaluated: selected.session.commercial.length > 0,
    f0AcceptedByServerGuard: adjacentF0WindowMs >= 120_000,
    adjacentF0WindowMs
  },
  gates: {
    lifecycleIsolationSmokePassed: lifecycle.pass === true,
    runtimeFreshAtPreflight:
      runtime.requests === 0 &&
      runtime.requestLimit === 25 &&
      runtime.activeKernelSessions === 0,
    exactEconomicBrain:
      runtime.brain === "openai" &&
      runtime.interactionModel === "gpt-5.6-luna" &&
      runtime.taskModel === "gpt-5.6-luna",
    healthReady: runtime.asr.state === "ready" && runtime.tts.state === "ready",
    sevenBlocksCompleted: selected.session.annotations.length === 7,
    sevenTraceArtifactsVerified: traces.length === 7,
    f0TwoMinuteGuardAccepted: adjacentF0WindowMs >= 120_000,
    audioDeclineHonored: selected.session.audio === null,
    top2SealedOnce: selected.session.top2SealedAt !== null,
    callBudgetStructurallyRespected:
      committedTurns <= runtime.requestLimit,
    analysisExcluded:
      selected.session.analysisEligibility === "excluded-dry-run"
  },
  operationalPostMortem: {
    scientificProtocolCompletedBeforeFailure: true,
    peripheralFailure:
      "Page.captureScreenshot excedeu o timeout depois de sessão, top-2, health e asserts finais concluídos.",
    disposition:
      "Screenshot removida do caminho crítico; sessão preservada; nenhum segundo dry-run e nenhuma chamada adicional.",
    prospectiveCorrection:
      "Novas anotações persistem startedAt, completedAt e elapsedMs; a API passou a exigir token efêmero por processo; e o upload de áudio consentido passou a anteceder a liberação do MediaStream, com retry idempotente pelo mesmo hash. O dry-run original foi aceito pelo guard de 120000 ms, mas antecede essas correções operacionais.",
    constructOrDominanceGateChanged: false
  },
  limitations: [
    "Dry-run operacional automatizado; não contém julgamento humano.",
    "Fala foi injetada no browser sob papel dry-run; não sustenta alegação sobre captura acústica ou ASR.",
    "O upper bound de chamadas é o número de turnos comprometidos; o adaptador executa no máximo uma requisição por turno e possui hard cap 25.",
    "S5 validou contrato, estímulo e persistência; a reprodução física no segundo dispositivo pertence às sessões humanas.",
    "O módulo Live comercial permaneceu indisponível e não foi avaliado."
  ]
};
report.pass = Object.values(report.gates).every(Boolean);
assert.equal(report.pass, true);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  reportPath,
  sessionId: report.sessionId,
  status: report.status,
  pass: report.pass,
  gates: report.gates,
  operationalPostMortem: report.operationalPostMortem
}, null, 2)}\n`);
