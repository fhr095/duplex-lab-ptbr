import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  EXP0018_CRITICAL_SOURCE_PATHS,
  EXP0018_STAGE_CONTRACTS
} from "../../src/eval/exp-0018-boundary.mjs";

export const PROJECT_ROOT = resolve(import.meta.dirname, "../..");

export function absoluteProjectPath(path) {
  return resolve(PROJECT_ROOT, path);
}

export function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function readJsonRecord(path) {
  const bytes = await readFile(absoluteProjectPath(path));
  return Object.freeze({
    path,
    fileSha256: sha256Bytes(bytes),
    value: JSON.parse(bytes.toString("utf8"))
  });
}

export async function hashProjectFile(path) {
  return sha256Bytes(await readFile(absoluteProjectPath(path)));
}

export async function writeJsonExclusive(path, value) {
  await writeFile(
    absoluteProjectPath(path),
    `${JSON.stringify(value, null, 2)}\n`,
    { flag: "wx" }
  );
}

export function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertRecordMatches(record, frozen) {
  assertCondition(record.path === frozen?.path,
    `path divergente: ${record.path}`);
  assertCondition(record.fileSha256 === frozen?.fileSha256,
    `fileSha256 divergente: ${record.path}`);
}

export async function verifyCriticalSources(freeze) {
  const observed = [];
  for (const expected of freeze.criticalSources) {
    const fileSha256 = await hashProjectFile(expected.path);
    assertCondition(fileSha256 === expected.fileSha256,
      `fonte crítica divergiu do freeze: ${expected.path}`);
    observed.push({ path: expected.path, fileSha256 });
  }
  assertCondition(
    JSON.stringify(observed.map((item) => item.path)) ===
      JSON.stringify(EXP0018_CRITICAL_SOURCE_PATHS),
    "lista de fontes críticas divergiu"
  );
  return Object.freeze(observed);
}

function permissionHas(scope, path) {
  return process.permission?.has(
    scope,
    absoluteProjectPath(path)
  ) === true;
}

export function verifyStagePermissions(stageName) {
  const contract = EXP0018_STAGE_CONTRACTS[stageName];
  assertCondition(contract, `estágio desconhecido: ${stageName}`);
  assertCondition(process.permission !== undefined,
    "Node Permission Model precisa estar ativo");
  for (const path of contract.dataReads) {
    assertCondition(permissionHas("fs.read", path),
      `leitura obrigatória sem permissão: ${path}`);
  }
  for (const path of contract.prohibitedDataReads) {
    assertCondition(!permissionHas("fs.read", path),
      `leitura proibida recebeu permissão: ${path}`);
  }
  for (const path of contract.writes) {
    assertCondition(permissionHas("fs.write", path),
      `escrita obrigatória sem permissão: ${path}`);
  }
  return Object.freeze({
    permissionModelEnabled: true,
    allowedDataReads: [...contract.dataReads],
    deniedDataReads: [...contract.prohibitedDataReads],
    allowedWrites: [...contract.writes]
  });
}

export function verifySealedLaunch(stageName, freeze) {
  const allowedEnvironmentKeys = new Set([
    "EXP0018_PREFLIGHT_COMMIT",
    "EXP0018_SEALED_STAGE",
    "LANG",
    "TZ"
  ]);
  assertCondition(
    process.env.EXP0018_SEALED_STAGE === stageName &&
    /^[a-f0-9]{40}$/u.test(
      process.env.EXP0018_PREFLIGHT_COMMIT ?? ""
    ),
    "runner precisa ser iniciado pelo preflight selado"
  );
  assertCondition(
    Object.keys(process.env).every((key) => allowedEnvironmentKeys.has(key)),
    "ambiente do runner não foi sanitizado"
  );
  assertCondition(process.version === freeze?.nodeVersion,
    "versão do Node diverge do freeze");
  return Object.freeze({
    environmentSanitized: true,
    nodeVersion: process.version,
    preflightCommit: process.env.EXP0018_PREFLIGHT_COMMIT
  });
}

export async function probeDeniedReads(paths) {
  for (const path of paths) {
    try {
      await readFile(absoluteProjectPath(path));
      throw new Error(`leitura proibida foi possível: ${path}`);
    } catch (error) {
      if (error?.code !== "ERR_ACCESS_DENIED") {
        throw error;
      }
    }
  }
  return true;
}
