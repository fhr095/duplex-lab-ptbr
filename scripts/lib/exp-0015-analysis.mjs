import {
  TIMING_CALIBRATION_ACTIONS
} from "../../src/eval/calibration/timing-stimulus.mjs";
import {
  selectFitEligibleTimingLabels,
  validateTimingCalibrationPack
} from "../../src/eval/calibration/blind-session.mjs";

export function evaluateExp0015Instrument(input) {
  const { aggregate, browser, fingerprints, pack } = input;
  const packValidation = validateTimingCalibrationPack(pack);
  const artifacts = (pack.scenes ?? []).flatMap((scene) =>
    TIMING_CALIBRATION_ACTIONS.map((action) => scene.artifacts?.[action])
  );
  const artifactPaths = new Set(artifacts.map((artifact) => artifact?.path));
  const humanAnchors = pack.scenes.filter(
    (scene) => scene.userSource?.kind ===
      "human-public-evaluation-anchor"
  );
  const syntheticSpeech = pack.scenes.filter(
    (scene) => scene.userSource?.kind === "local-synthetic-speech"
  );
  const controls = pack.scenes.filter(
    (scene) => scene.fitEligibility === "control-only"
  );
  const attentionControls = pack.scenes.filter(
    (scene) => scene.attentionControl !== null
  );
  const evidenceRequired = pack.scenes.filter(
    (scene) => scene.fitEligibility !== "control-only"
  );
  const evidenceAligned = evidenceRequired.filter(
    (scene) =>
      scene.checks?.decisionHasAcousticEvidence === true &&
      scene.decisionEvidence?.activeFrames > 0
  );
  const fitLabels = selectFitEligibleTimingLabels(aggregate);
  const gates = {
    packIntegrity:
      packValidation.valid && pack.buildGate?.pass === true,
    audioInventory:
      artifacts.length === pack.scenes.length *
        TIMING_CALIBRATION_ACTIONS.length &&
      artifactPaths.size === artifacts.length &&
      artifacts.every((artifact) =>
        artifact?.channels === 2 &&
        artifact?.sampleRate === 16_000 &&
        artifact?.preClipSamples === 0
      ) &&
      evidenceAligned.length === evidenceRequired.length,
    sourceBoundary:
      humanAnchors.length >= 7 &&
      humanAnchors.every(
        (scene) => scene.fitEligibility === "evaluation-only"
      ) &&
      syntheticSpeech.every(
        (scene) => scene.fitEligibility === "development-synthetic"
      ) &&
      controls.every((scene) => scene.fitEligibility === "control-only"),
    retentionBoundary:
      pack.retention?.audioInGit === false &&
      pack.retention?.annotationsContainRawAudio === false &&
      pack.retention?.publicHumanMixesRedistributed === false,
    browserPackBinding:
      browser?.pass === true &&
      browser?.health?.packId === pack.packId &&
      browser?.health?.packSha256 === pack.packSha256 &&
      browser?.observations?.sessionReady?.packSha256 === pack.packSha256,
    blindInterface:
      browser?.observations?.exposedTokens?.length === 0,
    playbackGate:
      browser?.observations?.lockedBeforeListening === true &&
      browser?.observations?.afterListening?.completedOptions === 3 &&
      browser?.observations?.unlockedAfterListening === true &&
      browser?.observations?.readyToAdvance?.sceneReady === true,
    realBrowserClean:
      browser?.protocol?.realWindowsChrome === true &&
      browser?.observations?.browserErrors?.length === 0,
    noSyntheticHumanRecord:
      browser?.protocol?.annotationSubmitted === false,
    aggregateBinding:
      aggregate?.schemaVersion === "timing-calibration-aggregate-v1" &&
      aggregate?.packId === pack.packId &&
      aggregate?.packSha256 === pack.packSha256,
    annotationIntegrity:
      aggregate?.gates?.recordsValid === true &&
      aggregate?.metrics?.invalidRecords === 0,
    noModelAuthority:
      aggregate?.authority === "none-shadow-only" &&
      aggregate?.readyForDirectModelFit === false &&
      fitLabels.length === 0,
    zeroPaidApi:
      pack.paidApiCalls === 0 && browser?.health?.paidApiCalls === 0
  };
  const instrumentPass = Object.values(gates).every(Boolean);
  const humanCalibrationPass = aggregate.calibrationReady === true;
  return {
    schemaVersion: "exp-0015-timing-calibration-instrument-report-v1",
    experimentId: pack.packId,
    question:
      "O instrumento local cego está íntegro e pronto para coletar uma " +
      "calibração humana pequena sem conceder autoridade ou contaminar treino?",
    instrumentPass,
    humanCalibrationPass,
    campaignComplete: instrumentPass && humanCalibrationPass,
    gates,
    decisions: {
      instrument: instrumentPass
        ? "promote-timing-calibration-instrument"
        : "hold-timing-calibration-instrument",
      humanCalibration: humanCalibrationPass
        ? "calibration-sufficient-to-freeze-m4b-experiment"
        : "await-human-calibration",
      directModelFit: aggregate.readyForDirectModelFit
        ? "eligible-labels-require-separate-m4b-gate"
        : "forbidden-from-current-pack",
      modelAuthority: "hold-deterministic-control"
    },
    metrics: {
      scenes: pack.scenes.length,
      audioArtifacts: artifacts.length,
      humanEvaluationAnchors: humanAnchors.length,
      syntheticSpeechScenes: syntheticSpeech.length,
      controls: controls.length,
      attentionControls: attentionControls.length,
      decisionEvidenceAlignedScenes: evidenceAligned.length,
      decisionEvidenceRequiredScenes: evidenceRequired.length,
      participants: aggregate.metrics.participants,
      validHumanRecords: aggregate.metrics.validRecords,
      labelledScenes: aggregate.metrics.labelledScenes,
      labelCoverage: aggregate.metrics.labelCoverage,
      fitEligibleLabels: fitLabels.length,
      paidApiCalls: pack.paidApiCalls
    },
    aggregate,
    evidence: {
      browser: {
        product: browser?.browser?.product?.product ?? null,
        realWindowsChrome: browser?.protocol?.realWindowsChrome ?? false,
        completedAudioOptions:
          browser?.observations?.afterListening?.completedOptions ?? null,
        annotationSubmitted:
          browser?.protocol?.annotationSubmitted ?? null
      },
      fingerprints: structuredClone(fingerprints)
    },
    claims: {
      promoted: instrumentPass
        ? [
            "pack local reproduzível",
            "interface cega executável no Chrome do Windows",
            "coleta pseudônima com validação fail-closed"
          ]
        : [],
      held: [
        "preferência ou naturalidade humana",
        "generalização para conversas reais",
        "uso direto dos áudios/rótulos atuais em ajuste de pesos",
        "autoridade do candidato sobre o runtime"
      ]
    },
    limitations: [...(pack.limitations ?? [])]
  };
}
