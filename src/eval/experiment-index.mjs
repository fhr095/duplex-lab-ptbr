import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const EXPERIMENT_INDEX_SCHEMA_VERSION = 1;

export const EXPERIMENT_STATUSES = Object.freeze([
  "active",
  "completed",
  "cut",
  "held",
  "planned",
  "promoted",
  "rejected"
]);

export const EXPERIMENT_AUTHORITIES = Object.freeze([
  "none",
  "runtime-control",
  "runtime-guardrail",
  "shadow-only"
]);

const STATUS_SET = new Set(EXPERIMENT_STATUSES);
const AUTHORITY_SET = new Set(EXPERIMENT_AUTHORITIES);
const EXPERIMENT_ID_PATTERN = /^EXP-\d{4}$/u;
const EXPERIMENT_TRACK_ID_PATTERN = /^EXP-\d{4}-[A-Z]$/u;
const EXPERIMENT_RANGE_PATTERN = /^(EXP-\d{4})\.\.(EXP-\d{4})$/u;

// Deliberately separate from the editable index: changing one JSON file must
// not be enough to rewrite a historical decision or grant authority.
const CANONICAL_REPORT_CONTRACTS = Object.freeze({
  "EXP-0007": {
    status: "rejected",
    authority: "none",
    decisionPath: "screening.decision",
    assertions: [["interpretation.promoted", false]]
  },
  "EXP-0008": {
    status: "held",
    authority: "none",
    decisionPath: "decision",
    assertions: [["authorizedAuthority", "none"]]
  },
  "EXP-0009": {
    status: "promoted",
    authority: "runtime-guardrail",
    decisionPath: "decision",
    assertions: [["pass", true], ["gates.guardObservedEveryTime", true]]
  },
  "EXP-0010": {
    status: "promoted",
    authority: "runtime-control",
    decisionPath: "decision",
    assertions: [["pass", true], ["gates.singleAuthority", true]]
  },
  "EXP-0011": {
    status: "promoted",
    authority: "runtime-control",
    decisionPath: "decision",
    assertions: [["pass", true], ["gates.lateTranscriptCannotLeak", true]]
  },
  "EXP-0012": {
    status: "promoted",
    authority: "runtime-control",
    decisionPath: "decision",
    assertions: [["pass", true], ["gates.exactBrowserReplay", true]]
  },
  "EXP-0013": {
    status: "promoted",
    authority: "none",
    decisionPath: "decision",
    assertions: [["gates.shadowHasNoAuthority", true]]
  },
  "EXP-0014": {
    status: "promoted",
    authority: "shadow-only",
    decisionPath: "decision",
    assertions: [
      ["evidence.checkpoint.authority.mode", "shadow"],
      ["evidence.checkpoint.authority.canProduceEffects", false]
    ]
  },
  "EXP-0015": {
    status: "completed",
    authority: "none",
    decisionPath: "decisions.humanCalibration",
    assertions: [
      ["gates.noModelAuthority", true],
      ["aggregate.readyForDirectModelFit", false]
    ]
  },
  "EXP-0016": {
    status: "promoted",
    authority: "shadow-only",
    decisionPath: "decision",
    assertions: [
      ["authorityEligible", false],
      ["browserGates.zeroAuthority", true]
    ]
  }
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Invalid experiment index: ${message}`);
  }
}

function assertObject(value, label) {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`
  );
}

function experimentNumber(experimentId) {
  return Number.parseInt(experimentId.slice(4), 10);
}

function experimentId(number) {
  return `EXP-${String(number).padStart(4, "0")}`;
}

function inclusiveExperimentIds(firstId, lastId) {
  const first = experimentNumber(firstId);
  const last = experimentNumber(lastId);
  assert(first <= last, `${firstId} must not come after ${lastId}`);
  return Array.from(
    { length: last - first + 1 },
    (_, offset) => experimentId(first + offset)
  );
}

function valueAtPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function resolveRepositoryPath(projectRoot, repositoryPath, label) {
  assert(
    typeof repositoryPath === "string" && repositoryPath.length > 0,
    `${label} must be a non-empty repository-relative path`
  );
  assert(!isAbsolute(repositoryPath), `${label} must be repository-relative`);

  const root = resolve(projectRoot);
  const target = resolve(root, repositoryPath);
  const fromRoot = relative(root, target);
  assert(
    fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`),
    `${label} must stay inside the repository`
  );
  return target;
}

async function assertFileExists(path, label) {
  try {
    await access(path);
  } catch {
    throw new Error(`Invalid experiment index: ${label} does not exist`);
  }
}

async function assertCanonicalReport(entry, projectRoot) {
  if (entry.canonicalReport === null) {
    assert(
      entry.status === "active" || entry.status === "planned",
      `${entry.id}.canonicalReport may be null only while active or planned`
    );
    assert(
      entry.authority === "none",
      `${entry.id} cannot have authority before a canonical report`
    );
    return;
  }

  const path = resolveRepositoryPath(
    projectRoot,
    entry.canonicalReport,
    `${entry.id}.canonicalReport`
  );
  await assertFileExists(path, `${entry.id}.canonicalReport`);

  let report;
  try {
    report = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(
      `Invalid experiment index: ${entry.id}.canonicalReport must be valid JSON`
    );
  }
  const reportId = report?.experimentId;
  assert(
    typeof reportId === "string" &&
      reportId.toUpperCase().startsWith(entry.id),
    `${entry.id}.canonicalReport identifies a different experiment`
  );

  const contract = CANONICAL_REPORT_CONTRACTS[entry.id];
  assert(contract, `${entry.id} has no canonical report contract`);
  assert(
    entry.status === contract.status,
    `${entry.id}.status contradicts its canonical report contract`
  );
  assert(
    entry.authority === contract.authority,
    `${entry.id}.authority contradicts its canonical report contract`
  );
  assert(
    valueAtPath(report, contract.decisionPath) === entry.decision,
    `${entry.id}.decision contradicts its canonical report`
  );
  for (const [assertionPath, expected] of contract.assertions) {
    assert(
      valueAtPath(report, assertionPath) === expected,
      `${entry.id}.canonicalReport violates ${assertionPath}`
    );
  }
}

function validateEntryShape(entry, index) {
  assertObject(entry, `entries[${index}]`);
  assert(
    typeof entry.id === "string" && EXPERIMENT_ID_PATTERN.test(entry.id),
    `entries[${index}].id must match EXP-0000`
  );
  assert(
    STATUS_SET.has(entry.status),
    `${entry.id}.status is invalid: ${String(entry.status)}`
  );
  assert(
    AUTHORITY_SET.has(entry.authority),
    `${entry.id}.authority is invalid: ${String(entry.authority)}`
  );
  assert(
    typeof entry.decision === "string" && entry.decision.length > 0,
    `${entry.id}.decision must be a non-empty string`
  );
  assert(
    typeof entry.criticalPath === "boolean",
    `${entry.id}.criticalPath must be boolean`
  );
  assert(
    Array.isArray(entry.cleanCloneChecks) &&
      entry.cleanCloneChecks.every(
        (command) => typeof command === "string" && command.length > 0
      ),
    `${entry.id}.cleanCloneChecks must contain only non-empty strings`
  );
  assert(
    Array.isArray(entry.localReproductionCommands) &&
      entry.localReproductionCommands.every(
        (command) => typeof command === "string" && command.length > 0
      ),
    `${entry.id}.localReproductionCommands must contain only non-empty strings`
  );
  assert(
    Array.isArray(entry.supersedes) &&
      entry.supersedes.every(
        (experimentId) =>
          typeof experimentId === "string" &&
          EXPERIMENT_ID_PATTERN.test(experimentId)
      ),
    `${entry.id}.supersedes must contain only experiment IDs`
  );
  assert(
    typeof entry.nextDecision === "string" && entry.nextDecision.length > 0,
    `${entry.id}.nextDecision must be a non-empty string`
  );
}

export async function validateExperimentIndex(index, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  assertObject(index, "root");
  assert(
    index.schemaVersion === EXPERIMENT_INDEX_SCHEMA_VERSION,
    `schemaVersion must be ${EXPERIMENT_INDEX_SCHEMA_VERSION}`
  );
  assert(
    typeof index.updatedAt === "string" &&
      Number.isFinite(Date.parse(index.updatedAt)),
    "updatedAt must be an ISO-compatible timestamp"
  );

  assertObject(index.coverage, "coverage");
  assert(
    typeof index.coverage.canonicalDecisionEntriesFrom === "string" &&
      EXPERIMENT_ID_PATTERN.test(index.coverage.canonicalDecisionEntriesFrom),
    "coverage.canonicalDecisionEntriesFrom must be an experiment ID"
  );
  assert(
    typeof index.coverage.legacyRange === "string" &&
      EXPERIMENT_RANGE_PATTERN.test(index.coverage.legacyRange),
    "coverage.legacyRange must be an inclusive experiment range"
  );
  assert(
    Array.isArray(index.coverage.legacyExperimentDocs) &&
      index.coverage.legacyExperimentDocs.length > 0,
    "coverage.legacyExperimentDocs must not be empty"
  );
  const legacyRangeMatch = index.coverage.legacyRange.match(
    EXPERIMENT_RANGE_PATTERN
  );
  const expectedLegacyIds = inclusiveExperimentIds(
    legacyRangeMatch[1],
    legacyRangeMatch[2]
  );
  assert(
    experimentNumber(index.coverage.canonicalDecisionEntriesFrom) ===
      experimentNumber(legacyRangeMatch[2]) + 1,
    "canonical decision coverage must begin immediately after legacyRange"
  );
  const legacyDocIds = [];
  for (const [position, repositoryPath] of
    index.coverage.legacyExperimentDocs.entries()) {
    const path = resolveRepositoryPath(
      projectRoot,
      repositoryPath,
      `coverage.legacyExperimentDocs[${position}]`
    );
    await assertFileExists(
      path,
      `coverage.legacyExperimentDocs[${position}]`
    );
    const idMatch = repositoryPath.match(
      /(?:^|\/)(EXP-\d{4})-[^/]+\.md$/u
    );
    assert(
      idMatch,
      `coverage.legacyExperimentDocs[${position}] must identify an experiment`
    );
    legacyDocIds.push(idMatch[1]);
  }
  assert(
    JSON.stringify(legacyDocIds) === JSON.stringify(expectedLegacyIds),
    "legacyExperimentDocs must cover legacyRange exactly and in order"
  );

  assertObject(index.currentBaseline, "currentBaseline");
  assert(
    typeof index.currentBaseline.id === "string" &&
      index.currentBaseline.id.length > 0,
    "currentBaseline.id must be a non-empty string"
  );
  const baselinePath = resolveRepositoryPath(
    projectRoot,
    index.currentBaseline.manifest,
    "currentBaseline.manifest"
  );
  await assertFileExists(baselinePath, "currentBaseline.manifest");
  let baseline;
  try {
    baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  } catch {
    throw new Error(
      "Invalid experiment index: currentBaseline.manifest must be valid JSON"
    );
  }
  assert(
    baseline?.id === index.currentBaseline.id,
    "currentBaseline.id must match its manifest"
  );

  assert(
    typeof index.currentCriticalPath === "string" &&
      EXPERIMENT_ID_PATTERN.test(index.currentCriticalPath),
    "currentCriticalPath must be an experiment ID"
  );
  assertObject(index.currentParallelProbe, "currentParallelProbe");
  assert(
    typeof index.currentParallelProbe.id === "string" &&
      EXPERIMENT_TRACK_ID_PATTERN.test(index.currentParallelProbe.id),
    "currentParallelProbe.id must be an experiment track ID"
  );
  assert(
    index.currentParallelProbe.id === `${index.currentCriticalPath}-R`,
    "currentParallelProbe.id must be the R track of currentCriticalPath"
  );
  assert(
    index.currentParallelProbe.parent === index.currentCriticalPath,
    "currentParallelProbe.parent must match currentCriticalPath"
  );
  assert(
    index.currentParallelProbe.status === "active" ||
      index.currentParallelProbe.status === "planned",
    "currentParallelProbe.status must be active or planned"
  );
  assert(
    index.currentParallelProbe.blocking === false,
    "currentParallelProbe must be non-blocking"
  );
  assert(
    index.currentParallelProbe.authority === "none",
    "currentParallelProbe must have zero authority"
  );
  const probePreRegistration = resolveRepositoryPath(
    projectRoot,
    index.currentParallelProbe.preRegistration,
    "currentParallelProbe.preRegistration"
  );
  await assertFileExists(
    probePreRegistration,
    "currentParallelProbe.preRegistration"
  );
  assert(
    typeof index.currentParallelProbe.decision === "string" &&
      index.currentParallelProbe.decision.length > 0,
    "currentParallelProbe.decision must be a non-empty string"
  );
  assert(Array.isArray(index.entries), "entries must be an array");
  assert(index.entries.length > 0, "entries must not be empty");

  index.entries.forEach(validateEntryShape);
  const ids = index.entries.map((entry) => entry.id);
  assert(
    new Set(ids).size === ids.length,
    "experiment IDs must be unique"
  );
  const expectedIds = inclusiveExperimentIds(
    index.coverage.canonicalDecisionEntriesFrom,
    index.currentCriticalPath
  );
  assert(
    JSON.stringify(ids) === JSON.stringify(expectedIds),
    "entries must cover the canonical decision range exactly and in order"
  );

  const criticalEntries = index.entries.filter((entry) => entry.criticalPath);
  assert(
    criticalEntries.length === 1,
    `exactly one critical path is required; found ${criticalEntries.length}`
  );
  assert(
    criticalEntries[0].id === index.currentCriticalPath,
    "currentCriticalPath must match the entry marked criticalPath"
  );
  assert(
    criticalEntries[0].status === "active" ||
      criticalEntries[0].status === "planned",
    "currentCriticalPath must be active or planned"
  );

  const knownIds = new Set(ids);
  for (const entry of index.entries) {
    assert(
      !entry.supersedes.includes(entry.id),
      `${entry.id} cannot supersede itself`
    );
    for (const supersededId of entry.supersedes) {
      assert(
        knownIds.has(supersededId),
        `${entry.id}.supersedes references unknown ${supersededId}`
      );
    }
    if (entry.canonicalReport !== null) {
      assert(
        entry.cleanCloneChecks.length > 0,
        `${entry.id} must provide at least one clean-clone check`
      );
      for (const command of entry.cleanCloneChecks) {
        const commandMatch = command.match(
          /^node --test (tests\/[A-Za-z0-9._-]+\.test\.mjs)$/u
        );
        assert(
          commandMatch,
          `${entry.id}.cleanCloneChecks must be direct Node test commands`
        );
        const testPath = resolveRepositoryPath(
          projectRoot,
          commandMatch[1],
          `${entry.id}.cleanCloneChecks`
        );
        await assertFileExists(testPath, `${entry.id}.cleanCloneChecks`);
      }
    }
    await assertCanonicalReport(entry, projectRoot);
  }

  return index;
}

export async function readExperimentIndex(path, options = {}) {
  const indexPath = resolve(path);
  let index;
  try {
    index = JSON.parse(await readFile(indexPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read experiment index at ${indexPath}`, {
      cause: error
    });
  }
  return validateExperimentIndex(index, {
    projectRoot: options.projectRoot ?? resolve(dirname(indexPath), "..")
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const indexPath = resolve(
    process.argv[2] ?? "eval/EXPERIMENT_INDEX.json"
  );
  const index = await readExperimentIndex(indexPath);
  const canonicalReports = index.entries.filter(
    ({ canonicalReport }) => canonicalReport !== null
  ).length;
  process.stdout.write(
    `Experiment index PASS: indexed=${index.entries.length}, ` +
      `canonicalReports=${canonicalReports}, ` +
      `critical=${index.currentCriticalPath}, ` +
      `parallel=${index.currentParallelProbe.id}\n`
  );
}
