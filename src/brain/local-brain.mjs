import { randomUUID } from "node:crypto";

import { analyzeCorrection } from "../interaction/correction-semantics.mjs";
import {
  planCriticalConfirmation
} from "../interaction/critical-confirmation.mjs";

function normalize(text) {
  return text.trim().replace(/\s+/gu, " ");
}

function requiresExternalWork(text) {
  return /\b(pesquis\w*|compar\w*|investig\w*|verifi\w*|busqu\w*|descubr\w*|calcule?|analise aprofundad\w*)\b/iu.test(
    text
  );
}

function spokenValue(value) {
  const normalized = String(value ?? "");
  if (normalized.startsWith("BRL ")) {
    return `R$ ${normalized.slice(4)}`;
  }
  if (/^\d{2}:\d{2}$/u.test(normalized)) {
    const [hour, minute] = normalized.split(":");
    return minute === "00" ? `${Number(hour)} horas` : `${hour}:${minute}`;
  }
  return normalized;
}

function directAnswer(text, semantic, safety) {
  if (/\b(oi|olá|bom dia|boa tarde|boa noite)\b/iu.test(text)) {
    return "Oi! Estou te ouvindo. Pode falar naturalmente e me interromper quando quiser.";
  }

  if (safety?.confirmationRequired) {
    return safety.prompt;
  }

  if (semantic?.correction) {
    return `Entendi a correção. Vou considerar ${spokenValue(
      semantic.correction.current
    )}.`;
  }

  if (/\b(como você funciona|o que é isso)\b/iu.test(text)) {
    return "Este é o primeiro laboratório da camada de interação. A inteligência ainda é simulada, mas interrupção, tempos e eventos já são medidos.";
  }

  return `Entendi: “${text}”. Neste primeiro corte eu valido o ritmo da conversa; o próximo adaptador poderá enviar o conteúdo para qualquer LLM.`;
}

export function createLocalBrain(options = {}) {
  const idFactory = options.idFactory ?? randomUUID;
  const taskDelayMs = options.taskDelayMs ?? 2_200;

  return {
    planTurn(rawText) {
      const text = normalize(rawText ?? "");
      if (!text) {
        return {
          mode: "direct",
          response: "Não consegui entender. Pode repetir?"
        };
      }

      const correction = analyzeCorrection(text);
      const effectiveText = correction.effectiveText;
      const semantic = correction.isCorrection
        ? { correction: correction.correction }
        : { correction: null };
      const safety = planCriticalConfirmation(
        text,
        semantic.correction
      );

      if (safety) {
        return {
          mode: "direct",
          effectiveText,
          semantic,
          safety,
          response: directAnswer(effectiveText, semantic, safety)
        };
      }

      if (requiresExternalWork(effectiveText)) {
        return {
          mode: "delegate",
          effectiveText,
          semantic,
          acknowledgment:
            "Entendi. Vou trabalhar nisso em paralelo. Se mudar de ideia, pode me interromper.",
          task: {
            id: idFactory(),
            delayMs: taskDelayMs,
            query: effectiveText,
            simulated: true,
            result:
              "A tarefa simulada terminou. O contrato assíncrono funcionou; agora podemos substituir este mock por um LLM real sem mudar a camada de voz."
          }
        };
      }

      return {
        mode: "direct",
        effectiveText,
        semantic,
        response: directAnswer(effectiveText, semantic, safety)
      };
    }
  };
}
