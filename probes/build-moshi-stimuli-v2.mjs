// Compõe os estímulos v2 do Moshi (EN controle, barge-in, backchannel) com
// linhas do tempo versionadas. Na inferência offline do Moshi o canal do
// usuário é consumido passo a passo em sincronia com a geração — inserir
// fala do usuário na janela em que o modelo estará falando é um probe
// válido de barge-in/backchannel no nível da dinâmica.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";

const M = "/tmp/claude-1000/-home-Felipe-work-duplex-lab-ptbr/" +
  "83939f95-834c-424c-9ae0-d4d62dd9ddbd/scratchpad/models";
const OUT = resolve(import.meta.dirname, "data/stimuli");
const RATE = 24_000;

function resample(pcm, from) {
  if (from === RATE) {
    return pcm;
  }
  const n = pcm.length / 2;
  const out = Math.floor((n * RATE) / from);
  const buffer = Buffer.alloc(out * 2);
  for (let i = 0; i < out; i += 1) {
    const s = (i * from) / RATE;
    const lo = Math.floor(s);
    const hi = Math.min(n - 1, lo + 1);
    const f = s - lo;
    buffer.writeInt16LE(Math.round(
      pcm.readInt16LE(lo * 2) * (1 - f) + pcm.readInt16LE(hi * 2) * f
    ), i * 2);
  }
  return buffer;
}

async function piece(file) {
  const decoded = decodeWaveToPcm16(await readFile(`${M}/${file}`));
  return resample(decoded.pcm, decoded.sampleRate);
}

const silence = (ms) => Buffer.alloc(Math.round((RATE * ms) / 1000) * 2);

function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function compose(name, spec) {
  const parts = [];
  const timeline = [];
  let cursor = 0;
  for (const item of spec) {
    if (item.silenceMs) {
      parts.push(silence(item.silenceMs));
      cursor += item.silenceMs;
      continue;
    }
    const pcm = await piece(item.file);
    timeline.push({
      name: item.name,
      startMs: Math.round(cursor),
      endMs: Math.round(cursor + (pcm.length / 2 / RATE) * 1000)
    });
    parts.push(pcm);
    cursor += (pcm.length / 2 / RATE) * 1000;
  }
  const pcm = Buffer.concat(parts);
  await writeFile(resolve(OUT, `${name}.wav`), wav(pcm));
  await writeFile(
    resolve(OUT, `${name}-timeline.json`),
    JSON.stringify(timeline, null, 1)
  );
  console.log(name, Math.round(pcm.length / 2 / RATE) + "s",
    JSON.stringify(timeline));
}

await compose("moshi-en", [
  { silenceMs: 1000 },
  { name: "en-greet", file: "fala-en-greet.wav" },
  { silenceMs: 2500 },
  { name: "en-question", file: "fala-en-question.wav" },
  { silenceMs: 4000 }
]);

// o modelo tipicamente engata resposta ~0,1-1s após a saudação; o interrupt
// entra 2s depois do fim da pergunta, dentro da janela típica de resposta.
await compose("moshi-bargein", [
  { silenceMs: 1000 },
  { name: "pergunta", file: "fala-explica.wav" },
  { silenceMs: 2000 },
  { name: "interrupt", file: "fala-interrompe.wav" },
  { silenceMs: 4000 }
]);

await compose("moshi-backchannel", [
  { silenceMs: 1000 },
  { name: "pergunta", file: "fala-explica.wav" },
  { silenceMs: 2000 },
  { name: "aham", file: "fala-aham.wav" },
  { silenceMs: 4000 }
]);
