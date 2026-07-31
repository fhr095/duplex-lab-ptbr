const SHA256 = /^[a-f0-9]{64}$/u;
const SPLITS = new Set(["development", "validation", "holdout"]);
const ORACLES = new Set(["correction-last-value-wins@1"]);
const PROPOSAL_FIELDS = new Set(["blueprintId", "text", "styleTags"]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} deve ser um objeto`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} deve ser uma string não vazia`);
  }
  return value;
}

function sha(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`${label} deve ser um SHA-256 hexadecimal`);
  }
}

function normalize(value) {
  return String(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function pathValue(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function validateCoverage(coverage) {
  object(coverage, "pack.coverage");
  object(coverage.dimensions, "pack.coverage.dimensions");
  const entries = Object.entries(coverage.dimensions);
  if (entries.length < 2) {
    throw new TypeError("pack.coverage.dimensions precisa de ao menos dois eixos");
  }
  for (const [path, values] of entries) {
    string(path, "caminho de dimensão");
    if (!Array.isArray(values) || values.length === 0) {
      throw new TypeError(`dimensão ${path} não pode estar vazia`);
    }
    const unique = new Set(values.map((value) => string(value, path)));
    if (unique.size !== values.length) {
      throw new TypeError(`dimensão ${path} contém valor duplicado`);
    }
  }
  for (const field of ["minCases", "minPerValue"]) {
    if (!Number.isInteger(coverage[field]) || coverage[field] < 1) {
      throw new TypeError(`pack.coverage.${field} deve ser inteiro positivo`);
    }
  }
  for (const field of ["minUniqueTextRatio", "minPairwiseRatio"]) {
    if (
      !Number.isFinite(coverage[field]) ||
      coverage[field] < 0 ||
      coverage[field] > 1
    ) {
      throw new TypeError(`pack.coverage.${field} deve estar entre 0 e 1`);
    }
  }
}

export function validateGenerationProposal(input) {
  const proposal = object(input, "proposta");
  if (proposal.schemaVersion !== 1) {
    throw new TypeError(`schemaVersion de proposta não suportada: ${proposal.schemaVersion}`);
  }
  string(proposal.batchId, "proposta.batchId");
  if (!Number.isSafeInteger(proposal.seed) || proposal.seed < 0) {
    throw new TypeError("proposta.seed deve ser um inteiro não negativo");
  }
  const provider = object(proposal.provider, "proposta.provider");
  string(provider.id, "proposta.provider.id");
  string(provider.model, "proposta.provider.model");
  for (const field of ["promptSha256", "inputSha256", "outputSha256"]) {
    sha(provider[field], `proposta.provider.${field}`);
  }
  if (!Array.isArray(proposal.proposals) || proposal.proposals.length === 0) {
    throw new TypeError("proposta.proposals não pode estar vazia");
  }
  const seen = new Set();
  proposal.proposals.forEach((item, index) => {
    object(item, `proposta.proposals[${index}]`);
    for (const field of Object.keys(item)) {
      if (!PROPOSAL_FIELDS.has(field)) {
        throw new TypeError(
          `proposta.proposals[${index}] contém campo não permitido: ${field}`
        );
      }
    }
    string(item.blueprintId, `proposta.proposals[${index}].blueprintId`);
    string(item.text, `proposta.proposals[${index}].text`);
    if (!Array.isArray(item.styleTags)) {
      throw new TypeError(`proposta.proposals[${index}].styleTags deve ser array`);
    }
    item.styleTags.forEach((tag, tagIndex) =>
      string(tag, `proposta.proposals[${index}].styleTags[${tagIndex}]`)
    );
    const key = `${item.blueprintId}\u0000${normalize(item.text)}`;
    if (seen.has(key)) {
      throw new TypeError(`proposta duplicada para ${item.blueprintId}`);
    }
    seen.add(key);
  });
  return proposal;
}

function validateCorrectionCase(item, label) {
  const stimulus = object(item.stimulus, `${label}.stimulus`);
  for (const field of [
    "text",
    "slotType",
    "marker",
    "timingPattern",
    "effectRisk"
  ]) {
    string(stimulus[field], `${label}.stimulus.${field}`);
  }
  const slots = object(stimulus.slots, `${label}.stimulus.slots`);
  string(slots.obsolete, `${label}.stimulus.slots.obsolete`);
  string(slots.current, `${label}.stimulus.slots.current`);
  if (normalize(slots.obsolete) === normalize(slots.current)) {
    throw new TypeError(`${label} precisa de slots obsoleto e atual distintos`);
  }
  const text = normalize(stimulus.text);
  if (!text.includes(normalize(slots.obsolete))) {
    throw new TypeError(`${label} não materializa o slot obsoleto`);
  }
  if (!text.includes(normalize(slots.current))) {
    throw new TypeError(`${label} não materializa o slot atual`);
  }
  if (
    stimulus.marker !== "restart" &&
    !text.includes(normalize(stimulus.marker))
  ) {
    throw new TypeError(`${label} não materializa o marcador de correção`);
  }
  const canonicalSlots = stimulus.canonicalSlots
    ? object(stimulus.canonicalSlots, `${label}.stimulus.canonicalSlots`)
    : slots;
  string(
    canonicalSlots.obsolete,
    `${label}.stimulus.canonicalSlots.obsolete`
  );
  string(
    canonicalSlots.current,
    `${label}.stimulus.canonicalSlots.current`
  );

  const oracle = object(item.oracle, `${label}.oracle`);
  if (!ORACLES.has(oracle.ref)) {
    throw new TypeError(`${label}.oracle.ref desconhecido: ${oracle.ref}`);
  }
  const args = object(oracle.args, `${label}.oracle.args`);
  for (const field of ["slot", "obsolete", "current"]) {
    string(args[field], `${label}.oracle.args.${field}`);
  }
  if (
    normalize(args.obsolete) !== normalize(canonicalSlots.obsolete) ||
    normalize(args.current) !== normalize(canonicalSlots.current) ||
    args.slot !== stimulus.slotType
  ) {
    throw new TypeError(`${label}.oracle diverge dos slots confiáveis`);
  }
  if (typeof args.allowProvisionalEffect !== "boolean") {
    throw new TypeError(`${label}.oracle.args.allowProvisionalEffect deve ser booleano`);
  }
}

function validateCase(item, index, familySplits, ids, coverage) {
  const label = `pack.cases[${index}]`;
  object(item, label);
  string(item.id, `${label}.id`);
  if (ids.has(item.id)) {
    throw new TypeError(`case.id duplicado: ${item.id}`);
  }
  ids.add(item.id);
  string(item.familyRootId, `${label}.familyRootId`);
  if (!SPLITS.has(item.split)) {
    throw new TypeError(`${label}.split desconhecido: ${item.split}`);
  }
  const previousSplit = familySplits.get(item.familyRootId);
  if (previousSplit && previousSplit !== item.split) {
    throw new TypeError(
      `família ${item.familyRootId} atravessa splits: ${previousSplit}/${item.split}`
    );
  }
  familySplits.set(item.familyRootId, item.split);
  if (!Number.isSafeInteger(item.seed) || item.seed < 0) {
    throw new TypeError(`${label}.seed deve ser inteiro não negativo`);
  }
  if (item.phenomenon !== "correction") {
    throw new TypeError(`${label}.phenomenon ainda não suportado: ${item.phenomenon}`);
  }
  if (typeof item.critical !== "boolean") {
    throw new TypeError(`${label}.critical deve ser booleano`);
  }
  validateCorrectionCase(item, label);

  const audio = object(item.audioPlan, `${label}.audioPlan`);
  string(audio.ttsRef, `${label}.audioPlan.ttsRef`);
  if (!Number.isFinite(audio.rate) || audio.rate < -10 || audio.rate > 10) {
    throw new TypeError(`${label}.audioPlan.rate deve estar entre -10 e 10`);
  }
  if (!Number.isFinite(audio.gain) || audio.gain <= 0 || audio.gain > 4) {
    throw new TypeError(`${label}.audioPlan.gain deve estar em (0, 4]`);
  }
  const lineage = object(item.lineage, `${label}.lineage`);
  if (lineage.parentId !== null) {
    string(lineage.parentId, `${label}.lineage.parentId`);
  }
  string(lineage.relation, `${label}.lineage.relation`);

  for (const [path, allowed] of Object.entries(coverage.dimensions)) {
    const actual = pathValue(item, path);
    if (!allowed.includes(actual)) {
      throw new TypeError(
        `${label}.${path}=${JSON.stringify(actual)} não pertence à ontologia`
      );
    }
  }
}

export function validateFactoryPack(input) {
  const pack = object(input, "pack");
  if (pack.schemaVersion !== 2) {
    throw new TypeError(`schemaVersion do pack não suportada: ${pack.schemaVersion}`);
  }
  string(pack.id, "pack.id");
  if (pack.locale !== "pt-BR") {
    throw new TypeError("pack.locale precisa ser pt-BR nesta versão");
  }
  if (pack.frozen !== true) {
    throw new TypeError("pack precisa estar congelado (frozen=true)");
  }
  const ontology = object(pack.ontology, "pack.ontology");
  string(ontology.id, "pack.ontology.id");
  sha(ontology.sha256, "pack.ontology.sha256");
  const provenance = object(pack.provenance, "pack.provenance");
  string(provenance.method, "pack.provenance.method");
  if (
    !Array.isArray(provenance.proposalBatchIds) ||
    provenance.proposalBatchIds.length === 0
  ) {
    throw new TypeError("pack.provenance.proposalBatchIds não pode estar vazio");
  }
  provenance.proposalBatchIds.forEach((id, index) =>
    string(id, `pack.provenance.proposalBatchIds[${index}]`)
  );
  validateCoverage(pack.coverage);
  if (!Array.isArray(pack.cases) || pack.cases.length === 0) {
    throw new TypeError("pack.cases não pode estar vazio");
  }
  const ids = new Set();
  const familySplits = new Map();
  pack.cases.forEach((item, index) =>
    validateCase(item, index, familySplits, ids, pack.coverage)
  );
  return pack;
}
