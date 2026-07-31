function requireCheck(checks, name, value) {
  checks[name] = value === true;
}

export function buildRuntimeBaseline(input) {
  const { health, currentFingerprint, evidence } = input;
  const checks = {};
  requireCheck(checks, "runtimeHealthy", health.status === "ok");
  requireCheck(
    checks,
    "runtimeFingerprintCurrent",
    health.process?.runtimeFingerprint?.sha256 ===
      currentFingerprint.sha256
  );
  requireCheck(checks, "localBrainDefault", health.brain === "local");
  requireCheck(
    checks,
    "sileroControlReady",
    health.vadControl?.state === "ready" &&
      health.vadControl?.engine === "silero-vad" &&
      health.vadControl?.threshold === 0.85 &&
      health.vadControl?.onsetWindows === 1
  );
  requireCheck(
    checks,
    "asrCascadeReady",
    health.asr?.state === "ready" &&
      health.asr?.partialModel === "tiny" &&
      health.asr?.engine === "parakeet" &&
      health.asr?.finalModel === "nemo-parakeet-tdt-0.6b-v3"
  );
  requireCheck(
    checks,
    "safePrefinalDefault",
    health.interaction?.prefinalPolicy === "linguistic-complete"
  );
  requireCheck(
    checks,
    "factoryToolchainPromoted",
    evidence.factory.value.decisions?.factoryToolchain === "promote"
  );
  requireCheck(
    checks,
    "acousticPrefinalRejected",
    evidence.exp0007.value.screening?.decision === "reject-safety"
  );
  requireCheck(
    checks,
    "shadowVerifierHeld",
    evidence.exp0008.value.decision === "hold-latency" &&
      evidence.exp0008.value.authorizedAuthority === "none"
  );
  requireCheck(
    checks,
    "criticalAmountGuardPromoted",
    evidence.exp0009.value.decision === "promote-safety-guard" &&
      evidence.exp0009.value.pass === true
  );
  requireCheck(
    checks,
    "zeroPaidCallsInFreezeEvidence",
    evidence.exp0007.value.control?.zeroPaidApiCalls === true &&
      evidence.exp0007.value.challenger?.zeroPaidApiCalls === true &&
      evidence.exp0008.value.execution?.paidApiCalls === 0 &&
      evidence.exp0009.value.gates?.zeroPaidApiCalls === true
  );
  if (!Object.values(checks).every(Boolean)) {
    const failed = Object.entries(checks)
      .filter(([, pass]) => !pass)
      .map(([name]) => name);
    throw new Error(`baseline não pode ser congelada: ${failed.join(", ")}`);
  }
  return {
    schemaVersion: 1,
    id: "runtime-baseline-ptbr-v0.3",
    frozenAt: new Date().toISOString(),
    status: "frozen-development-comparator",
    scope: {
      promoted: [
        "vertical local de engenharia",
        "fábrica de avaliação como instrumento",
        "guardrail monetário de abstention"
      ],
      held: [
        "prontidão humana e de produto",
        "efeitos externos reais",
        "verificador Whisper no caminho bloqueante",
        "prefinal acústica eager"
      ]
    },
    runtimeFingerprint: currentFingerprint,
    configuration: {
      brain: {
        provider: health.brain,
        interactionModel: health.models?.interaction,
        taskModel: health.models?.task
      },
      vad: {
        control: "silero-vad-v6.2",
        modelSha256: health.vadControl?.sha256,
        threshold: health.vadControl?.threshold,
        onsetWindows: health.vadControl?.onsetWindows,
        offThreshold: health.vadControl?.offThreshold,
        offsetWindows: health.vadControl?.offsetWindows
      },
      asr: {
        partialEngine: "whisper",
        partialModel: health.asr?.partialModel,
        partialThreads: health.asr?.partialThreads,
        finalEngine: health.asr?.engine,
        finalModel: health.asr?.finalModel,
        finalThreads: health.asr?.finalThreads,
        device: health.asr?.device,
        computeType: health.asr?.computeType
      },
      interaction: health.interaction,
      safety: {
        criticalAmountCorrection:
          "repeat-critical-value-before-commit",
        externalProviderBypass: true,
        semanticCommitBeforeConfirmation: false
      },
      tts: {
        engine: health.tts?.engine,
        voice: health.tts?.voice,
        culture: health.tts?.culture
      }
    },
    freezeChecks: checks,
    evidence: Object.fromEntries(
      Object.entries(evidence).map(([name, item]) => [name, {
        path: item.path,
        sha256: item.sha256,
        decision:
          item.value.decision ??
          item.value.screening?.decision ??
          item.value.decisions ?? null
      }])
    ),
    knownLimitations: [
      "Uma única voz sintética e cinco conteúdos principais dominam os EXP-0007–0009.",
      "O ASR final ainda confunde R$ 1.150 com R$ 150 e domingo com mundo em fixtures conhecidas.",
      "A pergunta de segurança não implementa ainda o ledger do turno de confirmação seguinte.",
      "A métrica do renderer não mede a cauda física de alto-falante e sala.",
      "Não há alegação de naturalidade, preferência humana ou generalização acústica."
    ],
    nextMilestone: "M2.5 InteractionKernel/Runtime/LocalAudioReflex"
  };
}
