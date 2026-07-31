#!/usr/bin/env python3
"""Fetch a small, deterministic CORAA test sample through HTTP ranges."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

from remotezip import RemoteZip


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROOT = PROJECT_ROOT / "eval/generated/coraa"
METADATA_URL = (
    "https://huggingface.co/datasets/gabrielrstan/CORAA-v1.1/"
    "resolve/main/metadata_test_final.csv"
)
ARCHIVE_URL = (
    "https://huggingface.co/datasets/gabrielrstan/CORAA-v1.1/"
    "resolve/main/test.zip"
)
SEED = "duplex-lab-coraa-v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=12)
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_ROOT / "manifest.json",
    )
    parser.add_argument("--refresh", action="store_true")
    return parser.parse_args()


def fetch_file(url: str, destination: Path, refresh: bool) -> None:
    if destination.exists() and not refresh:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(f"{destination.suffix}.part")
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "duplex-lab-ptbr/0.1"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        with temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
    os.replace(temporary, destination)


def as_int(row: dict[str, str], field: str) -> int:
    try:
        return int(row.get(field, "0") or "0")
    except ValueError:
        return 0


def stable_key(row: dict[str, str]) -> str:
    value = f"{SEED}:{row['file_path']}".encode()
    return hashlib.sha256(value).hexdigest()


def category_for(row: dict[str, str]) -> str:
    checks = (
        ("second-voice", "votes_for_second_voice"),
        ("filled-pause", "votes_for_filled_pause"),
        ("hesitation", "votes_for_hesitation"),
        ("noise", "votes_for_noise_or_low_voice"),
    )
    for category, field in checks:
        if as_int(row, field) > 0:
            return category
    return "spontaneous-clean"


def choose_rows(rows: list[dict[str, str]], count: int) -> list[dict[str, str]]:
    if count < 1 or count > 50:
        raise ValueError("--count deve estar entre 1 e 50")

    ordered = sorted(rows, key=stable_key)
    selected: list[dict[str, str]] = []
    selected_paths: set[str] = set()

    def add_first(predicate) -> None:
        for row in ordered:
            if row["file_path"] not in selected_paths and predicate(row):
                selected.append(row)
                selected_paths.add(row["file_path"])
                return

    phenomena = (
        "votes_for_hesitation",
        "votes_for_filled_pause",
        "votes_for_noise_or_low_voice",
        "votes_for_second_voice",
    )
    for field in phenomena:
        add_first(lambda row, field=field: as_int(row, field) > 0)

    add_first(
        lambda row: all(as_int(row, field) == 0 for field in phenomena)
    )

    datasets = sorted({row["dataset"] for row in ordered})
    for dataset in datasets:
        add_first(lambda row, dataset=dataset: row["dataset"] == dataset)

    for row in ordered:
        if len(selected) >= count:
            break
        if row["file_path"] not in selected_paths:
            selected.append(row)
            selected_paths.add(row["file_path"])

    return selected[:count]


def safe_filename(file_path: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "--", file_path).strip("-")
    if not value.lower().endswith(".wav"):
        raise ValueError(f"arquivo CORAA inesperado: {file_path}")
    return value


def main() -> None:
    options = parse_args()
    output_path = options.out.resolve()
    generated_root = output_path.parent
    metadata_path = generated_root / "metadata_test_final.csv"
    audio_root = generated_root / "audio"

    fetch_file(METADATA_URL, metadata_path, options.refresh)
    with metadata_path.open(encoding="utf-8", newline="") as handle:
        rows = [
            row
            for row in csv.DictReader(handle)
            if row.get("variety", "").lower() == "pt_br"
            and row.get("text", "").strip()
            and row.get("file_path", "").startswith("test/")
        ]

    selected = choose_rows(rows, options.count)
    audio_root.mkdir(parents=True, exist_ok=True)
    cases = []

    missing = [
        row
        for row in selected
        if options.refresh
        or not (audio_root / safe_filename(row["file_path"])).exists()
    ]
    if missing:
        print(
            f"CORAA: buscando {len(missing)} clipes por HTTP Range...",
            file=sys.stderr,
        )
        with RemoteZip(ARCHIVE_URL) as archive:
            available = set(archive.namelist())
            for index, row in enumerate(missing, start=1):
                member = row["file_path"]
                if member not in available:
                    raise FileNotFoundError(
                        f"{member} não existe no arquivo CORAA"
                    )
                target = audio_root / safe_filename(member)
                target.write_bytes(archive.read(member))
                print(
                    f"CORAA: {index}/{len(missing)} {member}",
                    file=sys.stderr,
                )

    for row in selected:
        target = audio_root / safe_filename(row["file_path"])
        cases.append(
            {
                "id": row["file_path"].removesuffix(".wav"),
                "category": category_for(row),
                "audio": target.relative_to(PROJECT_ROOT).as_posix(),
                "expected": row["text"].strip(),
                "metadata": {
                    "dataset": row["dataset"],
                    "accent": row["accent"],
                    "speechGenre": row["speech_genre"],
                    "speechStyle": row["speech_style"],
                    "votesForHesitation": as_int(
                        row, "votes_for_hesitation"
                    ),
                    "votesForFilledPause": as_int(
                        row, "votes_for_filled_pause"
                    ),
                    "votesForNoiseOrLowVoice": as_int(
                        row, "votes_for_noise_or_low_voice"
                    ),
                    "votesForSecondVoice": as_int(
                        row, "votes_for_second_voice"
                    ),
                },
            }
        )

    manifest = {
        "schemaVersion": 1,
        "id": f"coraa-ptbr-test-{len(cases)}-v1",
        "kind": "human-speech",
        "source": {
            "name": "CORAA ASR v1.1",
            "archive": ARCHIVE_URL,
            "metadata": METADATA_URL,
            "license": "CC BY-NC-ND 4.0",
            "selectionSeed": SEED,
        },
        "cases": cases,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        f"{json.dumps(manifest, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
    )
    print(json.dumps({"manifest": str(output_path), "cases": len(cases)}))


if __name__ == "__main__":
    main()
