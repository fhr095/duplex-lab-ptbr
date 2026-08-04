import { resolve } from "node:path";

import { withdrawExp0026PersistedSession } from
  "../src/eval/exp-0026-data-lifecycle.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const code = argument("--code");
if (!code) throw new Error("--code com o recibo de retirada é obrigatório");
const result = await withdrawExp0026PersistedSession({
  projectRoot,
  dataRoot: resolve(
    projectRoot,
    argument("--data-root") ?? "eval/generated/exp-0026/private"
  ),
  code
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
