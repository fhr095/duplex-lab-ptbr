import {
  extractPtBrCurrencyAmounts
} from "../../interaction/ptbr-number.mjs";

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function semanticValueInText(text, value) {
  const normalizedText = ` ${normalizeText(text)} `;
  const normalizedValue = normalizeText(value);
  if (normalizedValue.startsWith("brl ")) {
    const expected = extractPtBrCurrencyAmounts(
      `R$ ${String(value).replace(/^BRL\s*/iu, "")}`
    )[0]?.value;
    if (!Number.isFinite(expected)) {
      return false;
    }
    const extracted = extractPtBrCurrencyAmounts(text);
    if (extracted.some((item) => item.value === expected)) {
      return true;
    }
    const integer = Number.isInteger(expected) ? String(expected) : null;
    return integer !== null &&
      normalizedText.includes(` brl ${integer} `);
  }
  if (/^\d{1,2}:\d{2}$/u.test(value)) {
    const [hour, minute] = value.split(":");
    const normalizedSource = String(text)
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase("pt-BR");
    const numericHour = Number(hour);
    const numericMinute = Number(minute);
    const exactClock = new RegExp(
      `\\b0?${numericHour}\\s*:\\s*${String(numericMinute).padStart(2, "0")}\\b`,
      "u"
    );
    const spoken = numericMinute === 0
      ? new RegExp(`\\b0?${numericHour}\\s*(?:h\\b|horas?\\b)`, "u")
      : new RegExp(
        `\\b0?${numericHour}\\s*(?:h|horas?(?:\\s+e)?)\\s*0?${numericMinute}\\b`,
        "u"
      );
    return exactClock.test(normalizedSource) || spoken.test(normalizedSource);
  }
  return normalizedValue.length > 0 &&
    normalizedText.includes(` ${normalizedValue} `);
}

function assistantAffirmsValue(text, value, obsolete) {
  const affirmative = /\b(?:vou|vamos|irei|iremos|considero|considerar|confirmo|confirmado|confirmada|manterei|manter|usarei|usar|fica|ficou|agendado|agendada|reservado|reservada|transferirei|transferir|corrigido|corrigida)\b/u;
  const negative = /\b(?:nao|nunca|jamais|recusad[oa]s?|cancelad[oa]s?|incorret[oa]s?|invalid[oa]s?)\b/u;
  const segments = String(text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .split(/[.;!?]+|\b(?:mas|porem|contudo)\b/gu);
  for (const segment of segments.toReversed()) {
    if (!affirmative.test(segment)) {
      continue;
    }
    const hasCurrent = semanticValueInText(segment, value);
    const hasObsolete = semanticValueInText(segment, obsolete);
    if (!hasCurrent && !hasObsolete) {
      continue;
    }
    return hasCurrent && !hasObsolete && !negative.test(segment);
  }
  return false;
}

function check(id, status, detail, severity = "critical") {
  return { id, severity, status, pass: status === "pass", detail };
}

function measuredArray(observation, field) {
  return Object.hasOwn(observation, field) && Array.isArray(observation[field]);
}

export function assessCorrectionObservation(definition, observation) {
  if (definition?.oracle?.ref !== "correction-last-value-wins@1") {
    throw new TypeError(`oráculo não suportado: ${definition?.oracle?.ref}`);
  }
  if (!observation || typeof observation !== "object") {
    throw new TypeError("observation deve ser um objeto");
  }
  const { slot, obsolete, current, allowProvisionalEffect } =
    definition.oracle.args;
  const checks = [];

  if (typeof observation.finalTranscript !== "string") {
    checks.push(
      check("final-transcript-current", "unmeasured", "transcrição final ausente")
    );
  } else {
    const pass = semanticValueInText(observation.finalTranscript, current);
    checks.push(
      check(
        "final-transcript-current",
        pass ? "pass" : "fail",
        pass ? "slot atual preservado na transcrição" : "slot atual ausente da transcrição"
      )
    );
  }

  if (!observation.semanticState) {
    checks.push(
      check("final-semantic-state", "unmeasured", "estado semântico não instrumentado")
    );
  } else {
    const pass =
      observation.semanticState.slot === slot &&
      normalizeText(observation.semanticState.value) === normalizeText(current) &&
      typeof observation.semanticState.revisionId === "string";
    checks.push(
      check(
        "final-semantic-state",
        pass ? "pass" : "fail",
        pass
          ? `estado final=${current}`
          : `estado final=${observation.semanticState.value ?? "ausente"}`
      )
    );
  }

  if (!observation.rollback || !observation.semanticState) {
    checks.push(
      check(
        "causal-rollback",
        "unmeasured",
        "rollback causal ou estado semântico não instrumentado"
      )
    );
  } else {
    const pass =
      observation.rollback.slot === slot &&
      normalizeText(observation.rollback.previous) === normalizeText(obsolete) &&
      normalizeText(observation.rollback.current) === normalizeText(current) &&
      typeof observation.rollback.revisionId === "string" &&
      observation.rollback.revisionId === observation.semanticState?.revisionId;
    checks.push(
      check(
        "causal-rollback",
        pass ? "pass" : "fail",
        pass
          ? "rollback referencia revisão, slot e valores corretos"
          : "rollback não prova a transição causal esperada"
      )
    );
  }

  if (!Number.isInteger(observation.commitCount)) {
    checks.push(check("single-commit", "unmeasured", "contagem de commits ausente"));
  } else {
    checks.push(
      check(
        "single-commit",
        observation.commitCount === 1 ? "pass" : "fail",
        `${observation.commitCount} commit(s) observados`
      )
    );
  }

  if (!Number.isInteger(observation.revisionCount)) {
    checks.push(
      check(
        "single-semantic-revision",
        "unmeasured",
        "contagem de revisões semânticas ausente"
      )
    );
  } else {
    checks.push(
      check(
        "single-semantic-revision",
        observation.revisionCount === 1 ? "pass" : "fail",
        `${observation.revisionCount} revisão(ões) semântica(s) observada(s)`
      )
    );
  }

  if (
    !measuredArray(observation, "userSpeechIntervals") ||
    !measuredArray(observation, "assistantSpeechStartsAtMs")
  ) {
    checks.push(
      check("no-premature-main-speech", "unmeasured", "timeline de fala incompleta")
    );
  } else {
    const validIntervals = observation.userSpeechIntervals.every(
      (interval) =>
        Number.isFinite(interval?.startAtMs) &&
        Number.isFinite(interval?.endAtMs) &&
        interval.startAtMs <= interval.endAtMs
    );
    const premature = observation.assistantSpeechStartsAtMs.filter(
      (atMs) => observation.userSpeechIntervals.some(
        (interval) =>
          Number.isFinite(interval?.startAtMs) &&
          Number.isFinite(interval?.endAtMs) &&
          atMs >= interval.startAtMs && atMs < interval.endAtMs
      )
    );
    checks.push(
      check(
        "no-premature-main-speech",
        validIntervals && premature.length === 0 ? "pass" : "fail",
        validIntervals && premature.length === 0
          ? "nenhuma fala principal antes do fim real"
          : !validIntervals
            ? "intervalo de fala aberto ou inválido"
            : `fala principal precoce em ${premature.join(", ")} ms`
      )
    );
  }

  if (
    !Number.isFinite(observation.userSpeechEndedAtMs) ||
    !Number.isFinite(observation.commitAtMs) ||
    !Number.isFinite(observation.rollbackAtMs) ||
    !measuredArray(observation, "assistantSpeechStartsAtMs")
  ) {
    checks.push(
      check("causal-event-order", "unmeasured", "ordem causal incompleta")
    );
  } else {
    const firstAssistant = observation.assistantSpeechStartsAtMs.length > 0
      ? Math.min(...observation.assistantSpeechStartsAtMs)
      : Infinity;
    const pass =
      observation.userSpeechStartedAtMs <= observation.userSpeechEndedAtMs &&
      observation.userSpeechEndedAtMs <= observation.commitAtMs &&
      observation.commitAtMs <= observation.rollbackAtMs &&
      observation.rollbackAtMs <= firstAssistant;
    checks.push(
      check(
        "causal-event-order",
        pass ? "pass" : "fail",
        pass
          ? "início ≤ fim do usuário ≤ commit ≤ rollback ≤ resposta"
          : "resposta ou transição ocorreu fora da ordem causal"
      )
    );
  }

  if (typeof observation.assistantText !== "string") {
    checks.push(
      check("assistant-confirms-current", "unmeasured", "texto do assistente ausente")
    );
  } else {
    const pass = assistantAffirmsValue(
      observation.assistantText,
      current,
      obsolete
    );
    checks.push(
      check(
        "assistant-confirms-current",
        pass ? "pass" : "fail",
        pass
          ? "assistente confirma o valor final"
          : "assistente não confirma o valor final"
      )
    );
  }

  if (
    !measuredArray(observation, "spokenUtterances") ||
    !observation.semanticState
  ) {
    checks.push(
      check(
        "audible-confirms-current",
        "unmeasured",
        "fala renderizada ou estado semântico não instrumentado"
      )
    );
  } else {
    const relevant = observation.spokenUtterances.filter(
      (utterance) =>
        utterance?.kind === "direct" &&
        utterance.semantic?.slot === slot &&
        utterance.semantic?.revisionId ===
          observation.semanticState?.revisionId
    );
    const confirmed = relevant.some(
      (utterance) =>
        normalizeText(utterance.semantic?.value) === normalizeText(current) &&
        assistantAffirmsValue(utterance.text, current, obsolete)
    );
    const stale = relevant.some(
      (utterance) =>
        normalizeText(utterance.semantic?.value) !== normalizeText(current) ||
        assistantAffirmsValue(utterance.text, obsolete, current)
    );
    const pass = confirmed && !stale;
    checks.push(
      check(
        "audible-confirms-current",
        pass ? "pass" : "fail",
        pass
          ? "fala iniciada está ligada ao valor e à revisão finais"
          : "não há fala iniciada que prove valor e revisão finais"
      )
    );
  }


  if (!measuredArray(observation, "delegations")) {
    checks.push(
      check("no-obsolete-delegation", "unmeasured", "delegações não instrumentadas")
    );
  } else {
    const obsoleteDelegation = observation.delegations.find((delegation) =>
      semanticValueInText(delegation.detail, obsolete)
    );
    checks.push(
      check(
        "no-obsolete-delegation",
        obsoleteDelegation ? "fail" : "pass",
        obsoleteDelegation
          ? "delegação contém o valor obsoleto"
          : "nenhuma delegação contém o valor obsoleto"
      )
    );
  }

  if (!measuredArray(observation, "effects")) {
    checks.push(
      check("no-obsolete-effect", "unmeasured", "efeitos externos não instrumentados")
    );
  } else {
    const obsoleteEffect = observation.effects.find(
      (effect) =>
        effect.slot === slot &&
        normalizeText(effect.value) === normalizeText(obsolete)
    );
    const pass = allowProvisionalEffect || !obsoleteEffect;
    checks.push(
      check(
        "no-obsolete-effect",
        pass ? "pass" : "fail",
        pass ? "nenhum efeito usou o valor obsoleto" : "efeito usou o valor obsoleto"
      )
    );
  }

  const failures = checks.filter((item) => item.status === "fail");
  const unmeasured = checks.filter(
    (item) => item.status === "unmeasured" && item.severity === "critical"
  );
  return {
    oracle: definition.oracle.ref,
    decision: failures.length > 0 ? "fail" : unmeasured.length > 0 ? "hold" : "pass",
    checks,
    failures: failures.map((item) => item.id),
    unmeasured: unmeasured.map((item) => item.id)
  };
}

function clone(value) {
  return structuredClone(value);
}

export function runCorrectionOracleMutationAudit(definition, observation) {
  const { obsolete, current, slot } = definition.oracle.args;
  const mutants = [
    {
      id: "obsolete-semantic-state",
      mutate(value) {
        value.semanticState.value = obsolete;
      }
    },
    {
      id: "noncausal-rollback",
      mutate(value) {
        value.rollback = {};
      }
    },
    {
      id: "premature-main-speech",
      mutate(value) {
        value.assistantSpeechStartsAtMs.unshift(value.userSpeechEndedAtMs - 1);
      }
    },
    {
      id: "response-before-rollback",
      mutate(value) {
        value.assistantSpeechStartsAtMs = [value.rollbackAtMs - 1];
      }
    },
    {
      id: "rollback-before-commit",
      mutate(value) {
        value.rollbackAtMs = value.commitAtMs - 1;
      }
    },
    {
      id: "obsolete-effect",
      mutate(value) {
        value.effects.push({ slot, value: obsolete, status: "committed" });
      }
    },
    {
      id: "duplicate-commit",
      mutate(value) {
        value.commitCount = 2;
      }
    },
    {
      id: "duplicate-semantic-revision",
      mutate(value) {
        value.revisionCount = 2;
      }
    },
    {
      id: "lost-current-transcript",
      mutate(value) {
        value.finalTranscript = `Considere ${obsolete}.`;
      }
    },
    {
      id: "stale-assistant-confirmation",
      mutate(value) {
        value.assistantText = `Certo, vou considerar ${obsolete}.`;
      }
    },
    {
      id: "stale-audible-confirmation",
      mutate(value) {
        value.spokenUtterances = [{
          kind: "direct",
          text: `Vou considerar ${obsolete}.`,
          semantic: {
            slot,
            value: obsolete,
            revisionId: value.semanticState.revisionId
          }
        }];
      }
    },
    {
      id: "stale-before-correct",
      mutate(value) {
        value.spokenUtterances.unshift({
          kind: "direct",
          text: `Vou considerar ${obsolete}.`,
          semantic: {
            slot,
            value: current,
            revisionId: value.semanticState.revisionId
          }
        });
      }
    }
  ].map((mutant) => {
    const changed = clone(observation);
    mutant.mutate(changed);
    const assessment = assessCorrectionObservation(definition, changed);
    return {
      id: mutant.id,
      killed: assessment.decision === "fail",
      failures: assessment.failures
    };
  });

  const killed = mutants.filter((mutant) => mutant.killed).length;
  return {
    pass: killed === mutants.length,
    killed,
    total: mutants.length,
    mutants
  };
}
