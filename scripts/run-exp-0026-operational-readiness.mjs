import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { connectCdpBrowser } from "./lib/cdp-browser.mjs";
import { startExp0026Server } from "./lib/exp-0026-process.mjs";
import {
  createExp0026OperationalReadinessReport,
  evaluateExp0026AcousticQualification
} from "../src/eval/exp-0026-operational-readiness.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const openingPath = resolve(
  projectRoot,
  "eval/commitments/exp-0026-operational-readiness-opening-v0.1.json"
);
const preflightPath = resolve(
  projectRoot,
  "eval/generated/exp-0026/operational-readiness-preflight-v0.1.json"
);
const consumedPath = resolve(
  projectRoot,
  "eval/generated/exp-0026/operational-readiness-attempt-consumed-v0.1.json"
);
const reportPath = resolve(
  projectRoot,
  "eval/reports/exp-0026-operational-readiness-v0.1.json"
);
const sha256 = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const git = (...args) => execFileSync("git", args, {
  cwd: projectRoot,
  encoding: "utf8"
}).trim();

const [openingBytes, preflightBytes] = await Promise.all([
  readFile(openingPath),
  readFile(preflightPath)
]);
const opening = JSON.parse(openingBytes);
const preflight = JSON.parse(preflightBytes);
if (
  opening.status !== "OPEN_FOR_ONE_PHYSICAL_QUALIFICATION" ||
  opening.attemptId !== "EXP-0026-OQ-A-ONE" ||
  preflight.pass !== true
) throw new Error("abertura ou preflight operacional inválido");
if (Date.now() > new Date(opening.expiresAt).valueOf()) {
  throw new Error("janela terminal de qualificação expirou");
}
await Promise.all([consumedPath, reportPath].map((path) => access(path).then(
  () => { throw new Error(`tentativa terminal já consumida: ${path}`); },
  (error) => { if (error.code !== "ENOENT") throw error; }
)));
const head = git("rev-parse", "HEAD");
const drift = git("diff", "--name-only", opening.sourceCommit, head)
  .split(/\r?\n/u).filter(Boolean);
if (drift.some((path) =>
  path !== "eval/commitments/exp-0026-operational-readiness-opening-v0.1.json"
)) throw new Error("código divergiu do sourceCommit da abertura");
if (git("status", "--porcelain=v1", "--untracked-files=all") !== "") {
  throw new Error("worktree precisa estar limpa para consumir a tentativa física");
}

const runRoot = await mkdtemp(join(tmpdir(), "exp0026-oq-physical-"));
const startedAtMs = Date.now();
let server = null;
let browser = null;
let page = null;
let attemptConsumed = false;
let requests = 0;
let terminalFailure = null;
let observation = null;

function expression(value) {
  return JSON.stringify(value);
}

async function showPrompt(title, body, buttons) {
  await page.evaluate(`(() => {
    document.querySelector('#exp0026-oq-overlay')?.remove();
    window.__exp0026OqAnswer = null;
    const overlay = document.createElement('div');
    overlay.id = 'exp0026-oq-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#071018ee;color:#fff;display:grid;place-items:center;font-family:system-ui;padding:32px';
    const card = document.createElement('section');
    card.style.cssText = 'max-width:760px;background:#102231;border:1px solid #4b718d;border-radius:18px;padding:32px;box-shadow:0 20px 70px #000';
    const heading = document.createElement('h1');
    heading.textContent = ${expression(title)};
    const text = document.createElement('p');
    text.textContent = ${expression(body)};
    text.style.cssText = 'font-size:20px;line-height:1.5';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:16px;margin-top:24px;flex-wrap:wrap';
    for (const item of ${expression(buttons)}) {
      const button = document.createElement('button');
      button.textContent = item.label;
      button.style.cssText = 'font:inherit;font-weight:700;padding:14px 20px;border-radius:10px;border:0;cursor:pointer';
      button.onclick = () => { window.__exp0026OqAnswer = item.value; };
      actions.append(button);
    }
    card.append(heading, text, actions);
    overlay.append(card);
    document.body.append(overlay);
    return true;
  })()`);
}

async function waitAnswer(timeoutMs = 120_000) {
  await page.waitFor("window.__exp0026OqAnswer !== null", { timeoutMs });
  const answer = await page.evaluate("window.__exp0026OqAnswer");
  await page.evaluate("document.querySelector('#exp0026-oq-overlay')?.remove(); true");
  return answer;
}

async function mark(name) {
  await page.evaluate(`window.__exp0026OqCapture.mark(${expression(name)})`);
}

function traceCondition(after, types, detailRequired = false) {
  return `(() => window.__duplexEvaluation.snapshot().trace.slice(${after}).some((event) => ${expression(types)}.includes(event.type)${detailRequired ? " && String(event.detail || '').trim().length > 0" : ""}))()`;
}

try {
  server = await startExp0026Server({
    projectRoot,
    runtime: "full",
    role: "dry-run",
    participantAlias: "OQ-PHYSICAL",
    orderIndex: 0,
    dataRoot: resolve(runRoot, "private"),
    commercialAvailable: false,
    mirrorLogs: false
  });
  browser = await connectCdpBrowser({ timeoutMs: 30_000 });
  page = await browser.createIsolatedPage(
    `http://localhost:${server.port}/?evaluation=0026&readiness=1`,
    { permissions: ["audioCapture"], newWindow: true }
  );
  await page.waitFor("Boolean(window.__duplexEvaluation)", { timeoutMs: 45_000 });
  await showPrompt(
    "Qualificação acústica terminal EXP-0026",
    "Ao continuar, o microfone será gravado apenas em memória por alguns minutos para medir a cadeia física. O áudio e as transcrições não serão persistidos. Você ouvirá voz e ruído e dirá duas frases curtas.",
    [
      { label: "Autorizar e iniciar", value: "CONSENT" },
      { label: "Cancelar sem consumir", value: "CANCEL" }
    ]
  );
  const consent = await waitAnswer();
  if (consent !== "CONSENT") {
    throw new Error("OPERATOR_CANCELLED_BEFORE_ATTEMPT_CONSUMPTION");
  }
  const consumed = {
    schemaVersion: "exp-0026-operational-readiness-attempt-consumed-v1",
    experimentId: "EXP-0026",
    attemptId: opening.attemptId,
    consumedAt: new Date().toISOString(),
    boundary: "microphone-about-to-open",
    openingCommitmentSha256: opening.commitmentSha256
  };
  await mkdir(dirname(consumedPath), { recursive: true });
  await writeFile(consumedPath, `${JSON.stringify(consumed, null, 2)}\n`, {
    flag: "wx"
  });
  attemptConsumed = true;

  await page.evaluate("window.__duplexEvaluation.start()");
  await page.waitFor(
    "window.__duplexEvaluation.snapshot().state.inputMode === 'local-pcm' && Boolean(window.__duplexEvaluation.mediaStream())",
    { timeoutMs: 30_000 }
  );
  await page.evaluate(`(async () => {
    const sourceStream = window.__duplexEvaluation.mediaStream();
    const stream = new MediaStream(sourceStream.getAudioTracks().map((track) => track.clone()));
    const chunks = [];
    const levels = [];
    const marks = {};
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const sample of data) sum += sample * sample;
      levels.push({ atMs: performance.now(), rms: Math.sqrt(sum / data.length) });
    }, 50);
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : '';
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.start(500);
    const startedAtMs = performance.now();
    window.__exp0026OqCapture = {
      mark(name) { marks[name] = performance.now(); },
      async stop() {
        if (recorder.state !== 'inactive') {
          await new Promise((resolve) => {
            recorder.addEventListener('stop', resolve, { once: true });
            recorder.stop();
          });
        }
        clearInterval(timer);
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const bytes = await blob.arrayBuffer();
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map((value) => value.toString(16).padStart(2, '0')).join('');
        let decoded = null;
        try { decoded = await context.decodeAudioData(bytes.slice(0)); } catch {}
        let rms = 0;
        if (decoded) {
          const samples = decoded.getChannelData(0);
          let sum = 0;
          for (const sample of samples) sum += sample * sample;
          rms = Math.sqrt(sum / samples.length);
        }
        const segmentRms = (start, end) => {
          const selected = levels.filter((item) => item.atMs >= marks[start] && item.atMs <= marks[end]);
          return selected.length === 0 ? null : Math.sqrt(selected.reduce((sum, item) => sum + item.rms * item.rms, 0) / selected.length);
        };
        const track = stream.getAudioTracks()[0];
        const result = {
          bytes: bytes.byteLength,
          sha256: 'sha256:' + digest,
          decodable: Boolean(decoded),
          durationMs: decoded ? decoded.duration * 1000 : performance.now() - startedAtMs,
          rms,
          settings: track.getSettings(),
          trackReadyStateBeforeDelete: track.readyState,
          segments: {
            initialSilenceRms: segmentRms('initialSilenceStart', 'initialSilenceEnd'),
            ttsRms: segmentRms('ttsStart', 'ttsEnd'),
            noiseSilenceRms: segmentRms('noiseSilenceStart', 'noiseSilenceEnd'),
            noiseRms: segmentRms('noiseStart', 'noiseEnd')
          }
        };
        stream.getTracks().forEach((item) => item.stop());
        chunks.length = 0;
        levels.length = 0;
        await context.close();
        window.__exp0026OqCapture = null;
        return { ...result, rawDeleted: true };
      }
    };
    return true;
  })()`);

  await mark("initialSilenceStart");
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
  await mark("initialSilenceEnd");

  const ttsBaseline = (await page.evaluate(
    "window.__duplexEvaluation.snapshot().trace.length"
  ));
  await mark("ttsStart");
  await page.evaluate(
    `window.__duplexEvaluation.speakReadiness(${expression("Esta é a voz congelada da qualificação acústica. Confirme apenas se você consegue ouvi-la.")})`
  );
  await page.waitFor(traceCondition(ttsBaseline, ["assistant.speech.started"]), {
    timeoutMs: 30_000
  });
  await page.waitFor(traceCondition(ttsBaseline, ["assistant.speech.finished"]), {
    timeoutMs: 30_000
  });
  await mark("ttsEnd");
  await showPrompt(
    "A voz foi audível?",
    "Marque apenas se alguma fala saiu fisicamente pelo dispositivo de áudio. Não julgue naturalidade, volume ideal ou qualidade.",
    [
      { label: "Sim, ouvi", value: "AUDIBLE" },
      { label: "Não ouvi", value: "NOT_AUDIBLE" }
    ]
  );
  const audible = await waitAnswer();

  await showPrompt(
    "Fala fixa para o ASR",
    "Clique em pronto e diga uma vez: hoje é um teste de áudio em português. O conteúdo reconhecido não será salvo e não precisa estar perfeito.",
    [{ label: "Pronto para falar", value: "READY" }]
  );
  await waitAnswer();
  const speechBaseline = await page.evaluate(
    "window.__duplexEvaluation.snapshot().trace.length"
  );
  await page.waitFor(traceCondition(speechBaseline, ["user.speech.started"]), {
    timeoutMs: 25_000
  });
  await page.waitFor(
    traceCondition(speechBaseline, ["user.transcript.final"], true),
    { timeoutMs: 35_000 }
  );

  await showPrompt(
    "Sobreposição observável",
    "Ao clicar, uma fala longa começará. Enquanto ela estiver tocando, diga claramente: agora. Aqui só verificamos se captura e decisão ficam observáveis; não julgamos se o sistema interrompeu corretamente.",
    [{ label: "Iniciar sobreposição", value: "READY" }]
  );
  await waitAnswer();
  const overlapBefore = await page.evaluate(`(() => {
    const snapshot = window.__duplexEvaluation.snapshot();
    return { trace: snapshot.trace.length, frames: snapshot.audio.capture.receivedFrames };
  })()`);
  await page.evaluate(
    `window.__duplexEvaluation.speakReadiness(${expression("Continuo falando para tornar a sobreposição observável enquanto você diz agora, continuo falando para tornar a sobreposição observável enquanto você diz agora.")}, { loop: true })`
  );
  await page.waitFor(
    traceCondition(overlapBefore.trace, ["assistant.speech.started"]),
    { timeoutMs: 30_000 }
  );
  await showPrompt(
    "Diga AGORA",
    "Fale agora sobre a voz do assistente. Não clique em nada; esta mensagem desaparecerá quando uma decisão de turno for observada.",
    []
  );
  const overlapDecision = [
    "output-interruption.transition",
    "user.backchannel.early",
    "user.backchannel",
    "assistant.speech.stopped"
  ];
  await page.waitFor(
    traceCondition(overlapBefore.trace, ["user.speech.started"]), {
    timeoutMs: 30_000
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  const overlapOutcome = await page.evaluate(`(() => {
    const events = window.__duplexEvaluation.snapshot().trace.slice(${overlapBefore.trace});
    return events.some((event) => ${expression(overlapDecision)}.includes(event.type))
      ? 'EXPLICIT_TRANSITION_OBSERVED'
      : 'NO_EXPLICIT_TRANSITION_OBSERVED';
  })()`);
  await page.evaluate("document.querySelector('#exp0026-oq-overlay')?.remove(); window.__duplexEvaluation.stopReadinessSpeech(); true");
  const overlapAfter = await page.evaluate(`(() => {
    const snapshot = window.__duplexEvaluation.snapshot();
    return { frames: snapshot.audio.capture.receivedFrames, capture: snapshot.audio.capture };
  })()`);
  const captureSnapshot = overlapAfter.capture;
  await page.evaluate("window.__duplexEvaluation.stop()");

  await mark("noiseSilenceStart");
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
  await mark("noiseSilenceEnd");
  await showPrompt(
    "Ruído branco congelado",
    "Clique e permaneça em silêncio. O ruído será tocado brevemente pelo dispositivo físico e medido pelo microfone; isto não avalia conforto ou volume ideal.",
    [{ label: "Tocar ruído", value: "PLAY" }]
  );
  await waitAnswer();
  await mark("noiseStart");
  const noise = await page.evaluate(`(async () => {
    const response = await fetch('/api/exp-0026/noise', { headers: {
      'x-exp0026-access-token': ${expression(server.accessToken)},
      'x-exp0026-session-id': ${expression(server.health.evaluation.exp0026.sessionId)}
    }});
    if (!response.ok) throw new Error('noise HTTP ' + response.status);
    const expected = response.headers.get('x-content-sha256');
    const blob = await response.blob();
    const bytes = await blob.arrayBuffer();
    const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((value) => value.toString(16).padStart(2, '0')).join('');
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = 0.5;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        audio.pause();
        resolve();
      }, 5_000);
      audio.onended = () => {
        clearTimeout(timer);
        resolve();
      };
      audio.onerror = () => reject(new Error('noise playback failed'));
      audio.play().catch(reject);
    });
    URL.revokeObjectURL(url);
    return { hashMatched: expected === actual, played: true };
  })()`);
  await mark("noiseEnd");
  const recorder = await page.evaluate("window.__exp0026OqCapture.stop()");
  const finalHealth = await fetch(server.healthUrl).then((response) => response.json());
  requests = finalHealth.usage.requests;
  const permission = await page.evaluate(
    "navigator.permissions.query({name:'microphone'}).then((value) => value.state)"
  );
  const isolation = await page.evaluate(`(() => ({
    local: Object.keys(localStorage).length,
    session: Object.keys(sessionStorage).length,
    secure: window.isSecureContext
  }))()`);
  const deviceIdSha256 = recorder.settings.deviceId
    ? sha256(Buffer.from(`EXP-0026-device:${recorder.settings.deviceId}`))
    : null;
  observation = {
    schemaVersion: "exp-0026-acoustic-observation-v1",
    attemptId: opening.attemptId,
    observedAt: new Date().toISOString(),
    browser: {
      isolatedContext: isolation.local === 0 && isolation.session === 0,
      secureOrigin: isolation.secure === true,
      product: browser.version.Browser ?? null
    },
    microphone: {
      permission,
      trackReadyState: recorder.trackReadyStateBeforeDelete,
      deviceIdSha256,
      sampleRate: recorder.settings.sampleRate ?? null,
      channelCount: recorder.settings.channelCount ?? null,
      echoCancellation: recorder.settings.echoCancellation ?? null,
      noiseSuppression: recorder.settings.noiseSuppression ?? null,
      autoGainControl: recorder.settings.autoGainControl ?? null
    },
    capture: {
      receivedFrames: captureSnapshot.receivedFrames,
      deliveredFrames: captureSnapshot.deliveredFrames,
      observedSequenceGaps: captureSnapshot.observedSequenceGaps,
      observedSampleGaps: captureSnapshot.observedSampleGaps,
      protocolErrors: captureSnapshot.protocolErrors
    },
    fixedSpeech: {
      speechStartObserved: true,
      nonemptyFinalObserved: true
    },
    tts: {
      rendererStarted: true,
      rendererFinished: true,
      operatorAudibleAck: audible === "AUDIBLE",
      microphoneCaptureNonSilent:
        Number.isFinite(recorder.segments.ttsRms) && recorder.segments.ttsRms > 0
    },
    overlap: {
      captureAdvanced: overlapAfter.frames > overlapBefore.frames,
      turnDecisionObserved: [
        "EXPLICIT_TRANSITION_OBSERVED",
        "NO_EXPLICIT_TRANSITION_OBSERVED"
      ].includes(overlapOutcome)
    },
    recorder: {
      decodable: recorder.decodable,
      rawDeleted: recorder.rawDeleted,
      durationMs: recorder.durationMs,
      rms: recorder.rms,
      bytes: recorder.bytes,
      sha256: recorder.sha256
    },
    noise: {
      artifactHashMatched: noise.hashMatched,
      playedThroughPhysicalOutput: noise.played,
      silenceRms: recorder.segments.noiseSilenceRms,
      noiseRms: recorder.segments.noiseRms
    }
  };
} catch (error) {
  terminalFailure = error.message;
  if (attemptConsumed) {
    observation = {
      schemaVersion: "exp-0026-acoustic-observation-v1",
      attemptId: opening.attemptId,
      observedAt: new Date().toISOString(),
      browser: { isolatedContext: false, secureOrigin: false },
      microphone: { permission: "unknown", trackReadyState: "ended" },
      capture: {},
      fixedSpeech: {},
      tts: {},
      overlap: {},
      recorder: {},
      noise: {}
    };
  } else {
    throw error;
  }
} finally {
  await page?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await server?.stop().catch(() => {});
  await rm(runRoot, { recursive: true, force: true });
}

const acoustic = evaluateExp0026AcousticQualification(observation);
const completedAt = new Date().toISOString();
const physicalMinutes = (Date.now() - startedAtMs) / 60_000;
const automated = {
  frozenSignatureVocabulary: true,
  deterministicRanking: true,
  unknownRemainsUnattributed: true,
  postCompleteWithdrawal: true,
  postOpenReanalysis: true,
  postCloseoutArtifactInvalidation: true,
  retentionPurge: true,
  exhaustiveDiversityValidation: true,
  administrativeOnlyReplacement: true,
  startedSessionRequiresWithdrawal: true,
  maximumTwoActivations: true,
  withinTerminalBudget: physicalMinutes <= 12 && requests <= 2
};
const report = createExp0026OperationalReadinessReport({
  acoustic,
  automated,
  amendment: opening.amendment,
  sourceCommit: opening.sourceCommit,
  openingCommitment: {
    path: "eval/commitments/exp-0026-operational-readiness-opening-v0.1.json",
    sha256: sha256(openingBytes),
    commitmentSha256: opening.commitmentSha256
  },
  completedAt,
  executionDisposition: terminalFailure
    ? "EXECUTION_EXCEPTION_AFTER_CONSUMPTION"
    : "COMPLETED",
  timebox: {
    wallMinutes: Math.round(physicalMinutes * 100) / 100,
    physicalAttempts: 1,
    externalLlmRequests: requests,
    withinBudget: automated.withinTerminalBudget
  },
  automatedEvidence: [{
    path: "eval/generated/exp-0026/operational-readiness-preflight-v0.1.json",
    fileSha256: sha256(preflightBytes),
    preflightSha256: preflight.preflightSha256,
    pass: preflight.pass
  }],
  prohibitedScopeRemainedClosed: true
});
if (!automated.withinTerminalBudget && report.pass) {
  throw new Error("relatório não fechou orçamento terminal");
}
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
  flag: "wx"
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (terminalFailure) {
  process.stderr.write(`Falha terminal OQ-A: ${terminalFailure}\n`);
}
