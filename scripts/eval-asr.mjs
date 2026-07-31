import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { inspectWave } from "../src/audio/wav.mjs";
import { scoreTranscript } from "../src/eval/transcript-metrics.mjs";
import { synthesizeWindowsSpeech } from "../src/tts/windows-system-tts.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_GATE = resolve(
  PROJECT_ROOT,
  "eval/gates/asr-autonomy.json"
);
const GENERATED_ROOT = resolve(PROJECT_ROOT, "eval/generated/asr");
const AUDIO_ROOT = resolve(GENERATED_ROOT, "audio");
const MODEL_CACHE = resolve(GENERATED_ROOT, "models");
const PYTHON = resolve(PROJECT_ROOT, ".venv/bin/python");
const TRANSCRIBER = resolve(PROJECT_ROOT, "scripts/transcribe_audio.py");

function parseArgs(args) {
  const defaultEngine =
    process.env.ASR_FINAL_ENGINE?.trim() || "parakeet";
  const options = {
    engine: defaultEngine,
    json: false,
    model:
      process.env.ASR_FINAL_MODEL?.trim() ||
      (defaultEngine === "parakeet"
        ? "nemo-parakeet-tdt-0.6b-v3"
        : "base"),
    out: "eval/reports/asr-latest.json",
    pack: "eval/scenarios/asr-autonomy.pt-BR.json",
    refresh: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--refresh") {
      options.refresh = true;
    } else if (
      argument === "--model" ||
      argument === "--engine" ||
      argument === "--out" ||
      argument === "--pack"
    ) {
      options[argument.slice(2)] = args[index + 1];
      index += 1;
    } else {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
  }

  return options;
}

function percentile(values, ratio) {
  if (values.length === 0) {
    return null;
  }
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)];
}

async function loadFixtures(pack, options) {
  if (Array.isArray(pack.cases)) {
    return Promise.all(
      pack.cases.map(async (item) => {
        const absolutePath = resolve(PROJECT_ROOT, item.audio);
        const audio = await readFile(absolutePath);
        return {
          absolutePath,
          category: item.category ?? "unspecified",
          expected: item.expected,
          id: item.id,
          metadata: item.metadata ?? null,
          rate: item.rate ?? null,
          relativePath: item.audio,
          wave: inspectWave(audio)
        };
      })
    );
  }

  if (!Array.isArray(pack.utterances) || !Array.isArray(pack.rates)) {
    throw new TypeError(
      "pack ASR precisa conter cases ou utterances + rates"
    );
  }

  const fixtures = [];
  for (const utterance of pack.utterances) {
    for (const rate of pack.rates) {
      const filename =
        `${utterance.id}--rate-${String(rate).replace("-", "m")}.wav`;
      const absolutePath = resolve(AUDIO_ROOT, filename);

      if (options.refresh || !(await fileExists(absolutePath))) {
        const audio = await synthesizeWindowsSpeech(utterance.text, { rate });
        await writeFile(absolutePath, audio);
      }

      const audio = await readFile(absolutePath);
      fixtures.push({
        absolutePath,
        category: utterance.category,
        expected: utterance.text,
        id: `${utterance.id}/rate-${rate}`,
        metadata: null,
        rate,
        relativePath: `eval/generated/asr/audio/${filename}`,
        wave: inspectWave(audio)
      });
    }
  }
  return fixtures;
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runTranscriber(paths, model, engine) {
  await access(PYTHON).catch(() => {
    throw new Error(
      ".venv ausente. Rode npm run setup:asr antes da avaliação."
    );
  });
  await mkdir(MODEL_CACHE, { recursive: true });

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      PYTHON,
      [
        TRANSCRIBER,
        "--engine",
        engine,
        "--model",
        model,
        "--cache-dir",
        MODEL_CACHE,
        "--language",
        "pt",
        "--threads",
        "4",
        ...paths
      ],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          HF_HUB_DISABLE_TELEMETRY: "1"
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(rejectPromise, new Error("ASR excedeu 15 minutos"));
    }, 15 * 60 * 1_000);

    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 10 * 1024 * 1024) {
        child.kill();
        finish(rejectPromise, new Error("saída do ASR excedeu 10 MiB"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => finish(rejectPromise, error));
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      if (code !== 0) {
        finish(
          rejectPromise,
          new Error(
            Buffer.concat(stderr).toString("utf8").trim() ||
              `ASR terminou com código ${code}`
          )
        );
        return;
      }
      try {
        finish(
          resolvePromise,
          JSON.parse(Buffer.concat(stdout).toString("utf8"))
        );
      } catch (error) {
        finish(
          rejectPromise,
          new Error("ASR não retornou JSON válido", { cause: error })
        );
      }
    });
  });
}

function printReport(report) {
  console.log(`\nASR autônomo — ${report.candidate}`);
  console.log(
    `Gate ${report.gate.id}: ${report.gate.pass ? "PASSOU" : "FALHOU"}`
  );
  console.log(
    `Casos: ${report.summary.passedCases}/${report.summary.caseCount}`
  );
  console.log(`WER corpus: ${report.summary.corpusWer}`);
  console.log(
    `RTF: p50=${report.summary.realtimeFactor.p50}, ` +
      `p95=${report.summary.realtimeFactor.p95}`
  );
  console.log(`Carga do modelo: ${report.runtime.modelLoadMs} ms\n`);

  const failures = report.cases.filter((item) => !item.pass);
  for (const failure of failures) {
    console.log(
      `- ${failure.id}: WER=${failure.wer}, esperado="${failure.expected}", ` +
        `obtido="${failure.actual}"`
    );
  }
}

const options = parseArgs(process.argv.slice(2));
const pack = JSON.parse(
  await readFile(resolve(PROJECT_ROOT, options.pack), "utf8")
);
const gateConfig = JSON.parse(await readFile(DEFAULT_GATE, "utf8"));
await mkdir(AUDIO_ROOT, { recursive: true });

const fixtures = await loadFixtures(pack, options);

const campaignStarted = performance.now();
const transcription = await runTranscriber(
  fixtures.map((fixture) => fixture.absolutePath),
  options.model,
  options.engine
);
const campaignElapsedMs = Math.round(performance.now() - campaignStarted);
const resultsByPath = new Map(
  transcription.results.map((result) => [resolve(result.file), result])
);

let totalErrors = 0;
let totalExpectedWords = 0;
const cases = fixtures.map((fixture) => {
  const result = resultsByPath.get(fixture.absolutePath);
  if (!result) {
    throw new Error(`ASR não retornou ${fixture.relativePath}`);
  }
  const score = scoreTranscript(fixture.expected, result.text);
  totalErrors += score.errors;
  totalExpectedWords += score.expectedWords;
  const realtimeFactor =
    Math.round((result.elapsedMs / fixture.wave.durationMs) * 10_000) / 10_000;
  const pass =
    score.wer <= gateConfig.maxCorpusWer &&
    (
      result.languageProbability === null ||
      result.languageProbability >= gateConfig.minLanguageProbability
    );
  const languageProbability = Number.isFinite(result.languageProbability)
    ? Math.round(result.languageProbability * 10_000) / 10_000
    : null;

  return {
    id: fixture.id,
    category: fixture.category,
    rate: fixture.rate,
    audio: fixture.relativePath,
    metadata: fixture.metadata,
    durationMs: fixture.wave.durationMs,
    activeStartMs: fixture.wave.activeStartMs,
    activeEndMs: fixture.wave.activeEndMs,
    expected: fixture.expected,
    actual: result.text,
    ...score,
    language: result.language,
    languageProbability,
    elapsedMs: result.elapsedMs,
    realtimeFactor,
    pass
  };
});

const corpusWer =
  totalExpectedWords === 0
    ? 0
    : Math.round((totalErrors / totalExpectedWords) * 10_000) / 10_000;
const realtimeFactors = cases.map((item) => item.realtimeFactor);
const p95RealtimeFactor = percentile(realtimeFactors, 0.95);
const reportedLanguageProbabilities = cases
  .map((item) => item.languageProbability)
  .filter(Number.isFinite);
const minimumLanguageProbability =
  reportedLanguageProbabilities.length > 0
    ? Math.min(...reportedLanguageProbabilities)
    : null;
const gateChecks = {
  corpusWer: corpusWer <= gateConfig.maxCorpusWer,
  languageProbability:
    minimumLanguageProbability === null
      ? null
      : minimumLanguageProbability >= gateConfig.minLanguageProbability,
  realtimeFactor:
    p95RealtimeFactor <= gateConfig.maxP95RealtimeFactor
};
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  candidate: `${options.engine}-${options.model}-cpu-int8`,
  packId: pack.id,
  packKind: pack.kind ?? "synthetic-speech",
  source: pack.source ?? null,
  summary: {
    caseCount: cases.length,
    passedCases: cases.filter((item) => item.pass).length,
    corpusWer,
    corpusLiteralWer:
      Math.round(
        (cases.reduce((total, item) => total + item.literalErrors, 0) /
          totalExpectedWords) *
          10_000
      ) / 10_000,
    minimumLanguageProbability,
    realtimeFactor: {
      p50: percentile(realtimeFactors, 0.5),
      p95: p95RealtimeFactor,
      max: Math.max(...realtimeFactors)
    }
  },
  runtime: {
    campaignElapsedMs,
    modelLoadMs: transcription.modelLoadMs,
    device: transcription.device,
    computeType: transcription.computeType,
    decoding: transcription.decoding
  },
  gate: {
    id: gateConfig.id,
    pass: Object.values(gateChecks).every((value) => value !== false),
    checks: gateChecks,
    unavailableChecks: Object.entries(gateChecks)
      .filter(([, value]) => value === null)
      .map(([name]) => name),
    thresholds: gateConfig
  },
  cases
};

const outputPath = resolve(PROJECT_ROOT, options.out);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report);
}

if (!report.gate.pass) {
  process.exitCode = 1;
}
