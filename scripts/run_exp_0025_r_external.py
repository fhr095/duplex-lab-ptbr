#!/usr/bin/env python3
"""One-shot official DuplexCascade protocol preflight plus EXP-0025-R D.

This adapter intentionally exercises only the published textual micro-turn LLM.
It never reads EXP-0025-R H and preserves every prompt/output token trajectory.
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.metadata
import json
import os
import platform
import random
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA = "exp-0025-r-external-raw-evidence-v1"
EXPERIMENT_ID = "EXP-0025-R"
CANDIDATE_ID = "E-official-duplexcascade-v0.1"
OFFICIAL_CODE_COMMIT = "42893024ca90c8de8ac3ed624467ebc123512ff8"
EXTERNAL_REPO = "sbintuitions/DuplexCascade"
EXTERNAL_REVISION = "dca21cb1309bb533d80f5aa5600c7b0cc2c470e3"
BASE_REPO = "Qwen/Qwen2-7B-Instruct"
BASE_REVISION = "f2826a00ceef68f0f2b946d945ecc0477ce4450c"
MODEL_STATE_SHA256 = (
    "603070a3251613328859105fa66fe0711e101099a7b0885da41617f575bed5e9"
)
MODEL_STATE_BYTES = 17_419_657_672
TOKENIZER_JSON_BYTES = 11_419_443
TOKENIZER_JSON_SHA256 = (
    "f84571b782afc4b884e8ad68ce5a02c3cdd236a8d81cae46f5c676165fa5fd40"
)
BASE_SHARDS = {
    "model-00001-of-00004.safetensors": (
        3_945_426_872,
        "26d9919262ccd063fcdfd926763fe9025ef1e3073767aaa8c83a375d7c5140c4",
    ),
    "model-00002-of-00004.safetensors": (
        3_864_726_352,
        "f5bb99fdadcac55c2c176497ec99f088a1764e78ed986fa4a0d45d12426ef0fa",
    ),
    "model-00003-of-00004.safetensors": (
        3_864_726_408,
        "0b749a4446d7cda007d5e7bd9f908849d08d89867192d4c039dc167e9ab5a02e",
    ),
    "model-00004-of-00004.safetensors": (
        3_556_392_240,
        "da724bb7d3c3512eb371aa6caa5bcc08d78bda84f94e00ae9a9b2124e3e9c62f",
    ),
}
MAX_ARTIFACT_BYTES = 40 * 1024**3
MAX_GPU_SECONDS = 2 * 60 * 60
MAX_COST_USD = 12.0
OVERLAP_WINDOW_SECONDS = 0.6
MAX_NEW_TOKENS = 64
INFRA_SEED = 25025
SPECIAL_TOKENS = [
    "<|no voice|>",
    "<|user is talking|>",
    "<|user finish talking|>",
    "<|user is thinking|>",
    "<|user interruption|>",
    "<|user backchannel|>",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_json(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, delete=False
    ) as temporary:
        json.dump(value, temporary, ensure_ascii=False, separators=(",", ":"))
        temporary.write("\n")
        temporary.flush()
        os.fsync(temporary.fileno())
        temporary_path = Path(temporary.name)
    temporary_path.replace(path)


class Journal:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, value: Any) -> None:
        with self.path.open("a", encoding="utf-8") as target:
            target.write(
                json.dumps(value, ensure_ascii=False, separators=(",", ":"))
            )
            target.write("\n")
            target.flush()
            os.fsync(target.fileno())


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as source:
        return json.load(source)


def git_commit(path: Path) -> str:
    return subprocess.check_output(
        ["git", "-C", str(path), "rev-parse", "HEAD"], text=True
    ).strip()


def require_equal(observed: Any, expected: Any, label: str) -> None:
    if observed != expected:
        raise RuntimeError(f"{label} mismatch: {observed!r} != {expected!r}")


def verify_file(path: Path, expected_bytes: int, expected_sha256: str) -> dict:
    require_equal(path.stat().st_size, expected_bytes, f"{path.name} bytes")
    observed_sha256 = sha256_file(path)
    require_equal(observed_sha256, expected_sha256, f"{path.name} sha256")
    return {
        "path": str(path),
        "byteLength": expected_bytes,
        "sha256": observed_sha256,
    }


def snapshot_bytes(*roots: Path) -> int:
    resolved_files: dict[Path, int] = {}
    for root in roots:
        for path in root.rglob("*"):
            if path.is_file():
                resolved = path.resolve()
                resolved_files[resolved] = resolved.stat().st_size
    return sum(resolved_files.values())


def package_versions(names: list[str]) -> dict[str, str]:
    versions: dict[str, str] = {}
    for name in names:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = "NOT_INSTALLED"
    return versions


def action_from_output(output: str, assistant_speaking: bool) -> str:
    text = output.strip()
    if text.startswith(("<|user is talking|>", "<|user is thinking|>")):
        return "CONTINUE_LISTENING"
    if text.startswith("<|user finish talking|>"):
        return "TAKE_FLOOR"
    if text.startswith("<|user backchannel|>"):
        return "KEEP_ASSISTANT_FLOOR" if assistant_speaking else "PROTOCOL_FAILURE"
    if text.startswith("<|user interruption|>"):
        return "YIELD_FLOOR" if assistant_speaking else "PROTOCOL_FAILURE"
    if not text or text.startswith(("<|no voice|>", "<|")):
        return "PROTOCOL_FAILURE"
    return "KEEP_ASSISTANT_FLOOR" if assistant_speaking else "TAKE_FLOOR"


class OfficialMicroturnRunner:
    def __init__(self, model: Any, tokenizer: Any, torch: Any, device: str) -> None:
        self.model = model
        self.tokenizer = tokenizer
        self.torch = torch
        self.device = device

        def ids(text: str) -> list[int]:
            return tokenizer.encode(text, add_special_tokens=False)

        self.bos_id = tokenizer.bos_token_id
        self.header_user = ids("<|im_start|>user\n")
        self.header_assistant = ids("<|im_start|>assistant\n")
        self.im_end_ids = ids("<|im_end|>")
        self.im_end_id = (
            self.im_end_ids[0] if self.im_end_ids else tokenizer.eos_token_id
        )
        self.im_end_newline_ids = ids("<|im_end|>\n") or list(self.im_end_ids)
        self.no_voice_ids = ids("<|no voice|>")

    def empty_history(self) -> list[int]:
        return [] if self.bos_id is None else [int(self.bos_id)]

    def append_microturn(self, history: list[int], role: str, content: str) -> None:
        if role == "user":
            history.extend(self.header_user)
        elif role == "assistant":
            history.extend(self.header_assistant)
        else:
            raise ValueError(f"unsupported role: {role}")
        history.extend(self.tokenizer.encode(content, add_special_tokens=False))
        history.extend(self.im_end_newline_ids)

    def generate(
        self,
        history: list[int],
        *,
        at_ms: int,
        delta_text: str | None,
        assistant_speaking: bool,
        voice_active: bool,
    ) -> dict:
        history.extend(self.header_user)
        if delta_text:
            history.extend(
                self.tokenizer.encode(delta_text, add_special_tokens=False)
            )
        else:
            history.extend(self.no_voice_ids)
        history.extend(self.im_end_newline_ids)
        history.extend(self.header_assistant)
        input_ids = list(history)
        input_tensor = self.torch.tensor(
            [input_ids], dtype=self.torch.long, device=self.device
        )
        attention_mask = self.torch.ones_like(input_tensor)
        if self.device.startswith("cuda"):
            self.torch.cuda.synchronize()
        started = time.perf_counter()
        with self.torch.inference_mode():
            generated = self.model.generate(
                input_ids=input_tensor,
                attention_mask=attention_mask,
                max_new_tokens=MAX_NEW_TOKENS,
                eos_token_id=self.im_end_id,
                pad_token_id=self.im_end_id,
                do_sample=False,
            )
        if self.device.startswith("cuda"):
            self.torch.cuda.synchronize()
        latency_ms = (time.perf_counter() - started) * 1000
        generated_ids = generated[0, input_tensor.shape[-1] :].tolist()
        history.extend(int(token_id) for token_id in generated_ids)
        decoded = self.tokenizer.decode(
            generated_ids,
            skip_special_tokens=False,
            clean_up_tokenization_spaces=False,
        )
        return {
            "atMs": at_ms,
            "deltaText": delta_text,
            "voiceActive": voice_active,
            "assistantSpeaking": assistant_speaking,
            "inputTokenIds": input_ids,
            "inputTokenIdsSha256": sha256_json(input_ids),
            "generatedTokenIds": generated_ids,
            "generatedTokenPieces": self.tokenizer.convert_ids_to_tokens(
                generated_ids
            ),
            "decodedRaw": decoded,
            "observedAction": action_from_output(decoded, assistant_speaking),
            "generationLatencyMs": latency_ms,
        }


def run_sentinels(
    runner: OfficialMicroturnRunner, scenarios: dict, journal: Journal
) -> list[dict]:
    observations: list[dict] = []
    for scenario in scenarios["sentinels"]:
        history = runner.empty_history()
        for item in scenario["history"]:
            runner.append_microturn(history, item["role"], item["content"])
        generation = runner.generate(
            history,
            at_ms=600,
            delta_text=scenario["currentUserMicroturn"],
            assistant_speaking=scenario["assistantSpeaking"],
            voice_active=True,
        )
        observation = {
            "id": scenario["id"],
            "assistantSpeaking": scenario["assistantSpeaking"],
            "expectedAction": scenario["expectedAction"],
            "output": generation["decodedRaw"],
            "observedAction": generation["observedAction"],
            "pass": generation["observedAction"] == scenario["expectedAction"],
            "generations": [generation],
        }
        observations.append(observation)
        journal.append({"stage": "SENTINEL", "observation": observation})
    return observations


def development_ticks(utterance: dict) -> list[dict]:
    ticks = [
        {
            "atMs": int(item["atMs"]),
            "deltaText": item["deltaText"],
            "voiceActive": bool(item["voiceActive"]),
        }
        for item in utterance["microturns"]
    ]
    boundary = int(utterance["criticalBoundaryAtMs"])
    for at_ms in (boundary + 600, boundary + 1200):
        if utterance["outcome"] == "CONTINUES" and int(
            utterance["resumeAtMs"]
        ) <= at_ms:
            break
        ticks.append({"atMs": at_ms, "deltaText": None, "voiceActive": False})
    return ticks


def run_development(
    runner: OfficialMicroturnRunner, pack: dict, journal: Journal
) -> list[dict]:
    observations: list[dict] = []
    for utterance in pack["utterances"]:
        history = runner.empty_history()
        generations: list[dict] = []
        for tick in development_ticks(utterance):
            generation = runner.generate(
                history,
                at_ms=tick["atMs"],
                delta_text=tick["deltaText"],
                assistant_speaking=False,
                voice_active=tick["voiceActive"],
            )
            generations.append(generation)
            journal.append(
                {
                    "stage": "DEVELOPMENT_GENERATION",
                    "utteranceId": utterance["id"],
                    "generation": generation,
                }
            )
            if generation["observedAction"] in {
                "TAKE_FLOOR",
                "PROTOCOL_FAILURE",
            }:
                break
        observation = {
            "id": utterance["id"],
            "pairId": utterance["pairId"],
            "sessionId": utterance["sessionId"],
            "family": utterance["family"],
            "outcome": utterance["outcome"],
            "generations": generations,
        }
        observations.append(observation)
        journal.append({"stage": "DEVELOPMENT_UTTERANCE", "observation": observation})
    return observations


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--official-code-dir", type=Path, required=True)
    parser.add_argument(
        "--pack",
        type=Path,
        default=Path("eval/datasets/exp-0025-r-development-v0.1.json"),
    )
    parser.add_argument(
        "--sentinels",
        type=Path,
        default=Path("eval/scenarios/exp-0025-r-external-sentinels-v0.1.json"),
    )
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--provider", required=True)
    parser.add_argument("--hourly-usd", type=float, required=True)
    parser.add_argument("--allocation-start-epoch", type=float, default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.hourly_usd < 0 or args.hourly_usd > MAX_COST_USD / 2:
        raise RuntimeError("hourly rate cannot fit the frozen 2h / US$12 budget")
    started_at = utc_now()
    process_started = time.time()
    allocation_started = args.allocation_start_epoch or process_started
    journal = Journal(args.output.with_suffix(".journal.ndjson"))
    pack = read_json(args.pack)
    scenarios = read_json(args.sentinels)
    require_equal(pack.get("experimentId"), EXPERIMENT_ID, "pack experiment")
    require_equal(pack.get("split"), "development", "pack split")
    require_equal(len(pack.get("utterances", [])), 32, "D utterance count")
    require_equal(scenarios.get("experimentId"), EXPERIMENT_ID, "sentinels")
    require_equal(len(scenarios.get("sentinels", [])), 4, "sentinel count")
    require_equal(
        git_commit(args.official_code_dir), OFFICIAL_CODE_COMMIT, "official code"
    )
    require_equal(
        sha256_file(args.official_code_dir / "model.py"),
        "ba4fd852966b67acc909827c55cb436385f01534aa425cce7d72c623829dc077",
        "official model.py",
    )
    require_equal(
        sha256_file(args.official_code_dir / "server.py"),
        "404a1b6f51e87c012e1111cc21a712ed8895e9a5ee99328bd1245a7c6a654037",
        "official server.py",
    )

    expected_artifact_bytes = MODEL_STATE_BYTES + TOKENIZER_JSON_BYTES + sum(
        size for size, _ in BASE_SHARDS.values()
    )
    if expected_artifact_bytes > MAX_ARTIFACT_BYTES:
        raise RuntimeError("frozen artifacts exceed 40 GiB before download")

    import torch
    from huggingface_hub import snapshot_download
    from safetensors.torch import load_file as load_safetensors_file
    from transformers import AutoTokenizer

    if not torch.cuda.is_available() or not args.device.startswith("cuda"):
        raise RuntimeError("official E requires a CUDA GPU in this execution")
    torch.manual_seed(INFRA_SEED)
    torch.cuda.manual_seed_all(INFRA_SEED)
    random.seed(INFRA_SEED)

    external_dir = Path(
        snapshot_download(
            repo_id=EXTERNAL_REPO,
            revision=EXTERNAL_REVISION,
            cache_dir=args.cache_dir,
            allow_patterns=[
                "model_state.safetensors",
                "train_cfg.json",
                "tokenizer/*",
                "README.md",
                "LICENSE",
            ],
        )
    )
    base_dir = Path(
        snapshot_download(
            repo_id=BASE_REPO,
            revision=BASE_REVISION,
            cache_dir=args.cache_dir,
            allow_patterns=[
                "config.json",
                "generation_config.json",
                "model.safetensors.index.json",
                "model-*.safetensors",
            ],
        )
    )
    model_state = verify_file(
        external_dir / "model_state.safetensors",
        MODEL_STATE_BYTES,
        MODEL_STATE_SHA256,
    )
    base_files = [
        verify_file(base_dir / name, size, digest)
        for name, (size, digest) in BASE_SHARDS.items()
    ]
    tokenizer_file = verify_file(
        external_dir / "tokenizer/tokenizer.json",
        TOKENIZER_JSON_BYTES,
        TOKENIZER_JSON_SHA256,
    )
    require_equal(
        sha256_file(external_dir / "train_cfg.json"),
        "94bd10a7308f094526e2fd8ad71f581902af4c9af962a2e8e82a949c3a9b80c5",
        "external train_cfg.json",
    )
    observed_snapshot_bytes = snapshot_bytes(external_dir, base_dir)
    if observed_snapshot_bytes > MAX_ARTIFACT_BYTES:
        raise RuntimeError("downloaded checkpoint snapshots exceed 40 GiB")

    sys.path.insert(0, str(args.official_code_dir.resolve()))
    from model import Model

    tokenizer = AutoTokenizer.from_pretrained(
        str(external_dir / "tokenizer"), use_fast=True, trust_remote_code=False
    )
    tokenizer.add_special_tokens({"additional_special_tokens": SPECIAL_TOKENS})
    expected_special_ids = {
        "<|no voice|>": 151646,
        "<|user is talking|>": 151647,
        "<|user finish talking|>": 151648,
        "<|user is thinking|>": 151649,
        "<|user interruption|>": 151650,
        "<|user backchannel|>": 151651,
    }
    observed_special_ids = {
        token: tokenizer.encode(token, add_special_tokens=False)
        for token in SPECIAL_TOKENS
    }
    require_equal(
        observed_special_ids,
        {token: [token_id] for token, token_id in expected_special_ids.items()},
        "published special token ids",
    )
    llm_model = Model(
        tokenizer=tokenizer,
        model_name=str(base_dir),
        trust_remote_code=False,
    )
    llm_model.enable_lora_adapter()
    llm_model.to(args.device)
    llm_model.eval()
    state_dict = load_safetensors_file(
        str(external_dir / "model_state.safetensors"), device="cpu"
    )
    incompatible = llm_model.load_state_dict(state_dict, strict=False)
    model_load = {
        "missingKeys": list(incompatible.missing_keys),
        "unexpectedKeys": list(incompatible.unexpected_keys),
        "parameterCount": sum(parameter.numel() for parameter in llm_model.parameters()),
        "parameterDtypes": sorted(
            {str(parameter.dtype) for parameter in llm_model.parameters()}
        ),
    }
    del state_dict
    gc.collect()
    torch.cuda.empty_cache()
    runner = OfficialMicroturnRunner(llm_model, tokenizer, torch, args.device)

    sentinels = run_sentinels(runner, scenarios, journal)
    sentinel_pass = all(item["pass"] for item in sentinels)
    development = run_development(runner, pack, journal) if sentinel_pass else []
    completed_at = utc_now()
    gpu_seconds = time.time() - allocation_started
    estimated_cost_usd = args.hourly_usd * gpu_seconds / 3600
    if gpu_seconds > MAX_GPU_SECONDS or estimated_cost_usd > MAX_COST_USD:
        raise RuntimeError("external execution exceeded a frozen budget limit")

    raw = {
        "schemaVersion": SCHEMA,
        "experimentId": EXPERIMENT_ID,
        "candidateId": CANDIDATE_ID,
        "stage": "ENGLISH_SENTINELS_THEN_DEVELOPMENT_D",
        "status": "COMPLETED" if sentinel_pass else "SENTINEL_FAILED",
        "startedAt": started_at,
        "completedAt": completed_at,
        "authorization": {
            "sentinelsAuthorized": True,
            "developmentAuthorized": True,
            "holdoutInferenceAuthorized": False,
            "localReproductionAuthorized": False,
        },
        "checkpoint": {
            "officialCodeCommit": OFFICIAL_CODE_COMMIT,
            "externalRepo": EXTERNAL_REPO,
            "externalSnapshotCommit": EXTERNAL_REVISION,
            "baseRepo": BASE_REPO,
            "baseSnapshotCommit": BASE_REVISION,
            "modelState": model_state,
            "tokenizerJson": tokenizer_file,
            "baseFiles": base_files,
        },
        "configuration": {
            "overlapWindowSeconds": OVERLAP_WINDOW_SECONDS,
            "maxNewTokens": MAX_NEW_TOKENS,
            "doSample": False,
            "infraSeed": INFRA_SEED,
            "freePromptAdded": False,
            "quantized": False,
            "specialTokenIds": expected_special_ids,
        },
        "inputs": {
            "developmentPackPath": str(args.pack),
            "developmentPackFileSha256": sha256_file(args.pack),
            "developmentPackSha256": pack["packSha256"],
            "sentinelPackPath": str(args.sentinels),
            "sentinelPackFileSha256": sha256_file(args.sentinels),
        },
        "environment": {
            "provider": args.provider,
            "platform": platform.platform(),
            "python": sys.version,
            "packages": package_versions(
                [
                    "torch",
                    "transformers",
                    "peft",
                    "huggingface-hub",
                    "safetensors",
                ]
            ),
            "cuda": torch.version.cuda,
            "gpu": torch.cuda.get_device_name(torch.device(args.device)),
            "gpuCountUsed": 1,
        },
        "modelLoad": model_load,
        "budget": {
            "frozenArtifactBytesLowerBound": expected_artifact_bytes,
            "snapshotArtifactBytes": observed_snapshot_bytes,
            "snapshotArtifactGiB": observed_snapshot_bytes / 1024**3,
            "limitArtifactGiB": 40,
            "gpuSeconds": gpu_seconds,
            "limitGpuSeconds": MAX_GPU_SECONDS,
            "hourlyUsd": args.hourly_usd,
            "estimatedCostUsd": estimated_cost_usd,
            "limitCostUsd": MAX_COST_USD,
        },
        "sentinels": sentinels,
        "development": development,
    }
    raw["evidenceSha256"] = sha256_json(raw)
    atomic_json(args.output, raw)
    journal.append(
        {
            "stage": "FINAL",
            "status": raw["status"],
            "evidenceSha256": raw["evidenceSha256"],
        }
    )
    print(
        json.dumps(
            {
                "status": raw["status"],
                "sentinelsPassed": sum(item["pass"] for item in sentinels),
                "developmentUtterances": len(development),
                "gpuSeconds": gpu_seconds,
                "estimatedCostUsd": estimated_cost_usd,
                "evidenceSha256": raw["evidenceSha256"],
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
