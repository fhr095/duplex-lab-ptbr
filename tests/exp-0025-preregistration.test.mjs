import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainPath = new URL(
  "../docs/experiments/EXP-0025-causal-render-onset-physical-stop.md",
  import.meta.url
);
const researchPath = new URL(
  "../docs/experiments/EXP-0025-R-duplexcascade-floor-control.md",
  import.meta.url
);

async function text(path) {
  return readFile(path, "utf8");
}

function requiresAll(document, fragments) {
  for (const fragment of fragments) {
    assert.ok(
      document.includes(fragment),
      `pré-registro perdeu fragmento obrigatório: ${fragment}`
    );
  }
}

test("EXP-0025 limita o constructo ao renderer e termina a linhagem", async () => {
  const document = await text(mainPath);
  assert.match(document, /^# EXP-0025 —/u);
  requiresAll(document, [
    "STOP renderizado (`STOP-R`)",
    "STOP audível (`STOP-A`)",
    "não é o último som audível na sala",
    "A unidade primária é um **STOP individual** (`n=12`)",
    "### I-R — validade causal mínima de STOP-R",
    "### P — proveniência e diagnósticos não bloqueantes",
    "apagam 12 resultados STOP-R causalmente completos",
    "Network.getResponseBody",
    "### S — STOP renderizado, primário",
    "### A — delta da âncora, instrumental",
    "### O — ordem de telemetria, secundário",
    "CUT_RENDER_STOP_INSTRUMENT_LINEAGE",
    "PASS_RENDER_STOP_HOLD_TELEMETRY_ORDER",
    "PASS_RENDER_STOP_AND_TELEMETRY_ORDER_EQUIVALENT",
    "deadline total do supervisor: **600.000 ms**",
    "Todas as folhas são terminais para o EXP-0025"
  ]);
  assert.doesNotMatch(document, /permite afirmar.*último som audível/iu);
});

test("EXP-0025-R separa checkpoint externo de reprodução local", async () => {
  const document = await text(researchPath);
  assert.match(document, /^# EXP-0025-R —/u);
  requiresAll(document, [
    "### E — referência comportamental externa",
    "### L — reprodução local mínima",
    "42893024ca90c8de8ac3ed624467ebc123512ff8",
    "dca21cb1309bb533d80f5aa5600c7b0cc2c470e3",
    "f2826a00ceef68f0f2b946d945ecc0477ce4450c",
    "wait → CONTINUE_LISTENING",
    "commit → TAKE_FLOOR",
    "`A0@600` não é challenger",
    "`<|user backchannel|>` significa `KEEP_ASSISTANT_FLOOR`",
    "significa `YIELD_FLOOR`",
    "E_PROTOCOL_FAILURE",
    "PT_BR_TRANSFER_OR_CONTENT_SHIFT",
    "**desenvolvimento `D`:** 32 falas, 16 pares",
    "**holdout `H`:** 48 falas, 24 pares",
    "**par de prefixo** (`n=24` no holdout)",
    "`prematureTakeover`",
    "`postFinalDecisionDelayMs`",
    "p95 de `postFinalDecisionDelayMs` absoluto ≤800 ms",
    "no máximo **2 GPU-horas** e **US$ 12**",
    "PROMOTE_PORTABLE_MICROTURN_MECHANISM_TO_SHADOW",
    "EXTERNAL_ADVANTAGE_NOT_REPRODUCED",
    "PROMOTE_LOCAL_FLOOR_CONTROL_TO_SHADOW_WITHOUT_EXTERNAL_CLAIM",
    "KEEP_BASELINE_AND_CUT_MICROTURN_CHALLENGER"
  ]);
  assert.match(
    document,
    /Se `E` não for executado,[\s\S]*nunca de comparação externa/iu
  );
  assert.doesNotMatch(
    document,
    /`TAKE_FLOOR`:[^\n]*<\|user backchannel\|>/iu
  );
});
