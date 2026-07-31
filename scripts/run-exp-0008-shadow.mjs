import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  evaluateExp0008
} from "./lib/exp-0008-analysis.mjs";
import {
  reconstructExactPcm
} from "./lib/exact-pcm-snapshot.mjs";
import { encodePcm16Wave } from "../src/audio/wav.mjs";
import {
  createSourceFingerprint
} from "../src/eval/source-fingerprint.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const PYTHON = resolve(PROJECT_ROOT, ".venv/bin/python");
const TRANSCRIBER = resolve(PROJECT_ROOT, "scripts/transcribe_audio.py");
const MODEL_CACHE = resolve(PROJECT_ROOT, "eval/generated/asr/models");
const DEFAULTS = Object.freeze({
  pack: "eval/experiments/exp-0008-critical-slot-shadow.pt-BR.json",
  out: "eval/reports/exp-0008-shadow-v1.json",
  generatedRoot: "eval/generated/exp-0008"
});

function parseArgs(args) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
    const field = argument.slice(2).replace(
      /-([a-z])/gu,
      (_, letter) => letter.toUpperCase()
    );
    if (!(field in options)) {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
    options[field] = args[++index];
  }
  return options;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function modelRevision(model) {
  const snapshots = resolve(
    MODEL_CACHE,
    `models--Systran--faster-whisper-${model}`,
    "snapshots"
  );
  const entries = await readdir(snapshots, { withFileTypes: true });
  const revisions = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (revisions.length !== 1) {
    throw new Error(
      `${model}: esperado exatamente um snapshot local, obtido ${revisions.length}`
    );
  }
  return revisions[0];
}

async function runTranscriber(paths, candidate) {
  await access(PYTHON);
  const revision = await modelRevision(candidate.model);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      PYTHON,
      [
        TRANSCRIBER,
        "--engine",
        candidate.engine,
        "--model",
        candidate.model,
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
          HF_HUB_DISABLE_TELEMETRY: "1",
          HF_HUB_OFFLINE: "1",
          TRANSFORMERS_OFFLINE: "1"
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const stdout = [];
    const stderr = [];
    let bytes = 0;
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
      finish(
        rejectPromise,
        new Error(`${candidate.model}: inferência excedeu 15 minutos`)
      );
    }, 15 * 60 * 1_000);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 10 * 1024 * 1024) {
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
              `${candidate.model}: processo terminou com código ${code}`
          )
        );
        return;
      }
      try {
        finish(resolvePromise, {
          ...JSON.parse(Buffer.concat(stdout).toString("utf8")),
          modelRevision: revision
        });
      } catch (error) {
        finish(
          rejectPromise,
          new Error(`${candidate.model}: JSON inválido`, { cause: error })
        );
      }
    });
  });
}

function rotatedCases(cases, repetition) {
  const offset = (repetition - 1) % cases.length;
  return [...cases.slice(offset), ...cases.slice(0, offset)];
}

const options = parseArgs(process.argv.slice(2));
const packPath = resolve(PROJECT_ROOT, options.pack);
const packBytes = await readFile(packPath);
const pack = JSON.parse(packBytes.toString("utf8"));
const generatedRoot = resolve(PROJECT_ROOT, options.generatedRoot);
await mkdir(generatedRoot, { recursive: true });

const reconstructions = [];
const audioByCase = new Map();
for (const definition of pack.cases) {
  const wave = await readFile(resolve(PROJECT_ROOT, definition.audio));
  const reconstructed = reconstructExactPcm(wave, definition, {
    sampleRate: pack.sampleRate
  });
  const relativePath = `${options.generatedRoot}/${definition.id}.wav`;
  const absolutePath = resolve(PROJECT_ROOT, relativePath);
  const exactWave = encodePcm16Wave(reconstructed.pcm, {
    sampleRate: pack.sampleRate
  });
  await writeFile(absolutePath, exactWave);
  audioByCase.set(definition.id, absolutePath);
  reconstructions.push({
    ...reconstructed.evidence,
    artifact: relativePath,
    artifactWaveSha256: sha256(exactWave)
  });
}

const candidates = [];
for (const candidate of pack.candidates) {
  const requests = [];
  for (let repetition = 1; repetition <= pack.repetitions; repetition += 1) {
    for (const definition of rotatedCases(pack.cases, repetition)) {
      requests.push({
        caseId: definition.id,
        repetition,
        path: audioByCase.get(definition.id)
      });
    }
  }
  const raw = await runTranscriber(
    requests.map((item) => item.path),
    candidate
  );
  if (raw.results.length !== requests.length) {
    throw new Error(
      `${candidate.model}: ${raw.results.length}/${requests.length} resultados`
    );
  }
  candidates.push({
    ...candidate,
    modelLoadMs: raw.modelLoadMs,
    modelRevision: raw.modelRevision,
    device: raw.device,
    computeType: raw.computeType,
    decoding: raw.decoding,
    observations: requests.map((request, index) => ({
      caseId: request.caseId,
      repetition: request.repetition,
      text: raw.results[index].text,
      elapsedMs: raw.results[index].elapsedMs,
      language: raw.results[index].language,
      languageProbability: raw.results[index].languageProbability
    }))
  });
}

const report = evaluateExp0008({
  pack,
  reconstructions,
  candidates,
  paidApiCalls: 0
});
report.provenance = {
  pack: {
    path: options.pack,
    sha256: sha256(packBytes)
  },
  source: await createSourceFingerprint(PROJECT_ROOT, {
    roots: [
      "src/asr/pcm.mjs",
      "src/audio/wav.mjs",
      "src/interaction/correction-semantics.mjs",
      "src/interaction/ptbr-number.mjs",
      "scripts/transcribe_audio.py",
      "scripts/run-exp-0008-shadow.mjs",
      "scripts/lib/exact-pcm-snapshot.mjs",
      "scripts/lib/exp-0008-analysis.mjs",
      options.pack,
      "requirements-asr.txt"
    ]
  }),
  models: Object.fromEntries(candidates.map((candidate) => [
    candidate.id ?? `${candidate.engine}-${candidate.model}`,
    {
      revision: candidate.modelRevision,
      device: candidate.device,
      computeType: candidate.computeType,
      decoding: candidate.decoding
    }
  ]))
};

const output = resolve(PROJECT_ROOT, options.out);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `EXP-0008: ${report.decision.toUpperCase()} · ` +
    `${report.matrix.observations} observações · ` +
    `candidatos viáveis=${report.deployableCandidates.join(",") || "nenhum"}`
);
console.log(`Relatório: ${options.out}`);
