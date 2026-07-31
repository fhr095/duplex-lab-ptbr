const DEFAULTS = Object.freeze({
  initialNoiseFloor: 0.004,
  minimumOffThreshold: 0.008,
  minimumOnThreshold: 0.014,
  noiseAlpha: 0.04,
  offMultiplier: 2,
  onMultiplier: 3.5,
  onsetFrames: 3,
  pauseFrames: 10,
  resumeFrames: 2
});

export class AdaptiveEnergyVad {
  constructor(options = {}) {
    this.config = { ...DEFAULTS, ...options };
    this.reset();
  }

  reset() {
    this.noiseFloor = this.config.initialNoiseFloor;
    this.state = "idle";
    this.onsetCount = 0;
    this.quietCount = 0;
    this.resumeCount = 0;
    this.possibleOnsetAtMs = null;
    this.possibleOnsetSequence = null;
    this.possibleOnsetSampleStart = null;
    this.possiblePauseAtMs = null;
    this.possiblePauseSampleStart = null;
  }

  thresholds() {
    return {
      on: Math.max(
        this.config.minimumOnThreshold,
        this.noiseFloor * this.config.onMultiplier
      ),
      off: Math.max(
        this.config.minimumOffThreshold,
        this.noiseFloor * this.config.offMultiplier
      )
    };
  }

  updateNoise(rms) {
    const alpha = this.config.noiseAlpha;
    this.noiseFloor = this.noiseFloor * (1 - alpha) + rms * alpha;
  }

  push(frame) {
    const atMs = Number(frame.atMs);
    const rms = Math.max(0, Number(frame.rms) || 0);
    const durationMs = Math.max(1, Number(frame.durationMs) || 20);
    if (!Number.isFinite(atMs) || atMs < 0) {
      throw new TypeError("frame.atMs deve ser monotônico e não negativo");
    }

    const events = [];
    const thresholds = this.thresholds();

    if (this.state === "idle") {
      if (rms >= thresholds.on) {
        this.possibleOnsetAtMs ??= atMs;
        this.possibleOnsetSequence ??= frame.sequence ?? null;
        this.possibleOnsetSampleStart ??= frame.sampleStart ?? null;
        this.onsetCount += 1;
        if (this.onsetCount >= this.config.onsetFrames) {
          this.state = "speaking";
          events.push({
            type: "user.speech.started",
            atMs: this.possibleOnsetAtMs,
            payload: {
              detector: "adaptive-energy-vad",
              rms,
              threshold: thresholds.on,
              onsetSequence: this.possibleOnsetSequence,
              onsetSampleStart: this.possibleOnsetSampleStart,
              triggerSequence: frame.sequence ?? null,
              triggerSampleStart: frame.sampleStart ?? null
            }
          });
          this.onsetCount = 0;
          this.possibleOnsetAtMs = null;
          this.possibleOnsetSequence = null;
          this.possibleOnsetSampleStart = null;
        }
      } else {
        this.onsetCount = 0;
        this.possibleOnsetAtMs = null;
        this.possibleOnsetSequence = null;
        this.possibleOnsetSampleStart = null;
        this.updateNoise(rms);
      }
      return events;
    }

    if (this.state === "speaking") {
      if (rms < thresholds.off) {
        this.possiblePauseAtMs ??= atMs;
        this.possiblePauseSampleStart ??= frame.sampleStart ?? null;
        this.quietCount += 1;
        if (this.quietCount >= this.config.pauseFrames) {
          this.state = "paused";
          events.push({
            type: "user.speech.paused",
            atMs: this.possiblePauseAtMs,
            payload: {
              detector: "adaptive-energy-vad",
              silenceMs: this.quietCount * durationMs,
              pauseSampleStart: this.possiblePauseSampleStart
            }
          });
          this.quietCount = 0;
        }
      } else {
        this.quietCount = 0;
        this.possiblePauseAtMs = null;
        this.possiblePauseSampleStart = null;
      }
      return events;
    }

    if (rms >= thresholds.on) {
      this.resumeCount += 1;
      if (this.resumeCount >= this.config.resumeFrames) {
        this.state = "speaking";
        this.resumeCount = 0;
        this.possiblePauseAtMs = null;
        this.possiblePauseSampleStart = null;
        events.push({
          type: "user.speech.resumed",
          atMs: atMs - durationMs * (this.config.resumeFrames - 1),
          payload: {
            detector: "adaptive-energy-vad",
            rms,
            threshold: thresholds.on,
            triggerSequence: frame.sequence ?? null,
            triggerSampleStart: frame.sampleStart ?? null
          }
        });
      }
    } else {
      this.resumeCount = 0;
      this.updateNoise(rms);
    }

    return events;
  }
}

export const ENERGY_VAD_DEFAULTS = DEFAULTS;
