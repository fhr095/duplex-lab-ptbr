import { readFile } from "node:fs/promises";

import { validateScenarioPack } from "./scenario.mjs";

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function loadScenarioPack(path) {
  return validateScenarioPack(await readJson(path));
}
