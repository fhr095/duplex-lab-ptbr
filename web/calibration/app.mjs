const PARTICIPANT_KEY = "duplex-lab-timing-participant-v2";
const SPEAKER_RELEVANCE = Object.freeze([
  "DIRECTED_TO_ASSISTANT",
  "BACKGROUND_OR_NOT_DIRECTED",
  "UNCERTAIN"
]);
const REASONS = Object.freeze([
  ["cortou-cedo", "A fala foi cortada cedo"],
  ["demorou-para-parar", "Demorou para parar"],
  ["ignorou-fala", "Pareceu ignorar a outra pessoa"],
  ["sobreposicao-desconfortavel", "A sobreposição incomodou"],
  ["ritmo-natural", "O ritmo pareceu natural"],
  ["dificil", "Foi difícil perceber diferença"],
  ["fala-parecia-fundo", "A fala parecia estar ao fundo"],
  [
    "nao-ficou-claro-se-fala-era-dirigida",
    "Não ficou claro se a fala era dirigida à assistente"
  ],
  ["opcoes-pareciam-iguais", "Duas ou mais opções pareciam iguais"]
]);

const elements = Object.freeze({
  intro: document.querySelector("#introPanel"),
  campaign: document.querySelector("#campaignPanel"),
  result: document.querySelector("#resultPanel"),
  error: document.querySelector("#errorPanel"),
  errorMessage: document.querySelector("#errorMessage"),
  start: document.querySelector("#startButton"),
  retry: document.querySelector("#retryButton"),
  campaignHeading: document.querySelector("#campaignHeading"),
  progressLabel: document.querySelector("#progressLabel"),
  completionLabel: document.querySelector("#completionLabel"),
  progressTrack: document.querySelector("#progressTrack"),
  progressFill: document.querySelector("#progressFill"),
  optionGrid: document.querySelector("#optionGrid"),
  choicePanel: document.querySelector("#choicePanel"),
  choiceGrid: document.querySelector("#choiceGrid"),
  uncertain: document.querySelector("#uncertainChoice"),
  relevancePanel: document.querySelector("#relevancePanel"),
  confidencePanel: document.querySelector("#confidencePanel"),
  reasonPanel: document.querySelector("#reasonPanel"),
  reasonGrid: document.querySelector("#reasonGrid"),
  commentPanel: document.querySelector("#commentPanel"),
  comment: document.querySelector("#commentInput"),
  sceneHint: document.querySelector("#sceneHint"),
  next: document.querySelector("#nextButton"),
  resultDetails: document.querySelector("#resultDetails")
});

const state = {
  phase: "intro",
  participantRole: null,
  session: null,
  sceneIndex: 0,
  responses: new Map(),
  playbackCounts: new Map(),
  currentAudio: null,
  lastError: null
};

function participantToken() {
  let token = localStorage.getItem(PARTICIPANT_KEY);
  if (!token) {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      token = `local-${globalThis.crypto.randomUUID()}`;
    } else {
      const bytes = new Uint8Array(18);
      globalThis.crypto.getRandomValues(bytes);
      token = `local-${[...bytes].map((value) =>
        value.toString(16).padStart(2, "0")
      ).join("")}`;
    }
    localStorage.setItem(PARTICIPANT_KEY, token);
  }
  return token;
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const value = await response.json();
  if (!response.ok) {
    const message = Array.isArray(value.error)
      ? value.error.join("; ")
      : value.error ?? `HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return value;
}

function stopCurrentAudio() {
  if (!state.currentAudio) {
    return;
  }
  state.currentAudio.pause();
  state.currentAudio.currentTime = 0;
  state.currentAudio.closest(".audio-option")?.setAttribute(
    "data-playing",
    "false"
  );
  state.currentAudio = null;
}

function playbackKey(sceneId, optionId) {
  return `${sceneId}/${optionId}`;
}

function currentScene() {
  return state.session?.scenes[state.sceneIndex] ?? null;
}

function currentResponse() {
  return state.responses.get(currentScene()?.sceneId) ?? null;
}

function allOptionsCompleted(scene = currentScene()) {
  return Boolean(scene) && scene.options.every((option) =>
    (state.playbackCounts.get(
      playbackKey(scene.sceneId, option.optionId)
    ) ?? 0) >= 1
  );
}

function preferenceAnswered(response) {
  return Boolean(response) && (
    response.uncertain || response.selectedOptionIds.length > 0
  );
}

function sceneReady() {
  const response = currentResponse();
  return allOptionsCompleted() &&
    preferenceAnswered(response) &&
    SPEAKER_RELEVANCE.includes(response?.speakerRelevance) &&
    Number.isSafeInteger(response?.confidence);
}

function ensureResponse(scene = currentScene()) {
  if (!scene) {
    return null;
  }
  if (!state.responses.has(scene.sceneId)) {
    state.responses.set(scene.sceneId, {
      sceneId: scene.sceneId,
      selectedOptionIds: [],
      uncertain: false,
      speakerRelevance: null,
      confidence: null,
      reasonTags: [],
      comment: null
    });
  }
  return state.responses.get(scene.sceneId);
}

function updateReadiness() {
  const unlocked = allOptionsCompleted();
  elements.choicePanel.disabled = !unlocked;
  elements.relevancePanel.disabled = !unlocked;
  elements.confidencePanel.disabled = !unlocked;
  elements.reasonPanel.disabled = !unlocked;
  elements.commentPanel.disabled = !unlocked;
  elements.next.disabled = !sceneReady();
  const scene = currentScene();
  const response = currentResponse();
  if (!unlocked) {
    const heard = scene?.options.filter((option) =>
      (state.playbackCounts.get(
        playbackKey(scene.sceneId, option.optionId)
      ) ?? 0) >= 1
    ).length ?? 0;
    const remaining = (scene?.options.length ?? 0) - heard;
    elements.sceneHint.textContent =
      `Ouça ${remaining === 1 ? "a" : "as"} ${remaining} alternativa` +
      `${remaining === 1 ? "" : "s"} restante${remaining === 1 ? "" : "s"} ` +
      "por inteiro.";
  } else if (!preferenceAnswered(response)) {
    elements.sceneHint.textContent =
      "Escolha uma ou mais alternativas, ou marque que não consegue avaliar.";
  } else if (!SPEAKER_RELEVANCE.includes(response?.speakerRelevance)) {
    elements.sceneHint.textContent =
      "Diga se a fala ou o som parece dirigido à assistente.";
  } else if (!Number.isSafeInteger(response?.confidence)) {
    elements.sceneHint.textContent = "Marque seu nível de confiança.";
  } else {
    elements.sceneHint.textContent = "Resposta pronta para avançar.";
  }
}

function audioOption(scene, option) {
  const card = document.createElement("section");
  card.className = "audio-option";
  card.dataset.optionId = option.optionId;
  const key = playbackKey(scene.sceneId, option.optionId);
  const completed = (state.playbackCounts.get(key) ?? 0) >= 1;
  card.dataset.completed = String(completed);
  card.dataset.playing = "false";

  const title = document.createElement("h3");
  title.textContent = option.displayLabel;
  const audio = document.createElement("audio");
  audio.preload = "metadata";
  audio.src = option.audioUrl;
  audio.dataset.optionId = option.optionId;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "listen-button";
  button.textContent = "▶ Ouvir do início";
  const progress = document.createElement("div");
  progress.className = "audio-progress";
  progress.setAttribute("aria-hidden", "true");
  const progressFill = document.createElement("span");
  progress.append(progressFill);
  const status = document.createElement("span");
  status.className = "listen-state";
  status.textContent = completed ? "✓ ouvido por inteiro" : "ainda não concluído";

  button.addEventListener("click", async () => {
    stopCurrentAudio();
    audio.currentTime = 0;
    state.currentAudio = audio;
    card.dataset.playing = "true";
    button.textContent = "Reproduzindo…";
    try {
      await audio.play();
    } catch (error) {
      card.dataset.playing = "false";
      button.textContent = "▶ Tentar novamente";
      state.currentAudio = null;
      elements.sceneHint.textContent = `Áudio indisponível: ${error.message}`;
    }
  });
  audio.addEventListener("timeupdate", () => {
    const ratio = Number.isFinite(audio.duration) && audio.duration > 0
      ? Math.min(1, audio.currentTime / audio.duration)
      : 0;
    progressFill.style.width = `${ratio * 100}%`;
  });
  audio.addEventListener("ended", () => {
    state.playbackCounts.set(key, (state.playbackCounts.get(key) ?? 0) + 1);
    state.currentAudio = null;
    card.dataset.playing = "false";
    card.dataset.completed = "true";
    progressFill.style.width = "100%";
    button.textContent = "↻ Ouvir novamente";
    status.textContent = "✓ ouvido por inteiro";
    updateReadiness();
  });
  audio.addEventListener("pause", () => {
    if (!audio.ended) {
      card.dataset.playing = "false";
      button.textContent = "▶ Ouvir do início";
      progressFill.style.width = "0%";
    }
  });
  card.append(title, audio, button, progress, status);
  return card;
}

function renderPreferences(scene, response) {
  elements.choiceGrid.replaceChildren(...scene.options.map((option) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "preferenceOption";
    input.value = option.optionId;
    input.checked = response.selectedOptionIds.includes(option.optionId);
    const text = document.createElement("span");
    text.textContent = `Alternativa ${option.displayLabel}`;
    input.addEventListener("change", () => {
      response.selectedOptionIds = [...elements.choiceGrid.querySelectorAll(
        'input[name="preferenceOption"]:checked'
      )].map((entry) => entry.value);
      if (response.selectedOptionIds.length > 0) {
        response.uncertain = false;
        elements.uncertain.checked = false;
      }
      updateReadiness();
    });
    label.append(input, text);
    return label;
  }));
  elements.uncertain.checked = response.uncertain;
  elements.uncertain.onchange = () => {
    response.uncertain = elements.uncertain.checked;
    if (response.uncertain) {
      response.selectedOptionIds = [];
      for (const input of elements.choiceGrid.querySelectorAll("input")) {
        input.checked = false;
      }
    }
    updateReadiness();
  };
}

function renderScene() {
  stopCurrentAudio();
  const scene = currentScene();
  if (!scene) {
    return;
  }
  ensureResponse(scene);
  const response = currentResponse();
  const total = state.session.scenes.length;
  const completed = state.sceneIndex;
  elements.progressLabel.textContent =
    `SITUAÇÃO ${state.sceneIndex + 1} DE ${total}`;
  elements.completionLabel.textContent =
    `${completed} concluída${completed === 1 ? "" : "s"}`;
  elements.campaignHeading.textContent = scene.options.length === 2
    ? "Ouça as duas alternativas."
    : "Ouça as três alternativas.";
  elements.progressTrack.setAttribute("aria-valuemax", String(total));
  elements.progressTrack.setAttribute("aria-valuenow", String(completed));
  elements.progressFill.style.width = `${completed / total * 100}%`;
  elements.optionGrid.replaceChildren(
    ...scene.options.map((option) => audioOption(scene, option))
  );
  renderPreferences(scene, response);

  for (const input of document.querySelectorAll(
    'input[name="speakerRelevance"]'
  )) {
    input.checked = input.value === response.speakerRelevance;
    input.onchange = () => {
      response.speakerRelevance = input.value;
      updateReadiness();
    };
  }
  for (const input of document.querySelectorAll('input[name="confidence"]')) {
    input.checked = Number(input.value) === response.confidence;
    input.onchange = () => {
      response.confidence = Number(input.value);
      updateReadiness();
    };
  }
  elements.reasonGrid.replaceChildren(...REASONS.map(([value, labelText]) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = value;
    input.checked = response.reasonTags.includes(value);
    input.addEventListener("change", () => {
      response.reasonTags = [...elements.reasonGrid.querySelectorAll(
        'input[type="checkbox"]:checked'
      )].map((entry) => entry.value);
    });
    const text = document.createElement("span");
    text.textContent = labelText;
    label.append(input, text);
    return label;
  }));
  elements.comment.value = response.comment ?? "";
  elements.comment.oninput = () => {
    const value = elements.comment.value.trim();
    response.comment = value.length === 0 ? null : value;
  };
  elements.next.textContent = state.sceneIndex === total - 1
    ? "Concluir avaliação"
    : "Próxima situação";
  updateReadiness();
  document.querySelector("#sceneCard").focus?.({ preventScroll: true });
}

function setPhase(phase) {
  state.phase = phase;
  elements.intro.hidden = phase !== "intro";
  elements.campaign.hidden = phase !== "campaign" && phase !== "submitting";
  elements.result.hidden = phase !== "complete";
  elements.error.hidden = phase !== "error";
}

function showError(error) {
  stopCurrentAudio();
  state.lastError = error.message;
  elements.errorMessage.textContent = error.status === 409
    ? "Este navegador já concluiu o pack atual. Para preservar a unidade por " +
      "participante, uma segunda resposta não foi criada."
    : error.message;
  setPhase("error");
}

async function startCampaign() {
  if (!state.participantRole) {
    return;
  }
  elements.start.disabled = true;
  elements.retry.disabled = true;
  try {
    const session = await requestJson("/api/session", {
      method: "POST",
      body: JSON.stringify({
        participantToken: participantToken(),
        participantRole: state.participantRole
      })
    });
    if (!Array.isArray(session.scenes) || session.scenes.length === 0) {
      throw new Error("A sessão não contém situações válidas.");
    }
    state.session = session;
    state.sceneIndex = 0;
    state.responses.clear();
    state.playbackCounts.clear();
    state.lastError = null;
    setPhase("campaign");
    renderScene();
  } catch (error) {
    showError(error);
  } finally {
    elements.start.disabled = state.participantRole === null;
    elements.retry.disabled = false;
  }
}

function submission() {
  return {
    schemaVersion: "timing-calibration-submission-v2",
    sessionId: state.session.sessionId,
    packSha256: state.session.packSha256,
    responses: state.session.scenes.map((scene) => {
      const response = state.responses.get(scene.sceneId);
      return {
        ...response,
        playbacks: scene.options.map((option) => ({
          optionId: option.optionId,
          completed: state.playbackCounts.get(
            playbackKey(scene.sceneId, option.optionId)
          ) ?? 0
        }))
      };
    })
  };
}

async function advance() {
  if (!sceneReady() || state.phase !== "campaign") {
    return;
  }
  if (state.sceneIndex < state.session.scenes.length - 1) {
    state.sceneIndex += 1;
    renderScene();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  setPhase("submitting");
  elements.next.disabled = true;
  elements.next.textContent = "Registrando…";
  try {
    const accepted = await requestJson("/api/annotations", {
      method: "POST",
      body: JSON.stringify(submission())
    });
    elements.resultDetails.replaceChildren();
    const details = [
      ["Registro", accepted.annotationId],
      ["Avaliações externas neste pack", String(
        accepted.externalParticipants
      )]
    ];
    for (const [term, description] of details) {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = term;
      dd.textContent = description;
      elements.resultDetails.append(dt, dd);
    }
    setPhase("complete");
  } catch (error) {
    showError(error);
  }
}

for (const input of document.querySelectorAll(
  'input[name="participantRole"]'
)) {
  input.addEventListener("change", () => {
    state.participantRole = input.value;
    elements.start.disabled = false;
  });
}
elements.start.addEventListener("click", startCampaign);
elements.retry.addEventListener("click", () => {
  setPhase("intro");
});
elements.next.addEventListener("click", advance);

window.__duplexCalibration = Object.freeze({
  snapshot() {
    const scene = currentScene();
    const response = currentResponse();
    return Object.freeze({
      schemaVersion: "timing-calibration-browser-snapshot-v2",
      ready: true,
      phase: state.phase,
      participantRole: state.participantRole,
      packId: state.session?.packId ?? null,
      packSha256: state.session?.packSha256 ?? null,
      sceneCount: state.session?.scenes.length ?? 0,
      sessionOptionCounts: state.session?.scenes.map(
        (entry) => entry.options.length
      ) ?? [],
      currentSceneIndex: state.session ? state.sceneIndex : null,
      optionCount: scene?.options.length ?? 0,
      completedOptions: scene?.options.filter((option) =>
        (state.playbackCounts.get(
          playbackKey(scene.sceneId, option.optionId)
        ) ?? 0) >= 1
      ).length ?? 0,
      selectedOptionCount: response?.selectedOptionIds.length ?? 0,
      speakerRelevanceAnswered: SPEAKER_RELEVANCE.includes(
        response?.speakerRelevance
      ),
      sceneReady: sceneReady(),
      lastError: state.lastError
    });
  }
});

setPhase("intro");
