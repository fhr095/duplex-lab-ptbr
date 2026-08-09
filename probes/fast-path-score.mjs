// Placar da arbitragem no conjunto rotulado (probes/data/fastpath-turns).
//
// Mede a decisão do SISTEMA (kernel + planner + arbitragem), não só a regex:
//   safety com confirmação  → CLARIFY
//   mode delegate           → BRIDGE (acknowledgment imediato)
//   demais                  → arbitrateTurn (LOCAL_FINAL | BRIDGE | PASS)
// Contexto, quando presente, é despachado antes no mesmo kernel de sessão.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createLocalBrain } from "../src/brain/local-brain.mjs";
import { arbitrateTurn } from "../src/interaction/fast-path.mjs";
import {
  createTurnCoordinator
} from "../src/interaction/turn-coordinator.mjs";

const dataPath = resolve(
  import.meta.dirname, "data/fastpath-turns.pt-BR.json"
);
const { turns } = JSON.parse(await readFile(dataPath, "utf8"));

function systemDecision(item, index) {
  const coordinator = createTurnCoordinator({
    planner: createLocalBrain()
  });
  const sessionId = `score-${index}`;
  if (item.context) {
    coordinator.planTurn({
      sessionId,
      turnId: "ctx",
      text: item.context
    });
  }
  const plan = coordinator.planTurn({
    sessionId,
    turnId: "alvo",
    text: item.text
  });
  if (plan.safety?.confirmationRequired) {
    return { action: "CLARIFY", class: "kernel-confirmation" };
  }
  if (plan.mode === "delegate") {
    return { action: "BRIDGE", class: "delegacao" };
  }
  return arbitrateTurn({ text: item.text, plan });
}

const matrix = new Map();
const errors = [];
for (const [index, item] of turns.entries()) {
  const decision = systemDecision(item, index);
  const key = `${item.label}→${decision.action}`;
  matrix.set(key, (matrix.get(key) ?? 0) + 1);
  if (decision.action !== item.label) {
    errors.push({ ...item, got: decision.action, class: decision.class });
  }
}

const labels = ["LOCAL_FINAL", "BRIDGE", "CLARIFY", "PASS"];
console.log(`n=${turns.length}`);
for (const label of labels) {
  const truePositive = matrix.get(`${label}→${label}`) ?? 0;
  const labeled = turns.filter((item) => item.label === label).length;
  const predicted = labels.reduce(
    (sum, other) => sum + (matrix.get(`${other}→${label}`) ?? 0), 0
  );
  const recall = labeled ? (truePositive / labeled * 100).toFixed(0) : "–";
  const precision = predicted
    ? (truePositive / predicted * 100).toFixed(0)
    : "–";
  console.log(
    `${label.padEnd(11)} rotulados=${String(labeled).padStart(2)} ` +
    `precisão=${precision}% recall=${recall}%`
  );
}
console.log(`\nacurácia global: ${(
  (turns.length - errors.length) / turns.length * 100
).toFixed(1)}%`);
console.log("\nerros:");
for (const error of errors) {
  console.log(
    `  «${error.text}» rótulo=${error.label} decisão=${error.got}` +
    (error.class ? ` (${error.class})` : "") +
    (error.context ? ` [ctx: ${error.context}]` : "")
  );
}
