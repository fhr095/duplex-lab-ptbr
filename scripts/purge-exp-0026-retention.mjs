import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { purgeExp0026Retention } from
  "../src/eval/exp-0026-data-lifecycle.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const closeoutPath = resolve(
  projectRoot,
  argument("--closeout") ??
    "eval/generated/exp-0026/private/closeout.private.json"
);
const result = await purgeExp0026Retention({
  dataRoot: resolve(
    projectRoot,
    argument("--data-root") ?? "eval/generated/exp-0026/private"
  ),
  closeoutManifest: JSON.parse(await readFile(closeoutPath, "utf8")),
  asOf: argument("--as-of") ?? undefined,
  apply: process.argv.includes("--apply")
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
