import { canonicalSha256 } from "./canonical-hash.mjs";
import {
  validateFactoryPack,
  validateGenerationProposal
} from "./schema.mjs";

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} deve ser uma string não vazia`);
  }
}

function validateInputs(ontology, blueprintSet) {
  if (ontology?.schemaVersion !== 1 || ontology.locale !== "pt-BR") {
    throw new TypeError("ontologia v1 pt-BR é obrigatória");
  }
  nonEmptyString(ontology.id, "ontology.id");
  if (!ontology.coverage || typeof ontology.coverage !== "object") {
    throw new TypeError("ontology.coverage é obrigatório");
  }
  if (
    blueprintSet?.schemaVersion !== 1 ||
    blueprintSet.ontologyId !== ontology.id ||
    !Array.isArray(blueprintSet.blueprints) ||
    blueprintSet.blueprints.length === 0
  ) {
    throw new TypeError("blueprint set não corresponde à ontologia");
  }
}

function surfaceSuffix(index) {
  if (index >= 26) {
    return String(index + 1);
  }
  return String.fromCharCode("a".charCodeAt(0) + index);
}

export function generationInputHash(ontology, blueprintSet) {
  return canonicalSha256({ ontology, blueprintSet });
}

export function assembleFactoryPack({
  ontology,
  blueprintSet,
  proposalBatches
}) {
  validateInputs(ontology, blueprintSet);
  if (!Array.isArray(proposalBatches) || proposalBatches.length === 0) {
    throw new TypeError("ao menos um batch de propostas é obrigatório");
  }
  const inputSha256 = generationInputHash(ontology, blueprintSet);
  const proposalsByBlueprint = new Map();
  const providers = [];

  for (const rawBatch of proposalBatches) {
    const batch = validateGenerationProposal(rawBatch);
    if (batch.provider.inputSha256 !== inputSha256) {
      throw new TypeError(
        `batch ${batch.batchId} foi gerado para outro inputSha256`
      );
    }
    if (batch.provider.outputSha256 !== canonicalSha256(batch.proposals)) {
      throw new TypeError(
        `batch ${batch.batchId} possui outputSha256 divergente`
      );
    }
    providers.push({ batchId: batch.batchId, ...batch.provider });
    for (const proposal of batch.proposals) {
      const bucket = proposalsByBlueprint.get(proposal.blueprintId) ?? [];
      bucket.push({ ...proposal, batchId: batch.batchId });
      proposalsByBlueprint.set(proposal.blueprintId, bucket);
    }
  }

  const blueprintIds = new Set(
    blueprintSet.blueprints.map((blueprint) => blueprint.id)
  );
  for (const blueprintId of proposalsByBlueprint.keys()) {
    if (!blueprintIds.has(blueprintId)) {
      throw new TypeError(`proposta referencia blueprint desconhecido: ${blueprintId}`);
    }
  }

  const cases = [];
  for (const blueprint of blueprintSet.blueprints) {
    nonEmptyString(blueprint.id, "blueprint.id");
    const proposals = proposalsByBlueprint.get(blueprint.id) ?? [];
    if (proposals.length < (blueprint.minSurfaces ?? 2)) {
      throw new TypeError(
        `blueprint ${blueprint.id} tem apenas ${proposals.length} superfícies`
      );
    }
    const rootId = `${blueprint.id}-surface-a`;
    proposals.forEach((proposal, index) => {
      const id = `${blueprint.id}-surface-${surfaceSuffix(index)}`;
      const canonicalSlots = blueprint.canonicalSlots ?? blueprint.slots;
      cases.push({
        id,
        familyRootId: blueprint.id,
        split: blueprint.split,
        seed: blueprint.seed + index,
        phenomenon: "correction",
        critical: blueprint.critical === true,
        stimulus: {
          text: proposal.text,
          slotType: blueprint.slotType,
          marker: blueprint.marker,
          timingPattern: blueprint.timingPattern,
          effectRisk: blueprint.effectRisk,
          slots: blueprint.slots,
          canonicalSlots,
          styleTags: proposal.styleTags
        },
        oracle: {
          ref: "correction-last-value-wins@1",
          args: {
            slot: blueprint.slotType,
            obsolete: canonicalSlots.obsolete,
            current: canonicalSlots.current,
            allowProvisionalEffect: false
          }
        },
        audioPlan: blueprint.audioPlan,
        lineage: {
          parentId: index === 0 ? null : rootId,
          relation: index === 0 ? "root" : "ai-surface-variation",
          proposalBatchId: proposal.batchId
        }
      });
    });
  }

  return validateFactoryPack({
    schemaVersion: 2,
    id: blueprintSet.outputPackId,
    locale: ontology.locale,
    frozen: true,
    ontology: {
      id: ontology.id,
      sha256: canonicalSha256(ontology)
    },
    provenance: {
      method: "ai-assisted-surfaces-over-trusted-blueprints",
      proposalBatchIds: proposalBatches.map((batch) => batch.batchId),
      providers
    },
    coverage: ontology.coverage,
    cases
  });
}

