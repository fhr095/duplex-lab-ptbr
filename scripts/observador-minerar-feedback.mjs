// Mineração de feedback embutido na fala GRAVADA do usuário: o modelo
// áudio-nativo escuta a sessão inteira atrás de cada momento em que o
// usuário opina/comenta sobre o próprio sistema ou teste (percepções,
// incômodos, elogios, dúvidas sobre o comportamento). Direto do áudio —
// robusto a transcrições quebradas. Saída persistida no pacote.
//   node scripts/observador-minerar-feedback.mjs <pacote...>
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { loadEnvFile } from "../src/config/load-env.mjs";

await loadEnvFile();
const chave = process.env.OPENAI_API_KEY;
if (!chave) {
  console.error("OPENAI_API_KEY ausente");
  process.exit(1);
}

const PROMPT =
  "Você ouvirá uma conversa em PT-BR entre uma pessoa (usuário) e um " +
  "assistente de voz sintética. O usuário está TESTANDO o sistema e " +
  "costuma embutir na própria fala percepções, incômodos, elogios e " +
  "dúvidas sobre o comportamento do assistente (muitas vezes perto do " +
  "final, mas não só). Extraia TODOS esses momentos de opinião/feedback " +
  "do USUÁRIO sobre o sistema/teste — ignore conversa social que não " +
  "opine sobre o sistema. Responda SOMENTE um array JSON: " +
  '[{"quando":"mm:ss","citacao":"fala literal do usuário (do áudio, ' +
  'não parafraseie)","tipo":"percepcao|incomodo|elogio|duvida|sugestao",' +
  '"implicacao":"o que isso diz sobre o sistema, em uma frase"}]. ' +
  "Se não houver nada, responda [].";

for (const pacote of process.argv.slice(2)) {
  const wav = await readFile(join(pacote, "mistura.wav"));
  const resposta = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${chave}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-audio",
        modalities: ["text"],
        max_completion_tokens: 3_000,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              {
                type: "input_audio",
                input_audio: {
                  data: wav.toString("base64"),
                  format: "wav"
                }
              }
            ]
          }
        ]
      })
    }
  );
  const corpo = await resposta.json();
  const texto = corpo.choices?.[0]?.message?.content ?? "";
  await mkdir(join(pacote, "escuta"), { recursive: true });
  await writeFile(
    join(pacote, "escuta", "feedback-minerado.json"),
    `${JSON.stringify({ modelo: "gpt-audio", bruto: texto, usage: corpo.usage ?? null }, null, 2)}\n`
  );
  console.log(`=== ${pacote.split("/").at(-1)} ===`);
  console.log(texto.slice(0, 3_000));
  console.log();
}
