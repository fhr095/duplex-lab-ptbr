import {
  EXP0025_R_ACTIONS,
  EXP0025_R_SENTINELS,
  EXP0025_R_TOKENS,
  interpretDuplexCascadeOutput
} from "./exp-0025-r-floor-control.mjs";

const SPECIAL_TOKEN_PATTERN = /^<\|[^|]+\|>/u;

export const EXP0025_R_OFFICIAL_RUNTIME_BINDING = Object.freeze({
  commit: "42893024ca90c8de8ac3ed624467ebc123512ff8",
  path: "server.py",
  sha256: "404a1b6f51e87c012e1111cc21a712ed8895e9a5ee99328bd1245a7c6a654037",
  rule:
    "assistant speaking + user talking/interruption both reset TTS"
});

export function interpretDuplexCascadeOfficialRuntime(input = {}) {
  const assistantSpeaking = input.assistantSpeaking === true;
  const output = String(input.output ?? "").trim();
  const token = SPECIAL_TOKEN_PATTERN.exec(output)?.[0] ?? null;
  if (assistantSpeaking && token === EXP0025_R_TOKENS.userTalking) {
    return Object.freeze({
      status: "ACTION",
      action: EXP0025_R_ACTIONS.yieldFloor,
      reason: "OFFICIAL_SERVER_RESETS_TTS_FOR_USER_TALKING",
      token,
      text: null
    });
  }
  return interpretDuplexCascadeOutput(input);
}

export function evaluateDuplexCascadeOfficialRuntimeSentinels(observations) {
  const byId = new Map((observations ?? []).map((item) => [item?.id, item]));
  const results = EXP0025_R_SENTINELS.map((sentinel) => {
    const observation = byId.get(sentinel.id);
    const interpreted = interpretDuplexCascadeOfficialRuntime({
      assistantSpeaking: sentinel.assistantSpeaking,
      output: observation?.output
    });
    return Object.freeze({
      ...sentinel,
      output: observation?.output ?? null,
      observedAction: interpreted.action,
      reason: interpreted.reason,
      pass: interpreted.action === sentinel.expectedAction
    });
  });
  const complete = byId.size === EXP0025_R_SENTINELS.length &&
    EXP0025_R_SENTINELS.every((sentinel) => byId.has(sentinel.id));
  const pass = complete && results.every((item) => item.pass);
  return Object.freeze({
    status: pass ? "PASS" : "E_PROTOCOL_FAILURE",
    complete,
    passed: results.filter((item) => item.pass).length,
    expected: EXP0025_R_SENTINELS.length,
    results: Object.freeze(results),
    officialRuntimeBinding: EXP0025_R_OFFICIAL_RUNTIME_BINDING
  });
}
