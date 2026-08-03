#!/usr/bin/env python3
"""Produce raw local word timestamps for the EXP-0017-R oracle.

The request deliberately contains only train/development audio identities.  This
worker does not receive reference transcripts, labels, checkpoints, or metrics.
Its verbose output is an intermediate artifact kept under ``eval/generated``.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
from typing import Any
import wave


REQUEST_SCHEMA = "exp-0017-r-oracle-alignment-request-v2"
RAW_SCHEMA = "exp-0017-r-oracle-raw-alignment-v2"
ALLOWED_SPLITS = {"train", "development"}
MODEL_REVISION = "536b0662742c02347bc0e980a01041f333bce120"
INPUT_POLICY = "physically-truncated-wav-only"
ELIGIBLE_THROUGH_SAMPLE = 7_680
DECISION_SAMPLE = 8_960
SNAPSHOT_FILES = (
    (
        "config.json",
        "sha256:b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828",
        2_370,
    ),
    (
        "model.bin",
        "sha256:3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671",
        483_546_902,
    ),
    (
        "tokenizer.json",
        "sha256:fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab",
        2_203_239,
    ),
    (
        "vocabulary.txt",
        "sha256:34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913",
        459_861,
    ),
)
SOURCE_KEYS = {
    "sceneId",
    "partition",
    "truncatedRelativePath",
    "sourceWaveSha256",
    "sourcePcmSha256",
    "truncatedWaveSha256",
    "truncatedPcmSha256",
    "sourceOnsetSample",
    "acceptedThroughSample",
    "inputStartSample",
    "inputEndSampleExclusive",
    "futureSamplesUsed",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--threads", type=int, default=4)
    return parser.parse_args()


def sha256_bytes(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def repository_path(project_root: Path, relative_path: str) -> Path:
    candidate = Path(relative_path)
    if candidate.is_absolute():
        raise ValueError(f"caminho precisa ser relativo: {relative_path}")
    resolved = (project_root / candidate).resolve()
    try:
        resolved.relative_to(project_root)
    except ValueError as error:
        raise ValueError(
            f"caminho sai do repositório: {relative_path}"
        ) from error
    return resolved


def validate_request(value: Any) -> list[dict[str, Any]]:
    if (
        not isinstance(value, dict)
        or set(value) != {
            "schemaVersion",
            "sampleRate",
            "inputPolicy",
            "futureSamplesUsed",
            "sources",
        }
        or value.get("schemaVersion") != REQUEST_SCHEMA
    ):
        raise ValueError("schemaVersion do request incompatível")
    if value.get("sampleRate") != 16_000:
        raise ValueError("request precisa usar 16 kHz")
    if (
        value.get("inputPolicy") != INPUT_POLICY
        or value.get("futureSamplesUsed") != 0
    ):
        raise ValueError("request não prova truncagem física causal")
    sources = value.get("sources")
    if not isinstance(sources, list) or len(sources) != 60:
        raise ValueError("request precisa conter exatamente 60 fontes")
    seen_ids: set[str] = set()
    seen_paths: set[str] = set()
    counts = {split: 0 for split in ALLOWED_SPLITS}
    for index, source in enumerate(sources):
        if not isinstance(source, dict):
            raise ValueError(f"sources[{index}] inválida")
        if set(source) != SOURCE_KEYS:
            raise ValueError(f"sources[{index}] contém campos indevidos")
        scene_id = source.get("sceneId")
        split = source.get("partition")
        relative_path = source.get("truncatedRelativePath")
        hashes = [
            source.get("sourceWaveSha256"),
            source.get("sourcePcmSha256"),
            source.get("truncatedWaveSha256"),
            source.get("truncatedPcmSha256"),
        ]
        source_onset = source.get("sourceOnsetSample")
        input_start = source.get("inputStartSample")
        accepted_through = source.get("acceptedThroughSample")
        input_end = source.get("inputEndSampleExclusive")
        if (
            not isinstance(scene_id, str)
            or not scene_id
            or scene_id in seen_ids
            or split not in ALLOWED_SPLITS
            or not isinstance(relative_path, str)
            or not relative_path
            or relative_path in seen_paths
            or not all(
                isinstance(digest, str)
                and digest.startswith("sha256:")
                and len(digest) == 71
                for digest in hashes
            )
            or not isinstance(source_onset, int)
            or isinstance(source_onset, bool)
            or source_onset < 0
            or accepted_through
            != source_onset + ELIGIBLE_THROUGH_SAMPLE
            or input_start != 0
            or input_end != source_onset + DECISION_SAMPLE
            or source.get("futureSamplesUsed") != 0
        ):
            raise ValueError(f"sources[{index}] rompe identidade/split/hash")
        seen_ids.add(scene_id)
        seen_paths.add(relative_path)
        counts[split] += 1
    if any(count != 30 for count in counts.values()):
        raise ValueError("request precisa conter 30 fontes por split")
    return sources


def read_pcm16_wave(path: Path) -> tuple[bytes, int]:
    with wave.open(str(path), "rb") as source:
        if (
            source.getnchannels() != 1
            or source.getsampwidth() != 2
            or source.getframerate() != 16_000
            or source.getcomptype() != "NONE"
        ):
            raise ValueError(f"WAV truncado precisa ser PCM16 mono 16 kHz: {path}")
        frame_count = source.getnframes()
        pcm = source.readframes(frame_count)
        if len(pcm) != frame_count * 2:
            raise ValueError(f"WAV truncado possui PCM incompleto: {path}")
        return pcm, frame_count


def timestamp_start_sample(seconds: float) -> int:
    return int(math.floor(seconds * 16_000))


def timestamp_end_sample(seconds: float) -> int:
    return int(math.ceil(seconds * 16_000))


def snapshot_files(model_dir: Path) -> list[dict[str, Any]]:
    snapshot_dir = (
        model_dir.resolve()
        / "models--Systran--faster-whisper-small"
        / "snapshots"
        / MODEL_REVISION
    )
    result = []
    for name, expected_sha256, expected_size in SNAPSHOT_FILES:
        path = snapshot_dir / name
        if not path.is_file():
            raise ValueError(f"arquivo essencial do snapshot ausente: {name}")
        observed_sha256 = sha256_file(path)
        observed_size = path.stat().st_size
        if (
            observed_sha256 != expected_sha256
            or observed_size != expected_size
        ):
            raise ValueError(f"snapshot local divergente: {name}")
        result.append({
            "name": name,
            "sha256": observed_sha256,
            "sizeBytes": observed_size,
        })
    return result


def finite(value: Any) -> float | None:
    if value is None:
        return None
    converted = float(value)
    return converted if math.isfinite(converted) else None


def main() -> None:
    args = parse_args()
    if args.threads < 1:
        raise ValueError("threads precisa ser positivo")

    project_root = Path.cwd().resolve()
    request_path = args.request.resolve()
    request_bytes = request_path.read_bytes()
    request = json.loads(request_bytes)
    sources = validate_request(request)
    observed_snapshot_files = snapshot_files(args.model_dir)

    from faster_whisper import WhisperModel

    model = WhisperModel(
        "small",
        device="cpu",
        compute_type="int8",
        cpu_threads=args.threads,
        num_workers=1,
        download_root=str(args.model_dir.resolve()),
        local_files_only=True,
        revision=MODEL_REVISION,
    )

    aligned_sources: list[dict[str, Any]] = []
    for source in sources:
        audio_path = repository_path(
            project_root, source["truncatedRelativePath"]
        )
        truncated_root = (
            project_root / "eval/generated/exp-0017/r/truncated"
        ).resolve()
        try:
            audio_path.relative_to(truncated_root)
        except ValueError as error:
            raise ValueError(
                f"WAV não pertence à área truncada: {source['sceneId']}"
            ) from error
        observed_wave_sha256 = sha256_file(audio_path)
        if observed_wave_sha256 != source["truncatedWaveSha256"]:
            raise ValueError(f"WAV truncado divergente: {source['sceneId']}")
        truncated_pcm, frame_count = read_pcm16_wave(audio_path)
        if sha256_bytes(truncated_pcm) != source["truncatedPcmSha256"]:
            raise ValueError(f"PCM truncado divergente: {source['sceneId']}")
        if (
            frame_count != source["inputEndSampleExclusive"]
            or source["inputStartSample"] != 0
        ):
            raise ValueError(f"intervalo físico divergente: {source['sceneId']}")

        segments_iterator, info = model.transcribe(
            str(audio_path),
            language="pt",
            beam_size=1,
            best_of=1,
            temperature=0.0,
            condition_on_previous_text=False,
            vad_filter=False,
            word_timestamps=True,
            without_timestamps=False,
        )
        realized = list(segments_iterator)
        segments = []
        words = []
        for segment in realized:
            segment_words = []
            for word in segment.words or []:
                start_seconds = finite(word.start)
                end_seconds = finite(word.end)
                if (
                    start_seconds is None
                    or end_seconds is None
                    or timestamp_start_sample(start_seconds)
                    < source["inputStartSample"]
                    or timestamp_end_sample(end_seconds)
                    > source["inputEndSampleExclusive"]
                ):
                    raise ValueError(
                        f"palavra ultrapassa WAV truncado: {source['sceneId']}"
                    )
                record = {
                    "startSeconds": start_seconds,
                    "endSeconds": end_seconds,
                    "text": word.word,
                    "probability": finite(word.probability),
                }
                segment_words.append(record)
                words.append(record)
            segment_start = finite(segment.start)
            segment_end = finite(segment.end)
            if (
                segment_start is None
                or segment_end is None
                or timestamp_start_sample(segment_start)
                < source["inputStartSample"]
                or timestamp_end_sample(segment_end)
                > source["inputEndSampleExclusive"]
            ):
                raise ValueError(
                    f"segmento ultrapassa WAV truncado: {source['sceneId']}"
                )
            segments.append(
                {
                    "startSeconds": segment_start,
                    "endSeconds": segment_end,
                    "text": segment.text,
                    "words": segment_words,
                }
            )

        aligned_sources.append(
            {
                **source,
                "decodedText": "".join(
                    segment.text for segment in realized
                ).strip(),
                "language": info.language,
                "languageProbability": finite(info.language_probability),
                "durationSeconds": finite(info.duration),
                "segments": segments,
                "words": words,
            }
        )

    output = {
        "schemaVersion": RAW_SCHEMA,
        "requestSha256": sha256_bytes(request_bytes),
        "sampleRate": 16_000,
        "inputPolicy": INPUT_POLICY,
        "futureSamplesUsed": 0,
        "model": {
            "engine": "faster-whisper",
            "name": "small",
            "revision": MODEL_REVISION,
            "device": "cpu",
            "computeType": "int8",
            "cpuThreads": args.threads,
            "numWorkers": 1,
            "wordTimestamps": True,
            "localFilesOnly": True,
            "fasterWhisperVersion": importlib.metadata.version(
                "faster-whisper"
            ),
            "snapshotFiles": observed_snapshot_files,
            "inputPolicy": INPUT_POLICY,
            "futureSamplesUsed": 0,
        },
        "decoding": {
            "language": "pt",
            "beamSize": 1,
            "bestOf": 1,
            "temperature": 0.0,
            "conditionOnPreviousText": False,
            "vadFilter": False,
        },
        "sources": aligned_sources,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            output,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
