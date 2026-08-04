const instrument = document.querySelector("#instrument");
const errorBox = document.querySelector("#errorBox");
const statusCard = document.querySelector("#statusCard");
const statusText = document.querySelector("#statusText");
const voiceShell = document.querySelector("#voiceShell");
const voiceFrame = document.querySelector("#voiceFrame");
const voiceState = document.querySelector("#voiceState");
const receipt = document.querySelector("#sessionReceipt");
const withdrawButton = document.querySelector("#withdrawButton");
const accessToken = new URLSearchParams(location.search).get("token") ?? "";

let state = null;
let voiceReady = false;
let traceStartIndex = 0;
let mediaRecorder = null;
let audioChunks = [];
let recordedAudioBlob = null;
let audioUploaded = false;
let timerHandle = null;
let top2Preparation = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(text, mode = "ready") {
  statusText.textContent = text;
  statusCard.dataset.mode = mode;
}

function showError(error) {
  errorBox.hidden = false;
  errorBox.textContent = error?.message ?? String(error);
  setStatus("erro de contrato", "error");
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = "";
}

async function api(path, options = {}) {
  clearError();
  const response = await fetch(`/api/exp-0026/${path}`, {
    method: options.method ?? "POST",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(state?.sessionId ? { "x-exp0026-session-id": state.sessionId } : {}),
      "x-exp0026-access-token": accessToken,
      ...options.headers
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? payload.error ?? `HTTP ${response.status}`);
  state = payload;
  render();
  return payload;
}

function voiceApi() {
  return voiceFrame.contentWindow?.__duplexEvaluation ?? null;
}

async function waitForVoice() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (voiceApi()) {
      voiceReady = true;
      voiceState.textContent = "pronto";
      return voiceApi();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("A conversa não ficou pronta em 15 segundos.");
}

async function ensureVoiceStarted() {
  const bridge = await waitForVoice();
  const snapshot = bridge.snapshot();
  if (!snapshot.state.active) await bridge.start();
  voiceState.textContent = "microfone ativo";
  if (state.runtime && state.runtime.requests > 0 && state.blockCursor === 0) {
    throw new Error("O contador não estava zerado no início da primeira cena.");
  }
  await maybeStartAudioRecording();
}

async function maybeStartAudioRecording() {
  if (!state?.recording?.audio || mediaRecorder) return;
  if (state.phase !== "CAMPAIGN" || !voiceApi()) {
    throw new Error("A gravação consentida não pôde começar no estado atual.");
  }
  const stream = voiceApi().mediaStream();
  if (!stream || typeof MediaRecorder === "undefined") {
    throw new Error("O navegador não disponibilizou a gravação consentida.");
  }
  // O servidor recusará o upload quando o consentimento de áudio estiver desligado.
  try {
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
  } catch {
    mediaRecorder = new MediaRecorder(stream);
  }
  audioChunks = [];
  mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) audioChunks.push(event.data);
  });
  mediaRecorder.start(2_000);
}

async function stopAndUploadAudio() {
  if (!state?.recording?.audio || audioUploaded) return;
  if (!mediaRecorder) {
    throw new Error("A gravação consentida não foi iniciada.");
  }
  if (mediaRecorder.state !== "inactive") {
    const stopped = new Promise((resolve) => mediaRecorder.addEventListener("stop", resolve, { once: true }));
    mediaRecorder.stop();
    await stopped;
  }
  recordedAudioBlob ??= new Blob(audioChunks, {
    type: mediaRecorder.mimeType || "audio/webm"
  });
  if (recordedAudioBlob.size === 0) {
    throw new Error("A gravação consentida terminou sem áudio.");
  }
  const response = await fetch("/api/exp-0026/audio", {
    method: "POST",
    headers: {
      "content-type": recordedAudioBlob.type || "audio/webm",
      "x-exp0026-session-id": state.sessionId,
      "x-exp0026-access-token": accessToken
    },
    body: recordedAudioBlob
  });
  const payload = await response.json();
  if (!response.ok && payload.message !== "áudio não foi consentido") {
    throw new Error(payload.message ?? payload.error);
  }
  if (response.ok) {
    state = payload;
    audioUploaded = true;
  }
}

function progressHtml() {
  return `<div class="progress" aria-label="Progresso">${state.blockOrder.map((_, index) => {
    const kind = index < state.blockCursor ? "done" : index === state.blockCursor ? "current" : "";
    return `<span class="${kind}"></span>`;
  }).join("")}</div>`;
}

function renderConsent() {
  instrument.innerHTML = `
    <h2>Consentimentos separados</h2>
    <p class="muted">Participar é obrigatório; gravações, traces e referência comercial são opcionais e independentes.</p>
    <form id="consentForm">
      <label class="option"><input type="checkbox" name="participation" required><span>Concordo em participar e com o processamento transitório da fala pelo cérebro externo informado. As respostas são somente para avaliação.</span></label>
      <label class="option"><input type="checkbox" name="audio"><span>Autorizo gravar localmente o áudio do microfone durante esta sessão.</span></label>
      <label class="option"><input type="checkbox" name="trace"><span>Autorizo persistir traces locais, que podem conter transcrição.</span></label>
      <label class="option"><input type="checkbox" name="commercial" ${state.commercialAvailable ? "" : "disabled"}><span>Autorizo o bloco opcional com uma referência Live comercial${state.commercialAvailable ? "." : " — indisponível neste freeze."}</span></label>
      <div class="actions"><span class="muted">Você pode retirar o consentimento e apagar os dados.</span><button class="primary">Continuar</button></div>
    </form>`;
  document.querySelector("#consentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      setStatus("selando consentimento", "busy");
      await api("consent", { body: {
        participation: data.has("participation"),
        audio: data.has("audio"),
        trace: data.has("trace"),
        commercial: data.has("commercial")
      }});
    } catch (error) { showError(error); }
  });
}

function healthState(value) {
  if (!value) return "ausente";
  if (typeof value === "string") return value;
  return value.state ?? "desconhecido";
}

function renderPreflight() {
  const runtime = state.runtime;
  instrument.innerHTML = `
    <h2>Preflight da sessão</h2>
    <p class="muted">A coleta só abre com processo, cérebro e orçamento novos. O facilitador confirma a parte física antes de qualquer cena.</p>
    <div class="summary">
      <div><small>PROCESSO</small><strong>${escapeHtml(runtime.processRunId.slice(0, 12))}</strong></div>
      <div><small>CÉREBRO</small><strong>${escapeHtml(runtime.interactionModel)}</strong></div>
      <div><small>ORÇAMENTO</small><strong>${runtime.requests}/${runtime.requestLimit}</strong></div>
      <div><small>ASR · TTS</small><strong>${escapeHtml(healthState(runtime.asr))} · ${escapeHtml(healthState(runtime.tts))}</strong></div>
    </div>
    <form id="preflightForm">
      <label class="option"><input type="checkbox" name="deviceMatch" required><span>Microfone, saída, computador e volumes correspondem à condição congelada.</span></label>
      <label class="option"><input type="checkbox" name="roomMatch" required><span>Sala e posições físicas correspondem à condição congelada.</span></label>
      <label class="option"><input type="checkbox" name="noiseProbe" required><span>O WAV seeded foi reproduzido no segundo dispositivo e o probe ficou dentro da tolerância. Ele contém somente ruído branco, nunca conversa.</span></label>
      <label class="option"><input type="checkbox" name="recordingDefaultsOff" required><span>Áudio e trace começaram desligados e serão persistidos apenas conforme o consentimento acima.</span></label>
      <div class="actions">
        <button class="ghost" type="button" id="noiseButton">Baixar estímulo S5</button>
        <button class="primary">Abrir as cenas</button>
      </div>
    </form>`;
  document.querySelector("#noiseButton").addEventListener("click", downloadNoise);
  document.querySelector("#preflightForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      setStatus("validando preflight", "busy");
      await api("preflight", { body: {
        deviceMatch: data.has("deviceMatch"),
        roomMatch: data.has("roomMatch"),
        noiseProbe: data.has("noiseProbe"),
        recordingDefaultsOff: data.has("recordingDefaultsOff")
      }});
    } catch (error) { showError(error); }
  });
}

async function downloadNoise() {
  try {
    const response = await fetch("/api/exp-0026/noise", {
      headers: {
        "x-exp0026-session-id": state.sessionId,
        "x-exp0026-access-token": accessToken
      }
    });
    if (!response.ok) throw new Error("Estímulo de ruído ainda não foi materializado.");
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "exp-0026-s5-white-noise-v0.1.wav";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2_000);
  } catch (error) { showError(error); }
}

function currentBlock() {
  const id = state.blockOrder[state.blockCursor];
  return id === "F0"
    ? state.spontaneous
    : state.guided.find((scene) => scene.id === id);
}

function renderCampaign() {
  voiceShell.hidden = false;
  const block = currentBlock();
  const active = state.activeBlock?.blockId === block.id;
  instrument.innerHTML = `${progressHtml()}
    <div class="row"><div><span class="scene-id">${block.id}</span><h2>${escapeHtml(block.title)}</h2></div>${block.id === "F0" ? '<strong class="timer" id="timer">02:00</strong>' : ""}</div>
    <p class="instruction">${escapeHtml(block.instruction)}</p>
    ${block.capacity ? `<p class="muted">Capacidade provocada: ${escapeHtml(block.capacity)}</p>` : ""}
    ${active ? ratingHtml(block) : '<div class="actions"><span class="muted">Leia a orientação antes de começar.</span><button class="primary" id="startBlock">Iniciar este bloco</button></div>'}`;
  if (active) {
    bindRating(block);
    if (block.id === "F0") startTimer();
  } else {
    document.querySelector("#startBlock").addEventListener("click", async () => {
      try {
        setStatus("iniciando bloco", "busy");
        await ensureVoiceStarted();
        traceStartIndex = voiceApi().snapshot().trace.length;
        await api("block/start", { body: { blockId: block.id } });
      } catch (error) { showError(error); }
    });
  }
}

function ratingHtml(block) {
  return `<form id="ratingForm">
    <fieldset><legend>Depois de conversar, qual foi o principal problema neste bloco?</legend>
      ${state.categories.map((category) => `<label class="option"><input type="radio" name="category" value="${category.id}" required><span>${escapeHtml(category.label)}</span></label>`).join("")}
    </fieldset>
    <div class="field"><label for="severity">Quanto isso atrapalhou?</label><select id="severity" name="severity" required><option value="">Selecione</option>${state.severity.map((item) => `<option value="${item.value}">${item.value} · ${escapeHtml(item.label)}</option>`).join("")}</select></div>
    <div class="field"><label for="comment">Comentário opcional</label><textarea id="comment" name="comment" maxlength="1000" placeholder="Use se algo ficou ambíguo ou se quiser explicar sua percepção."></textarea></div>
    <div class="actions"><span class="muted">A resposta é sobre este bloco, não sobre o projeto em geral.</span><button class="primary" id="finishBlock">Salvar e avançar</button></div>
  </form>`;
}

function bindRating(block) {
  const form = document.querySelector("#ratingForm");
  const categoryInputs = [...form.elements.category];
  const severity = form.elements.severity;
  for (const input of categoryInputs) input.addEventListener("change", () => {
    if (input.checked && input.value === "NENHUM_PROBLEMA_MATERIAL") severity.value = "0";
    if (input.checked && input.value !== "NENHUM_PROBLEMA_MATERIAL" && severity.value === "0") severity.value = "";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      setStatus("selando bloco", "busy");
      const snapshot = state.recording.trace
        ? voiceApi()?.snapshot() ?? null
        : null;
      if (snapshot) snapshot.trace = snapshot.trace.slice(traceStartIndex);
      await api("block", { body: {
        blockId: block.id,
        category: data.get("category"),
        severity: Number(data.get("severity")),
        comment: data.get("comment") || null,
        snapshot
      }});
    } catch (error) { showError(error); }
  });
}

function startTimer() {
  clearInterval(timerHandle);
  const timer = document.querySelector("#timer");
  const submit = document.querySelector("#finishBlock");
  const update = () => {
    const left = Math.max(0, 120_000 - (Date.now() - state.activeBlock.startedAtEpochMs));
    timer.textContent = `${String(Math.floor(left / 60_000)).padStart(2, "0")}:${String(Math.ceil((left % 60_000) / 1_000)).padStart(2, "0")}`;
    submit.disabled = left > 0;
    if (left === 0) clearInterval(timerHandle);
  };
  update();
  timerHandle = setInterval(update, 250);
}

async function prepareTop2() {
  if (!top2Preparation) {
    const preparation = (async () => {
      clearInterval(timerHandle);
      // Preserve the consented recording before the voice runtime releases
      // its MediaStream tracks. Stopping the iframe first can yield an empty
      // blob in browsers that end MediaRecorder together with the source.
      await stopAndUploadAudio();
      if (voiceApi()) await voiceApi().stop().catch(() => {});
      voiceState.textContent = "encerrado";
    })();
    top2Preparation = preparation.catch((error) => {
      top2Preparation = null;
      throw error;
    });
  }
  return top2Preparation;
}

function renderTop2() {
  voiceShell.hidden = true;
  const eligibleIds = [...new Set(state.annotations.filter((item) => item.severity > 0).map((item) => item.category))];
  const eligible = state.categories.filter((category) => eligibleIds.includes(category.id));
  instrument.innerHTML = `<h2>Os maiores problemas da sessão</h2>
    <p class="muted">Escolha no máximo dois. Você pode deixar vazio ou escolher apenas um. Esta decisão será selada uma única vez.</p>
    <form id="top2Form"><fieldset>${eligible.length === 0 ? '<p>Nenhum problema com severidade maior que zero foi registrado.</p>' : eligible.map((category) => `<label class="option"><input type="checkbox" name="top2" value="${category.id}"><span>${escapeHtml(category.label)}</span></label>`).join("")}</fieldset>
    <div class="actions"><span id="top2Count">0 de 2 escolhidos</span><button class="primary">Selar escolha</button></div></form>`;
  void prepareTop2().catch(showError);
  const form = document.querySelector("#top2Form");
  const inputs = [...form.querySelectorAll('input[name="top2"]')];
  for (const input of inputs) input.addEventListener("change", () => {
    const count = inputs.filter((item) => item.checked).length;
    if (count > 2) input.checked = false;
    document.querySelector("#top2Count").textContent = `${inputs.filter((item) => item.checked).length} de 2 escolhidos`;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await prepareTop2();
      await api("top2", { body: { selected: inputs.filter((item) => item.checked).map((item) => item.value) } });
    } catch (error) { showError(error); }
  });
}

function renderCommercial() {
  const labels = ["Hesitação e continuação", "Interrupção com correção", "Dados sob ruído branco"];
  const ratings = [
    ["NOSSO_MUITO_PIOR", "Nosso muito pior"],
    ["NOSSO_UM_POUCO_PIOR", "Nosso um pouco pior"],
    ["SEMELHANTE", "Semelhante"],
    ["NOSSO_UM_POUCO_MELHOR", "Nosso um pouco melhor"],
    ["NOSSO_MUITO_MELHOR", "Nosso muito melhor"]
  ];
  instrument.innerHTML = `<h2>Calibração comercial opcional</h2><p class="muted">O top-2 local já está selado. Não grave áudio, tela, transcrição ou output comercial.</p><form id="commercialForm">${labels.map((label, index) => `<fieldset><legend>${index + 1}. ${label}</legend><select name="rating${index}" required><option value="">Distância percebida</option>${ratings.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select><select name="confidence${index}" required><option value="">Confiança</option>${[1,2,3,4,5].map((value) => `<option value="${value}">${value}</option>`).join("")}</select><textarea name="comment${index}" maxlength="1000" placeholder="Motivo opcional"></textarea></fieldset>`).join("")}<div class="actions"><span class="muted">Este bloco não altera o ranking.</span><button class="primary">Concluir calibração</button></div></form>`;
  document.querySelector("#commercialForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const anchors = labels.map((_, index) => ({
      rating: data.get(`rating${index}`),
      confidence: Number(data.get(`confidence${index}`)),
      comment: data.get(`comment${index}`) || null
    }));
    try { await api("commercial", { body: { anchors } }); } catch (error) { showError(error); }
  });
}

function renderComplete() {
  voiceShell.hidden = true;
  instrument.innerHTML = `<h2>Sessão concluída</h2><p>Obrigado. A escolha humana foi selada e continuará separada da primeira codificação técnica.</p><p class="muted">Guarde o recibo de retirada por 30 dias: <code>${escapeHtml(state.withdrawalReceiptCode)}</code>. Ele permite solicitar exclusão mesmo depois que esta janela fechar.</p><div class="summary"><div><small>PAPEL</small><strong>${escapeHtml(state.role)}</strong></div><div><small>ELEGIBILIDADE</small><strong>${escapeHtml(state.analysisEligibility)}</strong></div><div><small>BLOCOS</small><strong>7/7</strong></div><div><small>TOP-2</small><strong>selado</strong></div></div>`;
  setStatus(state.role === "dry-run" ? "dry-run excluído" : "concluída", "ready");
}

function renderWithdrawn() {
  voiceShell.hidden = true;
  withdrawButton.hidden = true;
  instrument.innerHTML = `<h2>Consentimento retirado</h2><p>Os dados locais desta sessão foram apagados. Apenas um tombstone administrativo sem conteúdo da conversa impede reutilização acidental do mesmo ID.</p>`;
  setStatus("dados apagados", "ready");
}

function render() {
  receipt.textContent = state ? `${state.sessionId} · recibo ${state.withdrawalReceiptCode} · ${state.role} · ${state.analysisEligibility}` : "sessão não vinculada";
  withdrawButton.hidden = !state || ["CONSENT", "WITHDRAWN"].includes(state.phase);
  if (!state) return;
  setStatus(state.phase.toLowerCase(), state.phase === "CAMPAIGN" ? "busy" : "ready");
  if (state.phase === "CONSENT") renderConsent();
  else if (state.phase === "PREFLIGHT") renderPreflight();
  else if (state.phase === "CAMPAIGN") renderCampaign();
  else if (state.phase === "TOP2") renderTop2();
  else if (state.phase === "COMMERCIAL") renderCommercial();
  else if (state.phase === "COMPLETE") renderComplete();
  else if (state.phase === "WITHDRAWN") renderWithdrawn();
}

withdrawButton.addEventListener("click", async () => {
  if (!confirm("Retirar o consentimento e apagar áudio, traces e respostas desta sessão?")) return;
  try {
    if (voiceApi()) await voiceApi().stop().catch(() => {});
    await api("withdraw", { body: {} });
  } catch (error) { showError(error); }
});

voiceFrame.addEventListener("load", () => {
  void waitForVoice().catch(showError);
});

try {
  const response = await fetch("/api/exp-0026/session", {
    cache: "no-store",
    headers: { "x-exp0026-access-token": accessToken }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Instrumento indisponível");
  state = payload;
  render();
} catch (error) {
  showError(error);
  instrument.innerHTML = "<h2>Instrumento não inicializado</h2><p>Inicie uma sessão EXP-0026 isolada pelo supervisor.</p>";
}

Object.defineProperty(window, "__exp0026", {
  value: Object.freeze({
    snapshot: () => structuredClone(state),
    voiceSnapshot: () => voiceApi()?.snapshot() ?? null,
    ready: () => Boolean(state && (voiceReady || state.phase !== "CAMPAIGN"))
  })
});
