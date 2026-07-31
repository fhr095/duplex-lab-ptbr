const DEFAULTS = Object.freeze({
  ackSpeechDurationMs: 900,
  backchannelDelayMs: 120,
  bargeInStopDelayMs: 80,
  cancelDelayMs: 20,
  delegatedAckDelayMs: 220,
  delegationDelayMs: 60,
  directSpeechDurationMs: 1_600,
  minSpeechBeforeBackchannelMs: 650,
  responseStartDelayMs: 280,
  resultSpeechDurationMs: 1_600,
  rollbackDelayMs: 10,
  seededSpeechDurationMs: 10_000
});

function schedule(key, type, atMs, payload = {}) {
  return {
    kind: "schedule",
    key,
    event: { type, atMs, payload }
  };
}

function cancel(key) {
  return { kind: "cancel", key };
}

function needsDelegation(text) {
  return /\b(pesquis\w*|compar\w*|investig\w*|verifi\w*|busqu\w*|descubr\w*|calcule?|analise aprofundad\w*)\b/iu.test(
    text
  );
}

function directResponse(text) {
  if (/\b(oi|olá|bom dia|boa tarde|boa noite)\b/iu.test(text)) {
    return "Oi! Estou te ouvindo. Pode falar no seu ritmo.";
  }

  if (/\b(não|corrig|na verdade)\b/iu.test(text)) {
    return "Entendi a correção. Vou considerar apenas a última versão.";
  }

  return "Entendi. Vou seguir a partir do que você acabou de dizer.";
}

export class BaselineInteractionPolicy {
  constructor(config = {}) {
    this.config = { ...DEFAULTS, ...config };
    this.reset();
  }

  reset() {
    this.assistantSpeaking = false;
    this.userSpeaking = false;
    this.userSpeechStartedAtMs = null;
    this.latestTranscript = "";
    this.backchannelGiven = false;
    this.activeTaskId = null;
    this.pendingTaskResult = null;
    this.taskSequence = 0;
  }

  schedulePendingResult(atMs) {
    if (!this.pendingTaskResult || this.userSpeaking || this.assistantSpeaking) {
      return [];
    }
    return [
      schedule(
        "assistant-result",
        "assistant.speech.started",
        atMs + 100,
        {
          durationMs: this.config.resultSpeechDurationMs,
          kind: "delegated-result",
          taskId: this.pendingTaskResult.taskId,
          text: this.pendingTaskResult.summary ?? "O resultado chegou."
        }
      )
    ];
  }

  onEvent(event) {
    const commands = [];

    switch (event.type) {
      case "assistant.speech.started": {
        this.assistantSpeaking = true;
        if (event.payload?.kind === "delegated-result") {
          this.pendingTaskResult = null;
        }
        const durationMs =
          event.payload?.durationMs ?? this.config.seededSpeechDurationMs;
        commands.push(
          schedule(
            "assistant-finish",
            "assistant.speech.finished",
            event.atMs + durationMs,
            { reason: "completed" }
          )
        );
        break;
      }

      case "assistant.speech.finished":
        this.assistantSpeaking = false;
        commands.push(...this.schedulePendingResult(event.atMs));
        break;

      case "assistant.speech.stopped":
        this.assistantSpeaking = false;
        commands.push(cancel("assistant-finish"));
        break;

      case "user.speech.started":
        this.userSpeaking = true;
        this.userSpeechStartedAtMs = event.atMs;
        this.backchannelGiven = false;
        commands.push(cancel("assistant-response"));
        commands.push(cancel("assistant-result"));
        commands.push(cancel("backchannel"));
        if (this.assistantSpeaking) {
          commands.push(cancel("assistant-finish"));
          commands.push(
            schedule(
              "assistant-stop",
              "assistant.speech.stopped",
              event.atMs + this.config.bargeInStopDelayMs,
              { reason: "barge-in" }
            )
          );
        }
        break;

      case "user.speech.paused":
      case "user.hesitation": {
        const speechDuration =
          this.userSpeechStartedAtMs === null
            ? 0
            : event.atMs - this.userSpeechStartedAtMs;
        if (
          this.userSpeaking &&
          !this.backchannelGiven &&
          speechDuration >= this.config.minSpeechBeforeBackchannelMs
        ) {
          this.backchannelGiven = true;
          commands.push(
            schedule(
              "backchannel",
              "assistant.backchannel",
              event.atMs + this.config.backchannelDelayMs,
              { text: "aham", reason: "hesitation" }
            )
          );
        }
        break;
      }

      case "user.speech.resumed":
        commands.push(cancel("backchannel"));
        break;

      case "user.transcript.final":
        this.latestTranscript = event.payload?.text?.trim() ?? "";
        break;

      case "user.correction": {
        const current = event.payload?.current?.trim() ?? "";
        if (current) {
          this.latestTranscript = current;
        }
        commands.push(
          schedule(
            `rollback-${event.atMs}`,
            "state.rollback",
            event.atMs + this.config.rollbackDelayMs,
            {
              previous: event.payload?.previous ?? null,
              current: event.payload?.current ?? null
            }
          )
        );
        break;
      }

      case "user.speech.ended": {
        this.userSpeaking = false;
        commands.push(cancel("backchannel"));
        const text = this.latestTranscript;

        if (needsDelegation(text)) {
          const taskId = `task-${++this.taskSequence}`;
          commands.push(
            schedule(
              `delegate-${taskId}`,
              "task.delegated",
              event.atMs + this.config.delegationDelayMs,
              { taskId, query: text }
            )
          );
          commands.push(
            schedule(
              "assistant-response",
              "assistant.speech.started",
              event.atMs + this.config.delegatedAckDelayMs,
              {
                durationMs: this.config.ackSpeechDurationMs,
                kind: "acknowledgment",
                text: "Entendi. Vou verificar isso enquanto continuamos."
              }
            )
          );
        } else {
          commands.push(
            schedule(
              "assistant-response",
              "assistant.speech.started",
              event.atMs + this.config.responseStartDelayMs,
              {
                durationMs: this.config.directSpeechDurationMs,
                kind: "direct",
                text: directResponse(text)
              }
            )
          );
        }
        break;
      }

      case "task.delegated":
        this.activeTaskId = event.payload?.taskId ?? null;
        break;

      case "user.cancelled":
        commands.push(cancel("assistant-response"));
        commands.push(cancel("assistant-result"));
        if (this.activeTaskId) {
          commands.push(
            schedule(
              `cancel-${this.activeTaskId}`,
              "task.cancelled",
              event.atMs + this.config.cancelDelayMs,
              { taskId: this.activeTaskId, reason: "user-cancelled" }
            )
          );
        }
        break;

      case "task.cancelled":
        if (event.payload?.taskId === this.activeTaskId) {
          this.activeTaskId = null;
        }
        if (event.payload?.taskId === this.pendingTaskResult?.taskId) {
          this.pendingTaskResult = null;
        }
        break;

      case "task.result":
        this.pendingTaskResult = {
          taskId: event.payload?.taskId ?? this.activeTaskId,
          summary: event.payload?.summary ?? "O resultado chegou."
        };
        commands.push(...this.schedulePendingResult(event.atMs));
        this.activeTaskId = null;
        break;

      default:
        break;
    }

    return commands;
  }
}
