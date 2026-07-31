import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  materializeFactoryAudio
} from "../src/eval/factory/audio-materializer.mjs";
import { canonicalSha256 } from "../src/eval/factory/canonical-hash.mjs";
import {
  closeWindowsSpeechSynthesizer,
  prewarmWindowsSpeech,
  synthesizeWindowsSpeech
} from "../src/tts/windows-system-tts.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function parseArgs(args) {
  const options = {
    pack: "eval/factory/packs/corrections.pt-BR.v0.2.json",
    out: "eval/reports/eval-factory-audio-latest.json",
    refresh: false,
    verifyDeterminism: true
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--refresh") {
      options.refresh = true;
    } else if (argument === "--no-determinism-check") {
      options.verifyDeterminism = false;
    } else if (["--pack", "--out"].includes(argument)) {
      options[argument.slice(2)] = args[++index];
    } else {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pack = JSON.parse(
    await readFile(resolve(PROJECT_ROOT, options.pack), "utf8")
  );
  const cases = pack.cases.filter(
    (item) => item.lineage.relation === "root"
  );
  const status = await prewarmWindowsSpeech();
  const engine = {
    id: "windows-system-speech",
    voice: status.worker?.voice ?? "unknown",
    culture: status.worker?.culture ?? "unknown"
  };
  try {
    const report = await materializeFactoryAudio({
      cases,
      projectRoot: PROJECT_ROOT,
      engine,
      synthesize: synthesizeWindowsSpeech,
      refresh: options.refresh,
      verifyDeterminism: options.verifyDeterminism
    });
    report.sourcePack = {
      id: pack.id,
      path: options.pack,
      sha256: canonicalSha256(pack),
      caseCount: pack.cases.length,
      selectedRootCases: cases.length
    };
    report.paidApiCalls = 0;
    report.generatedAt = new Date().toISOString();
    report.externalLlmUsed = false;
    report.gate = {
      id: "factory-audio-materialization-v1",
      pass:
        report.summary.caseCount === cases.length &&
        report.summary.uniqueRecipeCount === cases.length &&
        report.summary.uniqueWaveCount === cases.length &&
        report.deterministicControl.pass !== false,
      decision: "promote",
      scope: "integridade de fixtures TTS; não mede ASR nem naturalidade"
    };
    report.gate.decision = report.gate.pass ? "promote" : "hold";
    const output = resolve(PROJECT_ROOT, options.out);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      `Áudio da fábrica ${report.gate.decision}: ` +
        `${report.summary.caseCount} casos, ` +
        `${report.summary.cacheHits} cache hits, ` +
        `${report.summary.uniqueWaveCount} WAVs únicos.`
    );
    console.log(`Relatório: ${options.out}`);
    if (!report.gate.pass) {
      process.exitCode = 1;
    }
  } finally {
    await closeWindowsSpeechSynthesizer({ drain: true });
  }
}

await main();
