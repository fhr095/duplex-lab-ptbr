#!/usr/bin/env python3
"""Avalia o Silero VAD v6.2 de forma offline, sem alterar o runtime."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf


MODEL_URL = (
    "https://github.com/snakers4/silero-vad/raw/v6.2/"
    "src/silero_vad/data/silero_vad.onnx"
)
MODEL_SHA256 = (
    "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3"
)
MODEL_NAME = "silero_vad_v6.2.onnx"
SAMPLE_RATE = 16_000
WINDOW_SAMPLES = 512
CONTEXT_SAMPLES = 64
PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOTS = (
    "src",
    "web",
    "scripts",
    "tests",
    "eval/scenarios",
    "package.json",
    "package-lock.json",
    "requirements-asr.txt",
)
THRESHOLDS = (
    0.3,
    0.5,
    0.7,
    0.75,
    0.8,
    0.82,
    0.85,
    0.875,
    0.9,
)
CONSECUTIVE_WINDOWS = (1, 2, 3, 4)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def source_fingerprint(project_root: Path) -> dict:
    files: list[Path] = []
    for item in SOURCE_ROOTS:
        path = project_root / item
        if path.is_file():
            files.append(path)
        else:
            files.extend(
                child for child in path.rglob("*") if child.is_file()
            )
    files.sort(key=lambda path: path.relative_to(project_root).as_posix())
    digest = hashlib.sha256()
    for path in files:
        name = path.relative_to(project_root).as_posix()
        content = path.read_bytes()
        prefix = (
            f"{len(name.encode('utf-8'))}:{name}:"
            f"{len(content)}:"
        ).encode("utf-8")
        digest.update(prefix)
        digest.update(content)
    return {
        "algorithm": "sha256-source-tree-v1",
        "sha256": digest.hexdigest(),
        "fileCount": len(files),
        "roots": list(SOURCE_ROOTS),
    }


def ensure_model(cache_dir: Path) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / MODEL_NAME
    if path.exists() and sha256(path) == MODEL_SHA256:
        return path

    temporary = path.with_suffix(".download")
    try:
        urllib.request.urlretrieve(MODEL_URL, temporary)
        actual = sha256(temporary)
        if actual != MODEL_SHA256:
            raise RuntimeError(
                f"hash inesperado para Silero v6.2: {actual}"
            )
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def read_audio(path: Path) -> np.ndarray:
    samples, sample_rate = sf.read(
        path,
        dtype="float32",
        always_2d=False,
    )
    if samples.ndim == 2:
        samples = samples.mean(axis=1)
    if samples.ndim != 1:
        raise ValueError(f"{path}: formato de áudio não suportado")
    if sample_rate != SAMPLE_RATE:
        target_length = round(
            len(samples) * SAMPLE_RATE / sample_rate
        )
        source_positions = (
            np.arange(target_length, dtype=np.float64)
            * sample_rate / SAMPLE_RATE
        )
        samples = np.interp(
            source_positions,
            np.arange(len(samples), dtype=np.float64),
            samples,
        ).astype(np.float32)
    return np.ascontiguousarray(samples, dtype=np.float32)


def generated_silence(duration_ms: float) -> np.ndarray:
    return np.zeros(
        round(SAMPLE_RATE * duration_ms / 1000),
        dtype=np.float32,
    )


def nearest_rank(values: list[float], ratio: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, int(np.ceil(len(ordered) * ratio)) - 1)
    return ordered[index]


def round_metric(value: float | None, places: int = 6):
    if value is None:
        return None
    return round(float(value), places)


class SileroVad:
    def __init__(self, model_path: Path):
        options = ort.SessionOptions()
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        created_at = time.perf_counter()
        self.session = ort.InferenceSession(
            str(model_path),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        self.session_init_ms = (time.perf_counter() - created_at) * 1000
        self.reset()

    def reset(self):
        self.state = np.zeros((2, 1, 128), dtype=np.float32)
        self.context = np.zeros((1, CONTEXT_SAMPLES), dtype=np.float32)

    def probabilities(self, samples: np.ndarray):
        self.reset()
        output = []
        inference_ms = []
        for sample_start in range(0, len(samples), WINDOW_SAMPLES):
            chunk = samples[sample_start : sample_start + WINDOW_SAMPLES]
            valid_samples = len(chunk)
            if valid_samples < WINDOW_SAMPLES:
                chunk = np.pad(
                    chunk,
                    (0, WINDOW_SAMPLES - valid_samples),
                )
            model_input = np.concatenate(
                (self.context, chunk.reshape(1, -1)),
                axis=1,
            ).astype(np.float32, copy=False)
            started_at = time.perf_counter()
            probability, self.state = self.session.run(
                None,
                {
                    "input": model_input,
                    "state": self.state,
                    "sr": np.array(SAMPLE_RATE, dtype=np.int64),
                },
            )
            inference_ms.append(
                (time.perf_counter() - started_at) * 1000
            )
            self.context = model_input[:, -CONTEXT_SAMPLES:]
            output.append(
                {
                    "sampleStart": sample_start,
                    "validSamples": valid_samples,
                    "atMs": sample_start / SAMPLE_RATE * 1000,
                    "probability": float(probability[0][0]),
                }
            )
        return output, inference_ms


def first_consecutive_detection(
    frames,
    threshold: float,
    minimum_windows: int,
):
    count = 0
    possible_onset_ms = None
    for frame in frames:
        if frame["probability"] >= threshold:
            if possible_onset_ms is None:
                possible_onset_ms = frame["atMs"]
            count += 1
            if count >= minimum_windows:
                return {
                    "onsetAtMs": round_metric(possible_onset_ms, 3),
                    "emittedAtMs": round_metric(
                        frame["atMs"] +
                        frame["validSamples"] / SAMPLE_RATE * 1000,
                        3,
                    ),
                }
        else:
            count = 0
            possible_onset_ms = None
    return {
        "onsetAtMs": None,
        "emittedAtMs": None,
    }


def longest_run(frames, threshold: float) -> int:
    longest = 0
    current = 0
    for frame in frames:
        if frame["probability"] >= threshold:
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    return longest


def energy_baseline(samples: np.ndarray):
    frame_samples = 320
    noise_floor = 0.004
    noise_alpha = 0.04
    onset_count = 0
    possible_onset_ms = None
    max_rms = 0.0
    for sample_start in range(0, len(samples), frame_samples):
        frame = samples[sample_start : sample_start + frame_samples]
        if len(frame) == 0:
            continue
        rms = float(np.sqrt(np.mean(np.square(frame))))
        max_rms = max(max_rms, rms)
        threshold = max(0.025, noise_floor * 4)
        at_ms = sample_start / SAMPLE_RATE * 1000
        if rms >= threshold:
            if possible_onset_ms is None:
                possible_onset_ms = at_ms
            onset_count += 1
            if onset_count >= 4:
                return {
                    "detected": True,
                    "onsetAtMs": round_metric(
                        possible_onset_ms,
                        3,
                    ),
                    "emittedAtMs": round_metric(
                        at_ms + len(frame) / SAMPLE_RATE * 1000,
                        3,
                    ),
                    "maxRms": round_metric(max_rms),
                }
        else:
            onset_count = 0
            possible_onset_ms = None
            noise_floor = (
                noise_floor * (1 - noise_alpha) +
                rms * noise_alpha
            )
    return {
        "detected": False,
        "onsetAtMs": None,
        "emittedAtMs": None,
        "maxRms": round_metric(max_rms),
    }


def summarize_case(
    vad: SileroVad,
    case: dict,
    gain: float,
    include_frames: bool,
):
    if "generatedSilenceMs" in case:
        samples = generated_silence(case["generatedSilenceMs"])
        path = None
    else:
        path = Path(case["audio"])
        samples = read_audio(path)
    samples = np.clip(samples * gain, -1, 1).astype(
        np.float32,
        copy=False,
    )
    probabilities, inference_ms = vad.probabilities(samples)
    values = [frame["probability"] for frame in probabilities]
    threshold_summary = {}
    for threshold in THRESHOLDS:
        hits = [
            frame for frame in probabilities
            if frame["probability"] >= threshold
        ]
        threshold_summary[str(threshold)] = {
            "frames": len(hits),
            "ratio": round_metric(
                len(hits) / len(probabilities) if probabilities else 0
            ),
            "firstAtMs": (
                round_metric(hits[0]["atMs"], 3) if hits else None
            ),
            "lastAtMs": (
                round_metric(hits[-1]["atMs"], 3) if hits else None
            ),
            "longestRun": longest_run(probabilities, threshold),
            "detections": {
                str(minimum_windows): first_consecutive_detection(
                    probabilities,
                    threshold,
                    minimum_windows,
                )
                for minimum_windows in CONSECUTIVE_WINDOWS
            },
        }

    result = {
        "id": case["id"],
        "path": str(path) if path else None,
        "audioSha256": sha256(path) if path else hashlib.sha256(
            samples.tobytes()
        ).hexdigest(),
        "expectSpeech": case.get("expectSpeech"),
        "cohort": case.get("cohort"),
        "category": case.get("category"),
        "evidence": case.get("evidence"),
        "gain": gain,
        "durationMs": round_metric(
            len(samples) / SAMPLE_RATE * 1000,
            3,
        ),
        "samples": len(samples),
        "windows": len(probabilities),
        "probability": {
            "max": round_metric(max(values) if values else None),
            "mean": round_metric(
                sum(values) / len(values) if values else None
            ),
            "p95": round_metric(nearest_rank(values, 0.95)),
        },
        "thresholds": threshold_summary,
        "inferenceMs": {
            "p50": round_metric(nearest_rank(inference_ms, 0.5)),
            "p95": round_metric(nearest_rank(inference_ms, 0.95)),
            "p99": round_metric(nearest_rank(inference_ms, 0.99)),
            "max": round_metric(max(inference_ms) if inference_ms else None),
        },
        "energyBaseline": energy_baseline(samples),
    }
    if include_frames:
        result["frames"] = [
            {
                "atMs": round_metric(frame["atMs"], 3),
                "probability": round_metric(frame["probability"]),
            }
            for frame in probabilities
        ]
    return result


def detection_for_policy(item, policy_id: str) -> bool:
    if policy_id == "adaptive-energy-vad":
        return item["energyBaseline"]["detected"]
    _, threshold_text, consecutive_text = policy_id.split("-")
    detection = item["thresholds"][threshold_text]["detections"][
        consecutive_text
    ]
    return detection["emittedAtMs"] is not None


def aggregate(items):
    labelled = [
        item for item in items
        if isinstance(item.get("expectSpeech"), bool)
    ]
    policy_ids = ["adaptive-energy-vad"] + [
        f"silero-{threshold}-{minimum_windows}"
        for threshold in THRESHOLDS
        for minimum_windows in CONSECUTIVE_WINDOWS
    ]
    summaries = []
    for policy_id in policy_ids:
        speech = [
            item for item in labelled
            if item["expectSpeech"] is True
        ]
        controls = [
            item for item in labelled
            if item["expectSpeech"] is False
        ]
        speech_by_gain = {}
        for gain in sorted({item["gain"] for item in speech}):
            at_gain = [item for item in speech if item["gain"] == gain]
            detected = sum(
                detection_for_policy(item, policy_id)
                for item in at_gain
            )
            speech_by_gain[str(gain)] = {
                "observations": len(at_gain),
                "detected": detected,
                "recall": round_metric(
                    detected / len(at_gain) if at_gain else None
                ),
            }
        false_positives = sum(
            detection_for_policy(item, policy_id)
            for item in controls
        )
        summaries.append(
            {
                "policy": policy_id,
                "speechByGain": speech_by_gain,
                "controlObservations": len(controls),
                "falsePositives": false_positives,
                "controlSpecificity": round_metric(
                    1 - false_positives / len(controls)
                    if controls else None
                ),
            }
        )
    summaries.sort(
        key=lambda item: (
            item["falsePositives"],
            -min(
                (
                    gain["recall"]
                    for gain in item["speechByGain"].values()
                    if gain["recall"] is not None
                ),
                default=0,
            ),
            item["policy"],
        )
    )
    return {
        "labelledObservations": len(labelled),
        "policies": summaries,
        "rankingRule": (
            "minimiza falsos positivos; depois maximiza o pior recall "
            "entre ganhos; não constitui promoção"
        ),
    }


def parse_arguments():
    parser = argparse.ArgumentParser(
        description=(
            "Executa Silero VAD v6.2 ONNX em WAVs mono/estéreo de 16 kHz."
        )
    )
    parser.add_argument("audio", nargs="*", type=Path)
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path("eval/generated/vad/models"),
    )
    parser.add_argument("--out", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument(
        "--gain",
        action="append",
        type=float,
        dest="gains",
    )
    parser.add_argument(
        "--include-frames",
        action="store_true",
    )
    return parser.parse_args()


def main():
    arguments = parse_arguments()
    if not arguments.audio and not arguments.manifest:
        raise SystemExit("informe WAVs ou --manifest")
    if arguments.gains and any(
        gain <= 0 or gain > 1 for gain in arguments.gains
    ):
        raise SystemExit("--gain precisa estar no intervalo (0, 1]")

    cases = [
        {
            "id": path.stem,
            "audio": str(path),
        }
        for path in arguments.audio
    ]
    manifest = None
    if arguments.manifest:
        manifest = json.loads(
            arguments.manifest.read_text(encoding="utf-8")
        )
        cases.extend(manifest["cases"])

    model_path = ensure_model(arguments.cache_dir)
    vad = SileroVad(model_path)
    results = []
    for case in cases:
        gains = arguments.gains or case.get("gains") or [1.0]
        results.extend(
            summarize_case(
                vad,
                case,
                gain,
                arguments.include_frames,
            )
            for gain in gains
        )
    report = {
        "schemaVersion": 1,
        "generatedAt": time.strftime(
            "%Y-%m-%dT%H:%M:%SZ",
            time.gmtime(),
        ),
        "sourceFingerprint": source_fingerprint(PROJECT_ROOT),
        "candidate": "silero-vad-v6.2-onnx",
        "controlPathChanged": False,
        "manifest": (
            str(arguments.manifest) if arguments.manifest else None
        ),
        "experimentId": manifest.get("id") if manifest else None,
        "model": {
            "url": MODEL_URL,
            "sha256": MODEL_SHA256,
            "path": str(model_path),
            "bytes": model_path.stat().st_size,
            "sessionInitMs": round_metric(vad.session_init_ms),
        },
        "audio": results,
        "aggregate": aggregate(results),
    }
    serialized = json.dumps(
        report,
        ensure_ascii=False,
        indent=2,
    ) + "\n"
    if arguments.out:
        arguments.out.parent.mkdir(parents=True, exist_ok=True)
        arguments.out.write_text(serialized, encoding="utf-8")
    sys.stdout.write(serialized)


if __name__ == "__main__":
    main()
