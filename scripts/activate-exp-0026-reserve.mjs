import { readFile, readdir, rename, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { activateExp0026Reserve } from
  "../src/eval/exp-0026-replacements.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const reserveAlias = argument("--reserve");
const replacesAlias = argument("--replaces");
const reason = argument("--reason");
if (!reserveAlias || !replacesAlias || !reason) {
  throw new Error(
    "uso: activate-exp-0026-reserve.mjs --reserve <alias> " +
    "--replaces <alias ativo> --reason <motivo congelado>"
  );
}
const dataRoot = resolve(
  projectRoot,
  argument("--data-root") ?? "eval/generated/exp-0026/private"
);
const freeze = JSON.parse(await readFile(resolve(
  projectRoot,
  "eval/commitments/exp-0026-session-freeze-v0.1.json"
), "utf8"));
const ledgerPath = resolve(dataRoot, "replacement-ledger.private.json");
const priorLedger = await readFile(ledgerPath, "utf8")
  .then(JSON.parse)
  .catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));

async function loadDirectoryJson(root, { session = false } = {}) {
  const values = [];
  const entries = await readdir(root, { withFileTypes: true })
    .catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  for (const entry of entries) {
    if (session && entry.isDirectory()) {
      const value = JSON.parse(await readFile(resolve(
        root,
        entry.name,
        "session.private.json"
      ), "utf8"));
      // Resultado, comentários e top-2 nunca entram na decisão administrativa.
      values.push({
        sessionId: value.sessionId,
        rosterSlotId: value.rosterSlotId,
        phase: value.phase
      });
    } else if (!session && entry.isFile() && entry.name.endsWith(".json")) {
      values.push(JSON.parse(await readFile(resolve(root, entry.name), "utf8")));
    }
  }
  return values;
}

const [sessions, tombstones] = await Promise.all([
  loadDirectoryJson(resolve(dataRoot, "sessions"), { session: true }),
  loadDirectoryJson(resolve(dataRoot, "withdrawn-tombstones"))
]);
const next = activateExp0026Reserve({
  freeze,
  ledger: priorLedger,
  reserveAlias,
  replacesAlias,
  reason,
  sessions,
  tombstones
});
await mkdir(dirname(ledgerPath), { recursive: true, mode: 0o700 });
const temporary = `${ledgerPath}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
await rename(temporary, ledgerPath);
process.stdout.write(`${JSON.stringify({
  status: "RESERVE_ACTIVATED",
  slot: next.slots.find((item) => item.activeAlias === reserveAlias),
  reason,
  activationCount: next.activations.length,
  ledgerSha256: next.ledgerSha256
}, null, 2)}\n`);
