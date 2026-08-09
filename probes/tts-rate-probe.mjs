// Mede duração de áudio e latência da Maria em vários rates SAPI (-10..10).
const base = "http://localhost:4173";
const text = "Entendi. Vou considerar o valor de trezentos e cinquenta reais na transferência.";

function wavDurationMs(buffer) {
  const view = new DataView(buffer);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);
  let offset = 12;
  while (offset < buffer.byteLength - 8) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const size = view.getUint32(offset + 4, true);
    if (id === "data") return (size / (sampleRate * channels * (bits / 8))) * 1000;
    offset += 8 + size + (size % 2);
  }
  return null;
}

for (const rate of [0, 1, 2, 3, 4, 6]) {
  const start = performance.now();
  const response = await fetch(`${base}/api/tts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, rate })
  });
  const audio = await response.arrayBuffer();
  const ms = Math.round(performance.now() - start);
  console.log(`rate=${rate}: síntese ${ms}ms, áudio ${Math.round(wavDurationMs(audio))}ms, ${(text.length / (wavDurationMs(audio) / 1000)).toFixed(1)} chars/s`);
}
