#!/usr/bin/env python3
"""Materialize a frozen EXP-0017 Supertonic scene plan in one model load."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from supertonic import TTS


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    args = parser.parse_args()

    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    tts = TTS(
        model="supertonic-3",
        model_dir=args.model_dir,
        auto_download=False,
    )
    styles = {}
    generated = 0
    for split in ("train", "development"):
        split_root = args.output_root / split
        split_root.mkdir(parents=True, exist_ok=True)
        for scene in plan["scenes"][split]:
            voice = scene["voiceStyle"]
            if voice not in styles:
                styles[voice] = tts.get_voice_style(voice_name=voice)
            wav, _ = tts.synthesize(
                scene["text"],
                voice_style=styles[voice],
                total_steps=8,
                speed=1.05,
                lang="pt",
                verbose=False,
            )
            tts.save_audio(wav, str(split_root / f"{scene['id']}.wav"))
            generated += 1
    print(f"Supertonic materializou {generated} cenas locais")


if __name__ == "__main__":
    main()
