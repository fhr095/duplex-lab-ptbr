import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  EXP0018_CRITICAL_SOURCE_PATHS,
  EXP0018_PATHS,
  EXP0018_STAGE_CONTRACTS,
  createExp0018DevelopmentActivation,
  createExp0018DevelopmentOpening,
  createExp0018PrefitFreeze,
  createExp0018TrainAttestation,
  validateExp0018DevelopmentActivation,
  validateExp0018DevelopmentAttempt,
  validateExp0018DevelopmentOpening,
  validateExp0018CheckpointChain,
  validateExp0018PrefitFreeze,
  validateExp0018TrainAttestation
} from "../src/eval/exp-0018-boundary.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import {
  SEALED_CRITICAL_SOURCES,
  SEALED_STAGE_SPECS,
  assertSafeParentChain,
  consumeSealedDevelopmentAttempt,
  permissionArgsForExp0018Stage
} from "../scripts/run-exp-0018-sealed-stage.mjs";

const execFileAsync = promisify(execFile);
const SHA = `sha256:${"b".repeat(64)}`;
const COMMIT = "c".repeat(40);

function filesystemBoundary(stage) {
  const contract = EXP0018_STAGE_CONTRACTS[stage];
  return {
    permissionModelEnabled: true,
    environmentSanitized: true,
    nodeVersion: process.version,
    preflightCommit: COMMIT,
    allowedDataReads: [...contract.dataReads],
    deniedDataReads: [...contract.prohibitedDataReads],
    allowedWrites: [...contract.writes],
    denialProbesPassed: true
  };
}

function artifact(path) {
  return { path, fileSha256: SHA, canonicalSha256: SHA };
}

function freezeFixture() {
  return createExp0018PrefitFreeze({
    runnerSourceCommit: COMMIT,
    nodeVersion: process.version,
    artifacts: {
      config: artifact(EXP0018_PATHS.config),
      catalog: artifact(EXP0018_PATHS.catalog),
      fitDataset: {
        ...artifact(EXP0018_PATHS.fitDataset),
        readSetSha256: SHA
      },
      calibrationDataset: artifact(EXP0018_PATHS.calibrationDataset),
      developmentDataset: artifact(EXP0018_PATHS.developmentDataset),
      instrumentationAudit: artifact(EXP0018_PATHS.instrumentationAudit),
      blindSemanticReview: artifact(EXP0018_PATHS.blindSemanticReview)
    },
    criticalSources: EXP0018_CRITICAL_SOURCE_PATHS.map((path) => ({
      path,
      fileSha256: SHA
    }))
  });
}

function rehash(value, key) {
  const updated = structuredClone(value);
  delete updated[key];
  return {
    ...updated,
    [key]: `sha256:${canonicalSha256(updated)}`
  };
}

test("freeze fixa artefatos, código e allowlists exatas", () => {
  const freeze = freezeFixture();
  assert.equal(validateExp0018PrefitFreeze(freeze).valid, true);
  const tampered = structuredClone(freeze);
  tampered.stageContracts.fit.dataReads.push(
    EXP0018_PATHS.developmentDataset
  );
  const coherentlyRehashed = rehash(tampered, "prefitFreezeSha256");
  assert.equal(validateExp0018PrefitFreeze(coherentlyRehashed).valid, false);

  for (const [name, contract] of Object.entries(EXP0018_STAGE_CONTRACTS)) {
    assert.equal(
      contract.dataReads.some((path) =>
        contract.prohibitedDataReads.includes(path)
      ),
      false,
      `${name} não pode permitir e proibir a mesma leitura`
    );
  }
});

test("attestation compromete os 48 exemplos e prova negações físicas", () => {
  const examples = Array.from({ length: 48 }, (_, index) => ({
    exampleId: `example-${index}`,
    value: index
  }));
  const candidate = {
    fitCandidateSha256: SHA,
    arms: {
      B0: { modelSha256: SHA },
      B1: { modelSha256: SHA }
    }
  };
  const attestation = createExp0018TrainAttestation({
    prefitFreezeSha256: SHA,
    fitCandidate: candidate,
    configFileSha256: SHA,
    configCanonicalSha256: SHA,
    fitDatasetFileSha256: SHA,
    fitDataset: { datasetSha256: SHA, examples },
    runnerSourceCommit: COMMIT,
    fitExecutionCommit: COMMIT,
    filesystemBoundary: {
      permissionModelEnabled: true,
      environmentSanitized: true,
      nodeVersion: process.version,
      preflightCommit: COMMIT,
      allowedDataReads: [...EXP0018_STAGE_CONTRACTS.fit.dataReads],
      deniedDataReads: [...EXP0018_STAGE_CONTRACTS.fit.prohibitedDataReads],
      allowedWrites: [...EXP0018_STAGE_CONTRACTS.fit.writes],
      denialProbesPassed: true
    }
  });
  assert.equal(validateExp0018TrainAttestation(attestation).valid, true);
  const tampered = structuredClone(attestation);
  tampered.filesystemBoundary.deniedDataReads.pop();
  assert.equal(
    validateExp0018TrainAttestation(
      rehash(tampered, "trainAttestationSha256")
    ).valid,
    false
  );
});

test("activation e opening só admitem uma abertura vinculada", () => {
  const activation = createExp0018DevelopmentActivation({
    checkpointSourceCommit: COMMIT,
    prefitFreezeFileSha256: SHA,
    prefitFreezeSha256: SHA,
    trainAttestationFileSha256: SHA,
    trainAttestationSha256: SHA,
    checkpointFileSha256: SHA,
    checkpointSha256: SHA,
    configFileSha256: SHA,
    filesystemBoundary: filesystemBoundary("activation")
  });
  assert.equal(validateExp0018DevelopmentActivation(activation).valid, true);
  const missing = structuredClone(activation);
  delete missing.bindings.checkpointSha256;
  assert.equal(validateExp0018DevelopmentActivation(
    rehash(missing, "developmentActivationSha256")
  ).valid, false);

  const opening = createExp0018DevelopmentOpening({
    developmentActivationSha256: activation.developmentActivationSha256,
    checkpointSha256: SHA,
    developmentDatasetFileSha256: SHA,
    developmentDatasetCanonicalSha256: SHA,
    openingExecutionCommit: COMMIT,
    filesystemBoundary: filesystemBoundary("opening")
  });
  assert.equal(validateExp0018DevelopmentOpening(opening).valid, true);
});

test("tentativa de development é exclusiva antes de conceder leitura", async () => {
  const directory = await mkdtemp(join(tmpdir(), "exp0018-attempt-"));
  const target = join(directory, "attempt.json");
  const input = {
    developmentOpeningFileSha256: SHA,
    developmentOpeningSha256: SHA,
    checkpointSha256: SHA,
    preflightCommit: COMMIT
  };
  const results = await Promise.allSettled([
    consumeSealedDevelopmentAttempt(target, input, directory),
    consumeSealedDevelopmentAttempt(target, input, directory)
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) =>
    item.status === "rejected" && item.reason?.code === "EEXIST"
  ).length, 1);
  const attempt = JSON.parse(await readFile(target, "utf8"));
  assert.equal(validateExp0018DevelopmentAttempt(attempt).valid, true);
});

test("pai symlinkado nunca pode redirecionar escrita", async () => {
  const directory = await mkdtemp(join(tmpdir(), "exp0018-parent-"));
  const physical = join(directory, "physical");
  const alias = join(directory, "alias");
  await mkdir(physical);
  await symlink(physical, alias, "dir");
  await assert.rejects(
    assertSafeParentChain(join(alias, "escaped.json"), directory),
    /pai de escrita não pode ser symlink|resolve por alias/u
  );
});

test("chain rejeita troca coerente de candidate, modelo ou dataset", () => {
  const freeze = freezeFixture();
  const attestation = {
    trainAttestationSha256: SHA,
    bindings: {
      prefitFreezeSha256: freeze.prefitFreezeSha256,
      configFileSha256: SHA,
      configCanonicalSha256: SHA,
      fitDatasetFileSha256: SHA,
      fitDatasetCanonicalSha256: SHA,
      runnerSourceCommit: COMMIT
    },
    readSet: { readSetSha256: SHA },
    outputs: {
      fitCandidateSha256: SHA,
      modelSha256: { B0: SHA, B1: SHA }
    }
  };
  const checkpoint = {
    bindings: {
      prefitFreezeSha256: freeze.prefitFreezeSha256,
      fitCandidateSha256: SHA,
      fitAttestationSha256: SHA,
      configFileSha256: SHA,
      configCanonicalSha256: SHA,
      fitDatasetCanonicalSha256: SHA,
      calibrationDatasetFileSha256: SHA,
      calibrationDatasetCanonicalSha256: SHA
    },
    arms: { B0: { modelSha256: SHA }, B1: { modelSha256: SHA } },
    claims: { maximumClaim: "claim congelada" }
  };
  const input = {
    freeze,
    config: { maximumClaim: "claim congelada" },
    attestation,
    checkpoint
  };
  assert.equal(validateExp0018CheckpointChain(input).valid, true);
  for (const mutate of [
    (value) => { value.checkpoint.bindings.fitCandidateSha256 =
      `sha256:${"1".repeat(64)}`; },
    (value) => { value.checkpoint.arms.B1.modelSha256 =
      `sha256:${"2".repeat(64)}`; },
    (value) => { value.attestation.bindings.fitDatasetFileSha256 =
      `sha256:${"3".repeat(64)}`; }
  ]) {
    const changed = structuredClone(input);
    mutate(changed);
    assert.equal(validateExp0018CheckpointChain(changed).valid, false);
  }
});

test("launchers não concedem a cada estágio seus datasets proibidos", async () => {
  const packageJson = JSON.parse(await readFile(
    new URL("../package.json", import.meta.url), "utf8"
  ));
  const scripts = packageJson.scripts;
  const names = {
    fit: "eval:exp:0018:fit",
    calibration: "eval:exp:0018:calibrate",
    activation: "eval:exp:0018:activate-development",
    opening: "eval:exp:0018:open-development",
    invalidation: "eval:exp:0018:invalidate-development",
    development: "eval:exp:0018:development"
  };
  for (const [stage, scriptName] of Object.entries(names)) {
    const command = scripts[scriptName];
    assert.equal(
      command,
      `node scripts/run-exp-0018-sealed-stage.mjs ${stage}`
    );
    const permissionArgs = permissionArgsForExp0018Stage(stage);
    for (const path of EXP0018_STAGE_CONTRACTS[stage].dataReads) {
      assert.equal(
        permissionArgs.some((arg) =>
          arg.startsWith("--allow-fs-read=") && arg.endsWith(path)
        ),
        true
      );
    }
    for (const path of EXP0018_STAGE_CONTRACTS[stage].prohibitedDataReads) {
      assert.equal(
        permissionArgs.some((arg) =>
          arg.startsWith("--allow-fs-read=") && arg.endsWith(path)
        ),
        false
      );
    }
    for (const path of EXP0018_STAGE_CONTRACTS[stage].writes) {
      assert.equal(
        permissionArgs.some((arg) =>
          arg.startsWith("--allow-fs-write=") && arg.endsWith(path)
        ),
        true
      );
    }
    assert.deepEqual(SEALED_STAGE_SPECS[stage].reads,
      EXP0018_STAGE_CONTRACTS[stage].dataReads);
  }
  assert.deepEqual(SEALED_CRITICAL_SOURCES, EXP0018_CRITICAL_SOURCE_PATHS);
  assert.equal(
    SEALED_STAGE_SPECS.calibration.committedInputs.includes(
      EXP0018_PATHS.fitCandidate
    ) && SEALED_STAGE_SPECS.calibration.committedInputs.includes(
      EXP0018_PATHS.trainAttestation
    ),
    true
  );
  assert.equal(
    SEALED_STAGE_SPECS.development.committedInputs.includes(
      EXP0018_PATHS.developmentOpening
    ),
    true
  );
  assert.deepEqual(
    SEALED_STAGE_SPECS.development.launcherWrites,
    [EXP0018_PATHS.developmentAttempt]
  );
  const everyPermission = Object.keys(names).flatMap((stage) =>
    permissionArgsForExp0018Stage(stage)
  );
  assert.equal(everyPermission.some((arg) =>
    /--allow-fs-read=.*\/(?:scripts|src\/eval|src\/learning)$/u.test(arg)
  ), false);
});

test("Node Permission Model nega leitura fora da allowlist", async () => {
  const directory = await mkdtemp(join(tmpdir(), "exp0018-permission-"));
  const allowed = join(directory, "allowed.json");
  const denied = join(directory, "denied.json");
  const probe = join(directory, "probe.mjs");
  await writeFile(allowed, "{}\n");
  await writeFile(denied, "{}\n");
  await writeFile(probe, `
    import { readFile } from "node:fs/promises";
    await readFile(${JSON.stringify(allowed)});
    try {
      await readFile(${JSON.stringify(denied)});
      process.exitCode = 9;
    } catch (error) {
      if (error.code !== "ERR_ACCESS_DENIED") process.exitCode = 8;
    }
  `);
  await execFileAsync(process.execPath, [
    "--permission",
    `--allow-fs-read=${probe}`,
    `--allow-fs-read=${allowed}`,
    probe
  ]);
});
