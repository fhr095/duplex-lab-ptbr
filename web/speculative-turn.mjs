// Resposta especulativa (challenger exp/caminho-ouro).
//
// Mecanismo: quando o backend detecta pausa e publica o texto provisório
// (`endpoint.prefinal.started`), começamos a gerar a resposta do cérebro
// imediatamente, em paralelo com a verificação de silêncio e a final do ASR.
// Se a final confirmar o provisório, adotamos o stream já em andamento e
// cometemos o turno no kernel; se divergir ou a fala retomar, abortamos.
// O estado autoritativo do kernel nunca avança durante a especulação.

import { readNdjson } from "./stream-utils.mjs";

const STRIP_PATTERN = /[^\p{Letter}\p{Number}\s]/gu;

export function normalizeUtterance(text) {
  return String(text ?? "")
    .toLocaleLowerCase("pt-BR")
    .replace(STRIP_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

// Política v0: adoção exige igualdade após normalização de caixa/pontuação.
// Divergência de qualquer palavra é miss (a final tem autoridade semântica).
export function speculationMatches(finalText, provisionalText) {
  const finalNormalized = normalizeUtterance(finalText);
  const provisionalNormalized = normalizeUtterance(provisionalText);
  return finalNormalized.length > 0 &&
    finalNormalized === provisionalNormalized;
}

export class SpeculativeTurn {
  #aborted = false;
  #baseUrl;
  #controller = new AbortController();
  #done = false;
  #error = null;
  #fetchImpl;
  #queue = [];
  #waiters = [];

  provisionalText;
  sessionId;
  startedAtMs;
  baseStateVersion = null;
  firstDeltaAtMs = null;
  firstEventAtMs = null;
  turnId;

  constructor(options) {
    this.#baseUrl = options.baseUrl ?? "";
    // No navegador o fetch nativo exige this === window/undefined; guardar
    // a referência crua e chamá-la via this.#fetchImpl(...) invoca com
    // this = instância → "Illegal invocation" (Node/undici não valida, por
    // isso probes e testes nunca quebraram). Embrulhar preserva o binding.
    this.#fetchImpl = options.fetchImpl ??
      ((...argumentos) => fetch(...argumentos));
    this.provisionalText = options.text;
    this.sessionId = options.sessionId;
    this.turnId = options.turnId;
    this.startedAtMs = performance.now();
    void this.#run(options.history ?? []);
  }

  get aborted() {
    return this.#aborted;
  }

  get settled() {
    return this.#done || this.#aborted || this.#error !== null;
  }

  async #run(history) {
    try {
      const response = await this.#fetchImpl(`${this.#baseUrl}/api/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: this.provisionalText,
          history,
          sessionId: this.sessionId,
          turnId: this.turnId,
          stage: "speculative"
        }),
        signal: this.#controller.signal
      });
      if (!response.ok) {
        throw new Error(`especulação retornou HTTP ${response.status}`);
      }
      for await (const event of readNdjson(response)) {
        this.firstEventAtMs ??= performance.now();
        if (event.type === "route") {
          // Versão-base sobre a qual o plano foi especulado; o commit é
          // condicionado a ela (descarta se o runtime avançou no meio).
          this.baseStateVersion =
            event.interaction?.previousStateVersion ?? null;
        }
        if (event.type === "delta" && this.firstDeltaAtMs === null) {
          this.firstDeltaAtMs = performance.now();
        }
        this.#push(event);
      }
      this.#done = true;
      this.#push(null);
    } catch (error) {
      if (error.name === "AbortError") {
        this.#aborted = true;
      } else {
        this.#error = error;
      }
      this.#push(null);
    }
  }

  #push(event) {
    this.#queue.push(event);
    for (const waiter of this.#waiters.splice(0)) {
      waiter();
    }
  }

  abort() {
    if (!this.settled) {
      this.#controller.abort();
    }
    this.#aborted = true;
  }

  // Itera os eventos NDJSON já recebidos e os que ainda chegarão.
  async *events() {
    let index = 0;
    while (true) {
      if (index < this.#queue.length) {
        const event = this.#queue[index++];
        if (event === null) {
          if (this.#error) {
            throw this.#error;
          }
          return;
        }
        yield event;
        continue;
      }
      await new Promise((resolvePromise) => {
        this.#waiters.push(resolvePromise);
      });
    }
  }

  // Comete o turno no kernel autoritativo (idempotente por turnId) usando o
  // MESMO texto planejado especulativamente — obrigatório antes de adotar.
  // Retorna { ok, interaction?, reason? }; ok:false significa que o estado
  // avançou desde a especulação e a adoção deve ser abandonada.
  async commit() {
    const response = await this.#fetchImpl(`${this.#baseUrl}/api/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: this.provisionalText,
        sessionId: this.sessionId,
        turnId: this.turnId,
        stage: "commit",
        expectedPreviousVersion: this.baseStateVersion ?? undefined
      })
    });
    if (!response.ok) {
      throw new Error(`commit retornou HTTP ${response.status}`);
    }
    for await (const event of readNdjson(response)) {
      if (event.type === "committed") {
        return event.ok === false
          ? { ok: false, reason: event.reason ?? "commit-rejected" }
          : { ok: true, interaction: event.interaction };
      }
    }
    throw new Error("commit terminou sem evento committed");
  }
}
