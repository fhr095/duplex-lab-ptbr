#!/usr/bin/env python3
"""Materialize the frozen EXP-0019 audio sources with local Supertonic.

The process never downloads artifacts. Assistant prefix and tail are synthesized
as independent waveforms, converted independently to PCM16/16 kHz and only then
concatenated, making prefix_end_sample an exact sample boundary.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import sys
import wave
from pathlib import Path
from typing import Any

# Belt and suspenders around TTS(auto_download=False). The JavaScript launcher
# sets the same variables and invokes its cached environment with --offline.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["UV_OFFLINE"] = "1"

import numpy as np


OUTPUT_SAMPLE_RATE = 16_000
LANGUAGE = "pt"
TOTAL_STEPS = 8
SPEED = 1.05
RANDOM_SEED_BASE = 190019
RANDOM_SEED_STRATEGY = "sha256-stream-segment-numpy-v1"
PYTHON_PACKAGES = {
    "PyYAML": "6.0.3",
    "anyio": "4.14.2",
    "certifi": "2026.7.22",
    "cffi": "2.1.0",
    "click": "8.4.2",
    "filelock": "3.32.2",
    "flatbuffers": "25.12.19",
    "fsspec": "2026.7.0",
    "h11": "0.16.0",
    "hf-xet": "1.5.2",
    "httpcore": "1.0.9",
    "httpx": "0.28.1",
    "huggingface_hub": "1.26.0",
    "idna": "3.18",
    "numpy": "2.5.1",
    "onnxruntime": "1.28.0",
    "packaging": "26.2",
    "protobuf": "7.35.1",
    "pycparser": "3.0",
    "soundfile": "0.14.0",
    "supertonic": "1.3.1",
    "tqdm": "4.70.0",
    "typing_extensions": "4.16.0",
}
VALID_STREAM_KINDS = {"target", "inbound", "assistant"}


def fail(message: str) -> None:
    raise ValueError(f"plano de áudio EXP-0019 incompatível: {message}")


def load_plan(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        fail("raiz precisa ser objeto JSON")
    audio = value.get("audio")
    if not isinstance(audio, dict):
        fail("audio precisa ser objeto")
    synthesis = audio.get("synthesis")
    if not isinstance(synthesis, dict):
        fail("audio.synthesis precisa ser objeto")
    voice_styles = synthesis.get("voiceStyles")
    if not isinstance(voice_styles, dict):
        fail("audio.synthesis.voiceStyles precisa ser objeto")
    for key in ("assistant", "nonAssistant"):
        if not isinstance(voice_styles.get(key), str) or not voice_styles[key].strip():
            fail(f"audio.synthesis.voiceStyles.{key} precisa ser texto não vazio")
    if voice_styles["assistant"] == voice_styles["nonAssistant"]:
        fail("vozes assistant e nonAssistant precisam ser distintas")
    if (
        synthesis.get("randomSeedBase") != RANDOM_SEED_BASE
        or synthesis.get("randomSeedStrategy") != RANDOM_SEED_STRATEGY
    ):
        fail("audio.synthesis não fixa a estratégia de seed")
    streams = audio.get("streams")
    if not isinstance(streams, list) or len(streams) != 12:
        fail("audio.streams precisa conter exatamente 12 itens")
    seen_ids: set[str] = set()
    seen_paths: set[str] = set()
    kind_counts = {kind: 0 for kind in VALID_STREAM_KINDS}
    for index, stream in enumerate(streams):
        label = f"audio.streams[{index}]"
        if not isinstance(stream, dict):
            fail(f"{label} precisa ser objeto")
        for key in ("streamId", "kind", "speakerSlot", "relativePath"):
            if not isinstance(stream.get(key), str) or not stream[key].strip():
                fail(f"{label}.{key} precisa ser texto não vazio")
        kind = stream["kind"]
        if kind not in VALID_STREAM_KINDS:
            fail(f"{label}.kind é desconhecido")
        if stream["streamId"] in seen_ids or stream["relativePath"] in seen_paths:
            fail("streamId e relativePath precisam ser únicos")
        seen_ids.add(stream["streamId"])
        seen_paths.add(stream["relativePath"])
        kind_counts[kind] += 1
        assistant = kind == "assistant"
        expected_slot = "assistant" if assistant else "non-assistant"
        if stream["speakerSlot"] != expected_slot:
            fail(f"{label}.speakerSlot não corresponde a kind={kind}")
        if assistant:
            if stream.get("text") is not None:
                fail(f"{label}.text precisa ser null/ausente no assistant")
            segments = stream.get("segments")
            if not isinstance(segments, list) or len(segments) != 2:
                fail(f"{label}.segments precisa ter audible-prefix e neutral-tail")
            for segment_index, expected_kind in enumerate(
                ("audible-prefix", "neutral-tail")
            ):
                segment = segments[segment_index]
                if not isinstance(segment, dict):
                    fail(f"{label}.segments[{segment_index}] precisa ser objeto")
                if segment.get("kind") != expected_kind:
                    fail(
                        f"{label}.segments[{segment_index}].kind precisa ser "
                        f"{expected_kind}"
                    )
                if not isinstance(segment.get("text"), str) or not segment["text"].strip():
                    fail(f"{label}.segments[{segment_index}].text precisa ser texto não vazio")
        else:
            if not isinstance(stream.get("text"), str) or not stream["text"].strip():
                fail(f"{label}.text precisa ser texto não vazio")
            if stream.get("segments") is not None:
                fail(f"{label}.segments só é permitido no assistant")
    if any(count != 4 for count in kind_counts.values()):
        fail("audio.streams precisa ter 4 targets, 4 inbounds e 4 assistants")
    return value


def audio_sources(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """Derive runner inputs from the canonical plan without mutating it."""
    voice_styles = plan["audio"]["synthesis"]["voiceStyles"]
    sources: list[dict[str, Any]] = []
    for stream in plan["audio"]["streams"]:
        assistant = stream["kind"] == "assistant"
        sources.append(
            {
                "id": stream["streamId"],
                "role": "assistant-output" if assistant else stream["kind"],
                "voiceStyle": (
                    voice_styles["assistant"]
                    if assistant
                    else voice_styles["nonAssistant"]
                ),
                "text": (
                    stream["segments"][0]["text"]
                    if assistant
                    else stream["text"]
                ),
                "tailText": (
                    stream["segments"][1]["text"] if assistant else None
                ),
                "relativePath": stream["relativePath"],
            }
        )
    return sources


def contained_destination(
    project_root: Path,
    output_root: Path,
    relative_path: str,
) -> Path:
    candidate = (project_root / relative_path).resolve()
    try:
        candidate.relative_to(output_root)
    except ValueError:
        fail(f"relativePath sai do output root local: {relative_path}")
    if candidate.suffix.lower() != ".wav":
        fail(f"relativePath precisa terminar em .wav: {relative_path}")
    return candidate


def resample_pcm16(waveform: np.ndarray, source_rate: int) -> np.ndarray:
    mono = np.asarray(waveform, dtype=np.float32).reshape(-1)
    if mono.size == 0:
        raise ValueError("Supertonic devolveu waveform vazio")
    if source_rate != OUTPUT_SAMPLE_RATE:
        output_length = max(
            1,
            round(mono.size * OUTPUT_SAMPLE_RATE / source_rate),
        )
        positions = np.arange(output_length, dtype=np.float64) * (
            source_rate / OUTPUT_SAMPLE_RATE
        )
        mono = np.interp(
            positions,
            np.arange(mono.size, dtype=np.float64),
            mono,
        ).astype(np.float32)
    clipped = np.clip(mono, -1.0, 1.0)
    scaled = np.where(
        clipped < 0,
        np.rint(clipped * 32_768),
        np.rint(clipped * 32_767),
    )
    return scaled.astype("<i2")


def write_pcm16_wave(path: Path, pcm: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "wb") as raw_output:
        with wave.open(raw_output, "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(OUTPUT_SAMPLE_RATE)
            output.writeframes(pcm.tobytes(order="C"))


def sha256_bytes(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return sha256_bytes(encoded)


def package_tree_sha256(root: Path) -> str:
    digest = hashlib.sha256()
    files = sorted(
        path for path in root.rglob("*")
        if path.is_file() and path.suffix in {".py", ".json"}
    )
    for path in files:
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(8, "big"))
        digest.update(relative)
        content = path.read_bytes()
        digest.update(len(content).to_bytes(8, "big"))
        digest.update(content)
    return f"sha256:{digest.hexdigest()}"


def segment_seed(stream_id: str, segment_kind: str) -> int:
    material = (
        f"EXP-0019|{RANDOM_SEED_BASE}|{stream_id}|{segment_kind}"
    ).encode("utf-8")
    return int.from_bytes(hashlib.sha256(material).digest()[:4], "big")


def synthesize_segment(
    tts: Any,
    style: Any,
    text: str,
    seed: int,
) -> np.ndarray:
    np.random.seed(seed)
    waveform, _ = tts.synthesize(
        text,
        voice_style=style,
        total_steps=TOTAL_STEPS,
        speed=SPEED,
        lang=LANGUAGE,
        verbose=False,
    )
    return resample_pcm16(waveform, tts.sample_rate)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--freeze", required=True, type=Path)
    parser.add_argument("--freeze-file-sha256", required=True)
    parser.add_argument("--attempt", required=True, type=Path)
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--receipt", required=True, type=Path)
    args = parser.parse_args()

    project_root = args.project_root.resolve()
    output_root = args.output_root.resolve()
    try:
        output_root.relative_to(project_root)
    except ValueError:
        fail("output root precisa permanecer dentro do projeto")

    plan_bytes = args.plan.read_bytes()
    plan = load_plan(args.plan)
    freeze_bytes = args.freeze.read_bytes()
    if sha256_bytes(freeze_bytes) != args.freeze_file_sha256:
        fail("bytes do freeze divergem do binding recebido")
    freeze = json.loads(freeze_bytes.decode("utf-8"))
    attempt_bytes = args.attempt.read_bytes()
    attempt = json.loads(attempt_bytes.decode("utf-8"))
    attempt_core = dict(attempt)
    observed_attempt_sha256 = attempt_core.pop("attemptSha256", None)
    freeze_core = dict(freeze)
    observed_freeze_sha256 = freeze_core.pop(
        "instrumentationFreezeSha256", None
    )
    plan_core = dict(plan)
    observed_plan_sha256 = plan_core.pop("planSha256", None)
    expected_tts_config = {
        "engine": "supertonic",
        "model": "supertonic-3",
        "sdkVersion": "1.3.1",
        "language": LANGUAGE,
        "totalSteps": TOTAL_STEPS,
        "speed": SPEED,
        "outputSampleRate": OUTPUT_SAMPLE_RATE,
        "assistantSegmentsSynthesizedSeparately": True,
        "randomness": {
            "baseSeed": RANDOM_SEED_BASE,
            "strategy": RANDOM_SEED_STRATEGY,
            "numpySeededBeforeEachSynthesis": True,
        },
        "pythonPackages": PYTHON_PACKAGES,
        "voiceStyles": plan["audio"]["synthesis"]["voiceStyles"],
        "execution": {
            "networkAllowed": False,
            "autoDownload": False,
            "paidApiCalls": 0,
            "gpuRuns": 0,
        },
    }
    frozen_model_binding = freeze.get("tts", {}).get(
        "modelArtifactBinding", {}
    )
    frozen_model_files = frozen_model_binding.get("files", {})
    if (
        freeze.get("schemaVersion") != "exp-0019-instrumentation-freeze-v1"
        or freeze.get("status") != "frozen-before-audio-materialization"
        or observed_freeze_sha256 != canonical_sha256(freeze_core)
        or observed_plan_sha256 != canonical_sha256(plan_core)
        or freeze.get("artifacts", {}).get("plan", {}).get("fileSha256")
        != sha256_bytes(plan_bytes)
        or freeze.get("artifacts", {}).get("plan", {}).get("canonicalSha256")
        != observed_plan_sha256
        or freeze.get("tts", {}).get("config") != expected_tts_config
        or freeze.get("tts", {}).get("configCanonicalSha256")
        != canonical_sha256(expected_tts_config)
        or frozen_model_binding.get("canonicalSha256")
        != canonical_sha256(frozen_model_files)
        or attempt.get("schemaVersion")
        != "exp-0019-audio-materialization-attempt-v1"
        or attempt.get("status") != "OPENED_FOR_SINGLE_MATERIALIZATION"
        or attempt.get("instrumentationFreeze", {}).get("fileSha256")
        != args.freeze_file_sha256
        or attempt.get("instrumentationFreeze", {}).get("canonicalSha256")
        != observed_freeze_sha256
        or attempt.get("plan", {}).get("fileSha256")
        != sha256_bytes(plan_bytes)
        or attempt.get("plan", {}).get("canonicalSha256")
        != observed_plan_sha256
        or attempt.get("modelArtifactBindingSha256")
        != frozen_model_binding.get("canonicalSha256")
        or attempt.get("allowedSyntheses", {}).get("rerunAllowed") is not False
        or attempt.get("allowedSyntheses", {}).get("streams") != 12
        or attempt.get("authority")
        != {"mode": "offline-shadow-only", "canProduceEffects": False}
        or observed_attempt_sha256 != canonical_sha256(attempt_core)
    ):
        fail("freeze ou tentativa exclusiva não vinculam este plano")
    if not args.model_dir.is_dir():
        raise FileNotFoundError(
            f"cache Supertonic local ausente: {args.model_dir}"
        )
    observed_model_files = {
        relative_path: sha256_bytes(
            (args.model_dir / relative_path).read_bytes()
        )
        for relative_path in sorted(frozen_model_files)
    }
    if observed_model_files != frozen_model_files:
        fail("pesos/vozes locais divergem do binding congelado")
    observed_package_versions = {
        name: importlib.metadata.version(name)
        for name in PYTHON_PACKAGES
    }
    if observed_package_versions != PYTHON_PACKAGES:
        fail("versões Python divergem do ambiente congelado")

    import supertonic
    from supertonic import TTS

    tts = TTS(
        model="supertonic-3",
        model_dir=args.model_dir,
        auto_download=False,
    )
    styles: dict[str, Any] = {}
    files: list[dict[str, Any]] = []
    for source in audio_sources(plan):
        voice_name = source["voiceStyle"]
        if voice_name not in styles:
            styles[voice_name] = tts.get_voice_style(voice_name=voice_name)
        prefix_kind = (
            "audible-prefix"
            if source["role"] == "assistant-output"
            else "utterance"
        )
        prefix_seed = segment_seed(source["id"], prefix_kind)
        prefix = synthesize_segment(
            tts,
            styles[voice_name],
            source["text"],
            prefix_seed,
        )
        segment_seeds = [prefix_seed]
        if source["role"] == "assistant-output":
            tail_seed = segment_seed(source["id"], "neutral-tail")
            tail = synthesize_segment(
                tts,
                styles[voice_name],
                source["tailText"],
                tail_seed,
            )
            segment_seeds.append(tail_seed)
            pcm = np.concatenate((prefix, tail))
            segment_counts = [int(prefix.size), int(tail.size)]
            prefix_end_sample: int | None = int(prefix.size)
        else:
            pcm = prefix
            segment_counts = [int(prefix.size)]
            prefix_end_sample = None
        destination = contained_destination(
            project_root,
            output_root,
            source["relativePath"],
        )
        write_pcm16_wave(destination, pcm)
        files.append(
            {
                "id": source["id"],
                "relativePath": source["relativePath"],
                "sampleCount": int(pcm.size),
                "segmentSampleCounts": segment_counts,
                "segmentSeeds": segment_seeds,
                "prefixEndSample": prefix_end_sample,
            }
        )

    receipt = {
        "schemaVersion": "exp-0019-supertonic-materialization-receipt-v1",
        "engine": "supertonic",
        "model": "supertonic-3",
        "sdkVersion": supertonic.__version__,
        "pythonVersion": sys.version.split()[0],
        "pythonExecutableSha256": sha256_bytes(Path(sys.executable).read_bytes()),
        "packageVersions": {
            name: importlib.metadata.version(name)
            for name in PYTHON_PACKAGES
        },
        "supertonicPackageSha256": package_tree_sha256(
            Path(supertonic.__file__).resolve().parent
        ),
        "language": LANGUAGE,
        "totalSteps": TOTAL_STEPS,
        "speed": SPEED,
        "randomSeedBase": RANDOM_SEED_BASE,
        "randomSeedStrategy": RANDOM_SEED_STRATEGY,
        "assistantSegmentsSynthesizedSeparately": True,
        "modelSampleRate": int(tts.sample_rate),
        "outputSampleRate": OUTPUT_SAMPLE_RATE,
        "networkAllowed": False,
        "autoDownload": False,
        "environmentMode": "uvx-offline-existing-cache",
        "instrumentationFreezeFileSha256": args.freeze_file_sha256,
        "attemptFileSha256": sha256_bytes(attempt_bytes),
        "files": files,
    }
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    with args.receipt.open("x", encoding="utf-8") as receipt_output:
        receipt_output.write(
            json.dumps(receipt, ensure_ascii=False, indent=2, sort_keys=True)
            + "\n"
        )
    print(f"Supertonic materializou {len(files)} streams EXP-0019 locais")


if __name__ == "__main__":
    main()
