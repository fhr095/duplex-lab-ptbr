import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createExp0026SessionFreeze } from
  "../src/eval/exp-0026-freeze.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import { createSourceFingerprint } from
  "../src/eval/source-fingerprint.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const outputPath = resolve(
  projectRoot,
  "eval/commitments/exp-0026-session-freeze-v0.1.json"
);
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const rosterPath = argument("--roster");
const stationPath = argument("--station");
if (!rosterPath || !stationPath) {
  throw new Error(
    "uso: freeze-exp-0026-sessions.mjs --roster <privado.json> " +
    "--station <privado.json>"
  );
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8"
  }).trim();
}

if (git("status", "--porcelain=v1", "--untracked-files=all") !== "") {
  throw new Error("worktree precisa estar limpa antes do freeze");
}
await access(outputPath).then(
  () => { throw new Error("freeze EXP-0026 já existe; não sobrescrever"); },
  (error) => {
    if (error.code !== "ENOENT") throw error;
  }
);
const sessionsRoot = resolve(
  projectRoot,
  "eval/generated/exp-0026/private/sessions"
);
const existingExternal = await readdir(sessionsRoot, { withFileTypes: true })
  .catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
for (const entry of existingExternal) {
  if (!entry.isDirectory()) continue;
  const state = JSON.parse(await readFile(
    resolve(sessionsRoot, entry.name, "session.private.json"),
    "utf8"
  ));
  if (state.role === "external" && state.phase !== "WITHDRAWN") {
    throw new Error("freeze precisa anteceder toda sessão externa");
  }
}

const [rosterBytes, stationBytes, packBytes, noiseBytes] = await Promise.all([
  readFile(resolve(rosterPath)),
  readFile(resolve(stationPath)),
  readFile(resolve(
    projectRoot,
    "eval/experiments/exp-0026-experience-pack.pt-BR.json"
  )),
  readFile(resolve(
    projectRoot,
    "eval/generated/exp-0026/stimuli/s5-white-noise-v0.1.wav"
  ))
]);
const roster = JSON.parse(rosterBytes);
const station = JSON.parse(stationBytes);
const pack = JSON.parse(packBytes);
if (sha256(noiseBytes) !== `sha256:${pack.noise.sha256}`) {
  throw new Error("ruído S5 diverge do pack");
}

const qualificationPaths = [
  "eval/reports/exp-0026-lifecycle-smoke-v0.1.json",
  "eval/reports/exp-0026-instrument-dry-run-v0.1.json",
  "eval/reports/exp-0026-blind-order-smoke-v0.1.json"
];
const qualification = [];
for (const path of qualificationPaths) {
  const bytes = await readFile(resolve(projectRoot, path));
  const report = JSON.parse(bytes);
  if (report.pass !== true) throw new Error(`${path} não passou`);
  qualification.push({ path, fileSha256: sha256(bytes), pass: true });
}

const runtimeBinding = await createSourceFingerprint(projectRoot, {
  roots: [
    "src",
    "web",
    "eval/experiments/exp-0026-experience-pack.pt-BR.json",
    "package.json",
    "package-lock.json",
    "requirements-asr.txt"
  ]
});
const createdAtDate = new Date();
const closesAtDate = new Date(createdAtDate.valueOf() + 7 * 24 * 60 * 60 * 1_000);
const freeze = createExp0026SessionFreeze({
  roster,
  station,
  rosterManifestSha256: sha256(rosterBytes),
  stationManifestSha256: sha256(stationBytes),
  createdAt: createdAtDate.toISOString(),
  closesAt: closesAtDate.toISOString(),
  sourceCommit: git("rev-parse", "HEAD"),
  runtimeBinding,
  pack: {
    path: "eval/experiments/exp-0026-experience-pack.pt-BR.json",
    fileSha256: sha256(packBytes),
    canonicalSha256: `sha256:${canonicalSha256(pack)}`,
    packId: pack.packId
  },
  noise: {
    ...pack.noise,
    sha256: `sha256:${pack.noise.sha256}`
  },
  tts: station.tts,
  stationManifestSha256: sha256(stationBytes),
  rosterManifestSha256: sha256(rosterBytes),
  qualification
});
if (JSON.stringify(freeze).match(/OPENAI_API_KEY|sk-[A-Za-z0-9_-]+/u)) {
  throw new Error("freeze contém possível segredo");
}
await writeFile(outputPath, `${JSON.stringify(freeze, null, 2)}\n`, {
  flag: "wx"
});
process.stdout.write(`${JSON.stringify({
  status: freeze.status,
  outputPath,
  freezeSha256: freeze.freezeSha256,
  closesAt: freeze.closesAt,
  participantAliases: freeze.roster.participantAliases
}, null, 2)}\n`);
