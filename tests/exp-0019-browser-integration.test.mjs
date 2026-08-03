import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ContextRelevanceShadow
} from "../web/context-relevance-shadow.mjs";

const APP_PATH = new URL("../web/app.mjs", import.meta.url);
const SERVER_PATH = new URL("../src/cli/serve.mjs", import.meta.url);
const CHECKPOINT_PATH = new URL(
  "../web/context-relevance-checkpoint.json",
  import.meta.url
);

async function text(path) {
  return readFile(path, "utf8");
}

function matchingDelimiter(source, openingIndex, open, close) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (["\"", "'", "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === open) depth += 1;
    if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`delimitador ${open}${close} não fechou`);
}

function functionSource(source, name) {
  const candidates = [
    `async function ${name}(`,
    `function ${name}(`
  ];
  const start = candidates.map((candidate) => source.indexOf(candidate))
    .find((index) => index >= 0);
  assert.notEqual(start, undefined, `função ${name} ausente`);
  const opening = source.indexOf("{", start);
  const closing = matchingDelimiter(source, opening, "{", "}");
  return source.slice(start, closing + 1);
}

function evaluateActualGate(source, search, hostname) {
  const start = source.indexOf("const pageParameters =");
  const end = source.indexOf("const localAudioReflexMode =", start);
  assert.ok(start >= 0 && end > start, "declarações do gate ausentes");
  const declarations = source.slice(start, end);
  return Function("window", `
    "use strict";
    ${declarations}
    return { automationEnabled, contextRelevanceExperimentEnabled };
  `)({ location: { search, hostname } });
}

function hookSpreadSource(source) {
  const start = source.indexOf(
    "...(contextRelevanceExperimentEnabled ? {"
  );
  const end = source.indexOf(
    "\n      async refreshCaptureTelemetry",
    start
  );
  assert.ok(start >= 0 && end > start, "spread condicional do hook ausente");
  return source.slice(start, end).trim().replace(/,$/u, "");
}

function createHook(source, enabled, runtime, log) {
  const spread = hookSpreadSource(source);
  return Function(
    "contextRelevanceExperimentEnabled",
    "contextRelevanceRuntime",
    "log",
    `"use strict"; return Object.freeze({ ${spread} });`
  )(enabled, runtime, log);
}

function createLoaderHarness(source, options) {
  const declarationStart = source.indexOf("let contextRelevanceRuntime =");
  const functionStart = source.indexOf(
    "async function loadContextRelevanceShadow()"
  );
  assert.ok(
    declarationStart >= 0 && functionStart > declarationStart,
    "estado/loader contextual ausente"
  );
  const declarations = source.slice(declarationStart, functionStart);
  const originalFunction = functionSource(
    source,
    "loadContextRelevanceShadow"
  );
  const dynamicImport = /await import\(\s*"\/context-relevance-shadow\.mjs"\s*\)/u;
  assert.match(originalFunction, dynamicImport);
  const executableFunction = originalFunction.replace(
    dynamicImport,
    "await importContextModule()"
  );
  return Function(
    "contextRelevanceExperimentEnabled",
    "importContextModule",
    "fetch",
    "log",
    `
      "use strict";
      ${declarations}
      ${executableFunction}
      return Object.freeze({
        load: loadContextRelevanceShadow,
        runtime: () => contextRelevanceRuntime,
        state: () => contextRelevanceShadowState
      });
    `
  )(
    options.enabled,
    options.importContextModule,
    options.fetch,
    options.log
  );
}

function staticRoutes(source) {
  const declaration = source.indexOf("const STATIC_ROUTES = new Map(");
  assert.ok(declaration >= 0, "STATIC_ROUTES ausente");
  const expressionStart = source.indexOf("new Map(", declaration);
  const opening = source.indexOf("(", expressionStart);
  const closing = matchingDelimiter(source, opening, "(", ")");
  const expression = source.slice(expressionStart, closing + 1);
  return Function(`"use strict"; return ${expression};`)();
}

function readyPayload() {
  return {
    assistantAudiblePrefixAtDecision:
      "Quanto tempo reservo para a reunião, trinta minutos ou uma hora?",
    assistantAudiblePrefixAvailableAtSample: 32_000,
    assistantSpeaking: true,
    currentSample: 48_000,
    recentInbound: [
      "A camiseta foi separada em tamanho médio ou grande?"
    ],
    recentInboundAvailableAtSample: 16_000,
    targetAvailableAtSample: 48_000,
    targetText: "trinta minutos"
  };
}

test("gate real exige localhost + automation=1 + experiment=0019", async () => {
  const source = await text(APP_PATH);
  assert.deepEqual(
    evaluateActualGate(
      source,
      "?automation=1&experiment=0019",
      "localhost"
    ),
    { automationEnabled: true, contextRelevanceExperimentEnabled: true }
  );
  for (const [search, hostname, expectedAutomation] of [
    ["?automation=1", "localhost", true],
    ["?experiment=0019", "localhost", false],
    ["?automation=1&experiment=0018", "127.0.0.1", true],
    ["?automation=1&experiment=0019", "example.com", false]
  ]) {
    assert.deepEqual(evaluateActualGate(source, search, hostname), {
      automationEnabled: expectedAutomation,
      contextRelevanceExperimentEnabled: false
    });
  }
});

test("módulo e checkpoint carregam apenas dentro do gate EXP-0019", async () => {
  const [source, checkpoint] = await Promise.all([
    text(APP_PATH),
    text(CHECKPOINT_PATH).then(JSON.parse)
  ]);
  assert.doesNotMatch(
    source,
    /from\s+["']\/context-relevance-shadow\.mjs["']/u,
    "import estático carregaria o challenger fora do experimento"
  );
  assert.equal(
    source.match(/import\(\s*"\/context-relevance-shadow\.mjs"\s*\)/gu)
      ?.length,
    1
  );

  let imports = 0;
  let fetches = 0;
  const disabled = createLoaderHarness(source, {
    enabled: false,
    importContextModule: async () => {
      imports += 1;
      return { ContextRelevanceShadow };
    },
    fetch: async () => {
      fetches += 1;
      return { ok: true, json: async () => checkpoint };
    },
    log() {}
  });
  await disabled.load();
  assert.equal(imports, 0);
  assert.equal(fetches, 0);
  assert.deepEqual(disabled.state(), {
    state: "disabled",
    authority: { mode: "shadow-only", canProduceEffects: false }
  });

  const requests = [];
  const enabled = createLoaderHarness(source, {
    enabled: true,
    importContextModule: async () => {
      imports += 1;
      return { ContextRelevanceShadow };
    },
    fetch: async (path) => {
      fetches += 1;
      requests.push(path);
      return { ok: true, json: async () => checkpoint };
    },
    log() {}
  });
  assert.equal(enabled.state().state, "loading");
  await enabled.load();
  assert.deepEqual(requests, ["/context-relevance-checkpoint.json"]);
  assert.equal(imports, 1);
  assert.equal(fetches, 1);
  assert.ok(enabled.runtime() instanceof ContextRelevanceShadow);
  assert.equal(enabled.state().state, "ready");
  assert.deepEqual(enabled.state().authority, {
    mode: "shadow-only",
    canProduceEffects: false
  });
});

test("hook só existe no gate e retorna proposta/snapshot sem autoridade", async () => {
  const [source, checkpoint] = await Promise.all([
    text(APP_PATH),
    text(CHECKPOINT_PATH).then(JSON.parse)
  ]);
  const runtime = new ContextRelevanceShadow(checkpoint);
  const logs = [];
  const outsideExperiment = createHook(
    source,
    false,
    runtime,
    (...args) => logs.push(args)
  );
  assert.equal("evaluateContextRelevance" in outsideExperiment, false);

  const experiment = createHook(
    source,
    true,
    runtime,
    (...args) => logs.push(args)
  );
  assert.equal(typeof experiment.evaluateContextRelevance, "function");
  const output = experiment.evaluateContextRelevance(readyPayload());
  assert.equal(output.result.status, "SHADOW_PROPOSAL");
  assert.equal(output.result.classifierCalls, 2);
  assert.deepEqual(output.result.effects, []);
  assert.equal(output.result.authority.canProduceEffects, false);
  assert.equal(output.snapshot.authority.canProduceEffects, false);
  assert.equal(output.snapshot.effectsDispatched, 0);
  assert.deepEqual(logs, [[
    "context-relevance-shadow.evaluated",
    "SHADOW_PROPOSAL"
  ]]);

  const unavailable = createHook(source, true, null, () => {});
  assert.throws(
    () => unavailable.evaluateContextRelevance(readyPayload()),
    /não está pronto/iu
  );
});

test("resultado do shadow não alcança dispatch, lifecycle ou renderer", async () => {
  const source = await text(APP_PATH);
  const hook = hookSpreadSource(source);
  assert.doesNotMatch(hook, /dispatch|lifecycle|renderer|render|speak|session|elements/iu);
  assert.match(hook, /contextRelevanceRuntime\.evaluate\(payload\)/u);
  assert.match(hook, /return Object\.freeze\(\{\s*result,\s*snapshot:/su);

  const withoutHook = source.replace(hook, "");
  assert.doesNotMatch(
    withoutHook,
    /contextRelevanceRuntime\.evaluate\s*\(/u,
    "evaluate não pode ter segundo consumidor"
  );
  for (const name of [
    "dispatchOutputInterruption",
    "dispatchLocalAudioReflex"
  ]) {
    assert.doesNotMatch(
      functionSource(source, name),
      /contextRelevance|SHADOW_PROPOSAL/iu
    );
  }
  assert.match(
    functionSource(source, "automationSnapshot"),
    /contextRelevanceShadow:\s*contextRelevanceRuntime === null\s*\?\s*\{\s*\.\.\.contextRelevanceShadowState\s*\}\s*:\s*contextRelevanceRuntime\.snapshot/su
  );
});

test("servidor expõe somente os dois artefatos estáticos necessários", async () => {
  const routes = staticRoutes(await text(SERVER_PATH));
  assert.equal(
    routes.get("/context-relevance-shadow.mjs"),
    "context-relevance-shadow.mjs"
  );
  assert.equal(
    routes.get("/context-relevance-checkpoint.json"),
    "context-relevance-checkpoint.json"
  );
  assert.equal(routes.has("/exp-0019-effects.mjs"), false);
});
