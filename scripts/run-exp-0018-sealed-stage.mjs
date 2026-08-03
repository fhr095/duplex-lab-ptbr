import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = resolve(import.meta.dirname, "..");

// This launcher intentionally imports no project module. It authenticates the
// frozen project sources before granting a child access to any stage dataset.
export const SEALED_CRITICAL_SOURCES = Object.freeze([
  "docs/experiments/EXP-0018-context-observability-screen.md",
  "package.json",
  "scripts/activate-exp-0018-development.mjs",
  "scripts/calibrate-exp-0018-context.mjs",
  "scripts/consume-exp-0018-development-opening.mjs",
  "scripts/eval-exp-0018-context-development.mjs",
  "scripts/fit-exp-0018-context.mjs",
  "scripts/freeze-exp-0018-prefit.mjs",
  "scripts/invalidate-exp-0018-development.mjs",
  "scripts/lib/exp-0018-io.mjs",
  "scripts/run-exp-0018-sealed-stage.mjs",
  "src/eval/exp-0018-boundary.mjs",
  "src/eval/exp-0018-context.mjs",
  "src/eval/exp-0018-training.mjs",
  "src/eval/experiment-index.mjs",
  "src/eval/factory/canonical-hash.mjs",
  "src/learning/softmax-classifier.mjs",
  "tests/exp-0018-boundary.test.mjs",
  "tests/exp-0018-training.test.mjs",
  "tests/experiment-index.test.mjs"
]);

const PATHS = Object.freeze({
  config: "eval/experiments/exp-0018-context-observability-v0.1.json",
  catalog: "eval/experiments/exp-0018-context-pairs.pt-BR.v0.1.json",
  fit: "eval/datasets/exp-0018-context-fit-v0.1.json",
  calibration: "eval/datasets/exp-0018-context-calibration-v0.1.json",
  development: "eval/datasets/exp-0018-context-development-v0.1.json",
  freeze: "eval/commitments/exp-0018-prefit-freeze-v0.1.json",
  candidate: "eval/checkpoints/exp-0018-fit-candidate-v0.1.json",
  attestation: "eval/commitments/exp-0018-train-attestation-v0.1.json",
  checkpoint: "eval/checkpoints/exp-0018-context-v0.1.json",
  activation:
    "eval/commitments/exp-0018-development-activation-v0.1.json",
  opening: "eval/commitments/exp-0018-development-opening-v0.1.json",
  attempt: "eval/commitments/exp-0018-development-attempt-v0.1.json",
  report: "eval/reports/exp-0018-context-development-v0.1.json"
});

export const SEALED_STAGE_SPECS = Object.freeze({
  fit: Object.freeze({
    entry: "scripts/fit-exp-0018-context.mjs",
    reads: Object.freeze([PATHS.config, PATHS.fit, PATHS.freeze]),
    writes: Object.freeze([PATHS.candidate, PATHS.attestation]),
    committedInputs: Object.freeze([PATHS.config, PATHS.fit, PATHS.freeze])
  }),
  calibration: Object.freeze({
    entry: "scripts/calibrate-exp-0018-context.mjs",
    reads: Object.freeze([
      PATHS.config,
      PATHS.calibration,
      PATHS.freeze,
      PATHS.candidate,
      PATHS.attestation
    ]),
    writes: Object.freeze([PATHS.checkpoint]),
    committedInputs: Object.freeze([
      PATHS.config,
      PATHS.calibration,
      PATHS.freeze,
      PATHS.candidate,
      PATHS.attestation
    ])
  }),
  activation: Object.freeze({
    entry: "scripts/activate-exp-0018-development.mjs",
    reads: Object.freeze([
      PATHS.config,
      PATHS.calibration,
      PATHS.freeze,
      PATHS.attestation,
      PATHS.checkpoint
    ]),
    writes: Object.freeze([PATHS.activation]),
    committedInputs: Object.freeze([
      PATHS.config,
      PATHS.calibration,
      PATHS.freeze,
      PATHS.attestation,
      PATHS.checkpoint
    ])
  }),
  opening: Object.freeze({
    entry: "scripts/consume-exp-0018-development-opening.mjs",
    reads: Object.freeze([
      PATHS.config,
      PATHS.freeze,
      PATHS.attestation,
      PATHS.checkpoint,
      PATHS.activation
    ]),
    writes: Object.freeze([PATHS.opening]),
    committedInputs: Object.freeze([
      PATHS.config,
      PATHS.freeze,
      PATHS.attestation,
      PATHS.checkpoint,
      PATHS.activation
    ])
  }),
  invalidation: Object.freeze({
    entry: "scripts/invalidate-exp-0018-development.mjs",
    reads: Object.freeze([
      PATHS.config,
      PATHS.freeze,
      PATHS.attestation,
      PATHS.checkpoint,
      PATHS.activation,
      PATHS.opening,
      PATHS.attempt
    ]),
    writes: Object.freeze([PATHS.report]),
    committedInputs: Object.freeze([
      PATHS.config,
      PATHS.freeze,
      PATHS.attestation,
      PATHS.checkpoint,
      PATHS.activation,
      PATHS.opening,
      PATHS.attempt
    ])
  }),
  development: Object.freeze({
    entry: "scripts/eval-exp-0018-context-development.mjs",
    reads: Object.freeze([
      PATHS.config,
      PATHS.development,
      PATHS.freeze,
      PATHS.attestation,
      PATHS.checkpoint,
      PATHS.activation,
      PATHS.opening,
      PATHS.attempt
    ]),
    preflightReads: Object.freeze([
      PATHS.config,
      PATHS.development,
      PATHS.freeze,
      PATHS.attestation,
      PATHS.checkpoint,
      PATHS.activation,
      PATHS.opening
    ]),
    launcherWrites: Object.freeze([PATHS.attempt]),
    writes: Object.freeze([PATHS.report]),
    committedInputs: Object.freeze([
      PATHS.config,
      PATHS.development,
      PATHS.freeze,
      PATHS.attestation,
      PATHS.checkpoint,
      PATHS.activation,
      PATHS.opening
    ])
  })
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(`EXP-0018 sealed preflight: ${message}`);
  }
}

function absolute(path) {
  return resolve(PROJECT_ROOT, path);
}

async function git(...args) {
  const result = await execFileAsync("git", args, { cwd: PROJECT_ROOT });
  return result.stdout.trim();
}

async function sha256File(path) {
  const bytes = await readFile(absolute(path));
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function assertRegularUnaliased(path) {
  const target = absolute(path);
  const stat = await lstat(target);
  assert(stat.isFile() && !stat.isSymbolicLink(),
    `${path} precisa ser arquivo regular, nunca symlink`);
  assert(await realpath(target) === target,
    `${path} resolve para destino externo ou alias`);
}

export async function assertSafeParentChain(target, root = PROJECT_ROOT) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const relativeTarget = relative(resolvedRoot, resolvedTarget);
  assert(
    relativeTarget !== ".." &&
    !relativeTarget.startsWith(`..${sep}`) &&
    !isAbsolute(relativeTarget),
    `destino de escrita sai da raiz física: ${resolvedTarget}`
  );
  const rootStat = await lstat(resolvedRoot);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(),
    `raiz de escrita precisa ser diretório regular: ${resolvedRoot}`);
  assert(await realpath(resolvedRoot) === resolvedRoot,
    `raiz de escrita não pode resolver por alias: ${resolvedRoot}`);
  const parent = dirname(resolvedTarget);
  const relativeParent = relative(resolvedRoot, parent);
  let current = resolvedRoot;
  for (const component of relativeParent.split(sep).filter(Boolean)) {
    current = resolve(current, component);
    const stat = await lstat(current);
    assert(stat.isDirectory() && !stat.isSymbolicLink(),
      `pai de escrita não pode ser symlink: ${current}`);
    assert(await realpath(current) === current,
      `pai de escrita resolve por alias: ${current}`);
  }
  return true;
}

async function assertAbsent(path) {
  await assertSafeParentChain(absolute(path));
  try {
    await access(absolute(path));
    throw new Error(`EXP-0018 sealed preflight: output já existe: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" ||
      typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  assert(value && Object.getPrototypeOf(value) === Object.prototype,
    "attempt contém valor não canônico");
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  ).join(",")}}`;
}

export function createSealedDevelopmentAttempt(input = {}) {
  const core = {
    schemaVersion: "exp-0018-development-attempt-v1",
    experimentId: "EXP-0018",
    status: "development-attempt-consumed",
    bindings: {
      developmentOpeningFileSha256: input.developmentOpeningFileSha256,
      developmentOpeningSha256: input.developmentOpeningSha256,
      checkpointSha256: input.checkpointSha256
    },
    attempt: {
      ordinal: 1,
      createdBeforeDevelopmentPermission: true,
      preflightCommit: input.preflightCommit
    },
    authority: { mode: "offline-shadow-only", canProduceEffects: false }
  };
  return Object.freeze({
    ...core,
    developmentAttemptSha256: `sha256:${createHash("sha256")
      .update(canonicalJson(core)).digest("hex")}`
  });
}

export async function consumeSealedDevelopmentAttempt(
  target,
  input,
  root = PROJECT_ROOT
) {
  await assertSafeParentChain(target, root);
  const attempt = createSealedDevelopmentAttempt(input);
  await writeFile(
    target,
    `${JSON.stringify(attempt, null, 2)}\n`,
    { flag: "wx" }
  );
  return attempt;
}

export function permissionArgsForExp0018Stage(stageName) {
  const spec = SEALED_STAGE_SPECS[stageName];
  assert(spec, `estágio desconhecido: ${stageName}`);
  const reads = [...new Set([
    ...SEALED_CRITICAL_SOURCES,
    ...spec.reads
  ])];
  return Object.freeze([
    "--permission",
    ...reads.map((path) => `--allow-fs-read=${absolute(path)}`),
    ...spec.writes.map((path) => `--allow-fs-write=${absolute(path)}`),
    absolute(spec.entry)
  ]);
}

export async function preflightExp0018Stage(stageName) {
  const spec = SEALED_STAGE_SPECS[stageName];
  assert(spec, `estágio desconhecido: ${stageName}`);
  assert(await realpath(PROJECT_ROOT) === PROJECT_ROOT,
    "raiz do projeto não pode ser symlink");
  const status = await git("status", "--porcelain=v1", "--untracked-files=all");
  assert(status === "", "worktree precisa estar limpa");
  const commit = await git("rev-parse", "HEAD");
  await assertRegularUnaliased(PATHS.freeze);
  const freezeBytes = await readFile(absolute(PATHS.freeze));
  const freeze = JSON.parse(freezeBytes.toString("utf8"));
  assert(
    freeze?.schemaVersion === "exp-0018-prefit-freeze-v1" &&
    freeze?.status === "fit-authorized-development-sealed",
    "freeze ausente ou incompatível"
  );
  assert(
    JSON.stringify(freeze.criticalSources?.map((item) => item.path)) ===
      JSON.stringify(SEALED_CRITICAL_SOURCES),
    "lista de fontes críticas diverge do launcher imutável"
  );
  await git("merge-base", "--is-ancestor", freeze.runnerSourceCommit, commit);
  for (const source of freeze.criticalSources) {
    await assertRegularUnaliased(source.path);
    assert(await sha256File(source.path) === source.fileSha256,
      `fonte crítica divergiu: ${source.path}`);
    await git("ls-files", "--error-unmatch", source.path);
  }
  for (const path of spec.preflightReads ?? spec.reads) {
    await assertRegularUnaliased(path);
  }
  for (const path of spec.committedInputs) {
    await git("ls-files", "--error-unmatch", path);
  }
  for (const path of [...(spec.launcherWrites ?? []), ...spec.writes]) {
    await assertAbsent(path);
  }
  return Object.freeze({ commit, spec });
}

export async function runExp0018SealedStage(stageName) {
  const { commit, spec } = await preflightExp0018Stage(stageName);
  if (stageName === "development") {
    const openingBytes = await readFile(absolute(PATHS.opening));
    const opening = JSON.parse(openingBytes.toString("utf8"));
    const attemptInput = {
      developmentOpeningFileSha256:
        `sha256:${createHash("sha256").update(openingBytes).digest("hex")}`,
      developmentOpeningSha256: opening.developmentOpeningSha256,
      checkpointSha256: opening.bindings?.checkpointSha256,
      preflightCommit: commit
    };
    assert((spec.launcherWrites ?? []).includes(PATHS.attempt),
      "contrato não autorizou receipt de tentativa");
    await consumeSealedDevelopmentAttempt(
      absolute(PATHS.attempt),
      attemptInput,
      PROJECT_ROOT
    );
  }
  const environment = {
    EXP0018_PREFLIGHT_COMMIT: commit,
    EXP0018_SEALED_STAGE: stageName,
    LANG: "C.UTF-8",
    TZ: "America/Sao_Paulo"
  };
  const child = await execFileAsync(
    process.execPath,
    permissionArgsForExp0018Stage(stageName),
    {
      cwd: PROJECT_ROOT,
      env: environment,
      maxBuffer: 10 * 1024 * 1024
    }
  );
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
}

async function main() {
  const stageName = process.argv[2];
  await runExp0018SealedStage(stageName);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
