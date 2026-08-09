// Probe leve de latência das pernas TTS e cérebro da baseline.
// Uso: node probes/latency-probe.mjs [--base http://localhost:4173]
import { performance } from "node:perf_hooks";

const base = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "http://localhost:4173";

function wavDurationMs(buffer) {
  // WAV PCM: bytes 22-23 canais, 24-27 sample rate, 34-35 bits, data size no chunk "data"
  const view = new DataView(buffer);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  // procura chunk "data"
  let offset = 12;
  while (offset < buffer.byteLength - 8) {
    const id = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3)
    );
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
      return (size / bytesPerSecond) * 1000;
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

async function timeTts(text, reps = 3) {
  const results = [];
  for (let index = 0; index < reps; index += 1) {
    const start = performance.now();
    const response = await fetch(`${base}/api/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text })
    });
    const audio = await response.arrayBuffer();
    const elapsed = performance.now() - start;
    results.push({
      ms: Math.round(elapsed),
      audioMs: Math.round(wavDurationMs(audio) ?? -1),
      bytes: audio.byteLength
    });
  }
  return results;
}

async function timeTurn(text, reps = 3) {
  const results = [];
  for (let index = 0; index < reps; index += 1) {
    const start = performance.now();
    let firstEventMs = null;
    let firstDeltaMs = null;
    let doneMs = null;
    let fullText = "";
    const response = await fetch(`${base}/api/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        sessionId: `probe-${Date.now()}`,
        turnId: `turn-${index}`,
        history: []
      })
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          const event = JSON.parse(line);
          firstEventMs ??= performance.now() - start;
          if (event.type === "delta" && firstDeltaMs === null) {
            firstDeltaMs = performance.now() - start;
          }
          if (event.type === "delta") fullText += event.delta;
          if (event.type === "response" && event.text) fullText = event.text;
          if (event.type === "done" || event.type === "route") {
            if (event.type === "done") doneMs = performance.now() - start;
          }
        }
        newline = buffer.indexOf("\n");
      }
    }
    doneMs ??= performance.now() - start;
    results.push({
      firstEventMs: Math.round(firstEventMs ?? -1),
      firstDeltaMs: Math.round(firstDeltaMs ?? -1),
      doneMs: Math.round(doneMs),
      textPreview: fullText.slice(0, 80)
    });
  }
  return results;
}

const ttsTexts = [
  ["curta", "Oi, tudo bem?"],
  ["média", "Entendi. Vou considerar o valor de trezentos e cinquenta reais na transferência."],
  ["longa", "Claro! O horário de Brasília agora é quatorze horas e vinte minutos, e amanhã a previsão indica sol com poucas nuvens pela manhã."]
];

console.log("=== /api/tts (síntese completa por frase) ===");
for (const [label, text] of ttsTexts) {
  const runs = await timeTts(text);
  console.log(`${label} (${text.length} chars):`,
    runs.map((run) => `${run.ms}ms→${run.audioMs}ms áudio`).join("  "));
}

console.log("\n=== /api/turn (cérebro atual) ===");
for (const text of ["Oi, tudo bem?", "Qual é a capital da França?"]) {
  const runs = await timeTurn(text);
  console.log(`"${text}":`, runs.map((run) =>
    `1º delta ${run.firstDeltaMs}ms, fim ${run.doneMs}ms`).join("  "));
  console.log("  resposta:", runs[0].textPreview);
}
