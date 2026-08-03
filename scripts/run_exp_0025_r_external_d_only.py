#!/usr/bin/env python3
"""Single-pass EXP-0025-R development completion with the frozen E model.

The four English sentinels are immutable prior evidence and are not generated
again. This process loads the same official checkpoint, runs only the 32 D
utterances, preserves every token trajectory, and never receives a holdout.
"""

from __future__ import annotations

import argparse
import gc
import json
import random
import sys
import time
from pathlib import Path

from scripts import run_exp_0025_r_external as shared

SCHEMA = "exp-0025-r-external-d-only-raw-evidence-v1"
STAGE = "DEVELOPMENT_D_ONLY_AFTER_OFFICIAL_SENTINELS"
AUTHORIZATION_SCHEMA = "exp-0025-r-external-d-only-authorization-v1"
AUTHORIZATION_STAGE = "FOURTH_ALLOCATION_DEVELOPMENT_D_ONLY_AUTHORIZED"
PRIOR_SENTINEL_REPORT_SHA256 = (
    "653f4086772c9b3804e96768de543c5c07808439e0fd383240ab64c5cf167d54"
)
PRIOR_SENTINEL_REPORT_CORE_SHA256 = (
    "sha256:1276c467c8e68f1427795030e9d2dbb5c85cbc0e0eec4cfbd8bd8c4d5fe12cde"
)
PRIOR_CUMULATIVE_GPU_SECONDS = 1193.4900000095367
PRIOR_CUMULATIVE_COST_USD = 0.958107250007656
PRIOR_CUMULATIVE_TRANSFER_BYTES = 37_706_974_907
MAX_CUMULATIVE_DOWNLOAD_BYTES = 70 * 1024**3
MAX_SNAPSHOT_BYTES = 40 * 1024**3
BASE_ACTION_FROM_OUTPUT = shared.action_from_output


def official_action_from_output(output: str, assistant_speaking: bool) -> str:
    """Bind the contextual interpretation already audited against server.py."""
    text = output.strip()
    if assistant_speaking and text.startswith("<|user is talking|>"):
        return "YIELD_FLOOR"
    return BASE_ACTION_FROM_OUTPUT(output, assistant_speaking)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--official-code-dir", type=Path, required=True)
    parser.add_argument("--authorization", type=Path, required=True)
    parser.add_argument("--prior-sentinel-report", type=Path, required=True)
    parser.add_argument(
        "--pack",
        type=Path,
        default=Path("eval/datasets/exp-0025-r-development-v0.1.json"),
    )
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--provider", required=True)
    parser.add_argument("--hourly-usd", type=float, required=True)
    parser.add_argument("--allocation-start-epoch", type=float, required=True)
    return parser.parse_args()


def validate_authorization(path: Path) -> dict:
    authorization = shared.read_json(path)
    core = dict(authorization)
    observed_hash = core.pop("authorizationSha256", None)
    shared.require_equal(
        authorization.get("schemaVersion"),
        AUTHORIZATION_SCHEMA,
        "authorization schema",
    )
    shared.require_equal(
        authorization.get("stage"), AUTHORIZATION_STAGE, "authorization stage"
    )
    shared.require_equal(
        authorization.get("candidate", {}).get("id"),
        shared.CANDIDATE_ID,
        "authorization candidate",
    )
    shared.require_equal(
        observed_hash,
        f"sha256:{shared.sha256_json(core)}",
        "authorization canonical hash",
    )
    shared.require_equal(
        authorization.get("authorizedStages"),
        ["DEVELOPMENT_D_SINGLE_PASS_COMPLETION"],
        "authorized stages",
    )
    shared.require_equal(
        authorization.get("providerExecution", {}).get("infrastructureAttempt"),
        4,
        "infrastructure attempt",
    )
    shared.require_equal(
        authorization.get("providerExecution", {}).get("automaticRetryAllowed"),
        False,
        "automatic retry",
    )
    shared.require_equal(
        authorization.get("oldHoldout", {}).get("executionAuthorized"),
        False,
        "old holdout authorization",
    )
    shared.require_equal(
        authorization.get("freshExternalHoldout", {}).get("executionAuthorized"),
        False,
        "fresh holdout authorization",
    )
    budget = authorization.get("cumulativeBudget", {})
    shared.require_equal(budget.get("maximumDownloadGiB"), 70, "download cap")
    shared.require_equal(budget.get("maximumGpuHours"), 2, "GPU cap")
    shared.require_equal(budget.get("maximumExternalCostUsd"), 12, "cost cap")
    return authorization


def validate_prior_sentinels(path: Path, authorization: dict) -> dict:
    shared.require_equal(
        shared.sha256_file(path),
        PRIOR_SENTINEL_REPORT_SHA256,
        "prior sentinel report file",
    )
    report = shared.read_json(path)
    shared.require_equal(
        report.get("reportSha256"),
        PRIOR_SENTINEL_REPORT_CORE_SHA256,
        "prior sentinel report core",
    )
    official = report.get("sentinels", {}).get("officialRuntimeClassification", {})
    shared.require_equal(official.get("status"), "PASS", "official sentinels")
    shared.require_equal(official.get("passed"), 4, "official sentinel passes")
    shared.require_equal(
        report.get("development", {}).get("evaluated"),
        False,
        "prior D status",
    )
    shared.require_equal(
        report.get("validity", {}).get("modelLoadEquivalent"),
        True,
        "prior model load validity",
    )
    shared.require_equal(
        report.get("validity", {}).get("holdoutRead"),
        False,
        "prior holdout read",
    )
    binding = authorization.get("priorSentinelEvidence", {})
    shared.require_equal(
        binding.get("fileSha256"),
        PRIOR_SENTINEL_REPORT_SHA256,
        "authorization sentinel file binding",
    )
    shared.require_equal(
        binding.get("reportSha256"),
        PRIOR_SENTINEL_REPORT_CORE_SHA256,
        "authorization sentinel core binding",
    )
    return report


def validate_load_keys(model_load: dict) -> None:
    missing = model_load["missingKeys"]
    unexpected = model_load["unexpectedKeys"]
    shared.require_equal(len(missing), 112, "PEFT missing key count")
    shared.require_equal(len(unexpected), 112, "PEFT unexpected key count")
    for key in missing:
        if not (".q_proj.base_layer." in key or ".v_proj.base_layer." in key):
            raise RuntimeError(f"unexpected PEFT missing key: {key}")
    for key in unexpected:
        if not (".q_proj." in key or ".v_proj." in key):
            raise RuntimeError(f"unexpected checkpoint key: {key}")


def main() -> None:
    args = parse_args()
    if args.output.exists() or args.output.with_suffix(".journal.ndjson").exists():
        raise RuntimeError("D-only output already exists; rerun is prohibited")
    if args.hourly_usd < 0 or args.hourly_usd > 6:
        raise RuntimeError("hourly rate exceeds the frozen provider ceiling")

    started_at = shared.utc_now()
    allocation_started = args.allocation_start_epoch
    journal = shared.Journal(args.output.with_suffix(".journal.ndjson"))
    authorization = validate_authorization(args.authorization)
    prior_report = validate_prior_sentinels(
        args.prior_sentinel_report, authorization
    )
    pack = shared.read_json(args.pack)
    shared.require_equal(pack.get("experimentId"), shared.EXPERIMENT_ID, "pack")
    shared.require_equal(pack.get("split"), "development", "pack split")
    shared.require_equal(len(pack.get("utterances", [])), 32, "D utterances")
    shared.require_equal(
        shared.sha256_file(args.pack),
        authorization["inputBindings"]["development"]["fileSha256"],
        "development pack hash",
    )
    shared.require_equal(
        shared.git_commit(args.official_code_dir),
        shared.OFFICIAL_CODE_COMMIT,
        "official code",
    )
    shared.require_equal(
        shared.sha256_file(args.official_code_dir / "model.py"),
        "ba4fd852966b67acc909827c55cb436385f01534aa425cce7d72c623829dc077",
        "official model.py",
    )
    shared.require_equal(
        shared.sha256_file(args.official_code_dir / "server.py"),
        "404a1b6f51e87c012e1111cc21a712ed8895e9a5ee99328bd1245a7c6a654037",
        "official server.py",
    )

    expected_artifact_bytes = (
        shared.MODEL_STATE_BYTES
        + shared.TOKENIZER_JSON_BYTES
        + sum(size for size, _ in shared.BASE_SHARDS.values())
    )
    if expected_artifact_bytes > MAX_SNAPSHOT_BYTES:
        raise RuntimeError("same frozen snapshot no longer fits 40 GiB")
    if PRIOR_CUMULATIVE_TRANSFER_BYTES + expected_artifact_bytes > (
        MAX_CUMULATIVE_DOWNLOAD_BYTES
    ):
        raise RuntimeError("rehydration cannot fit the authorized 70 GiB cap")

    import torch
    from huggingface_hub import snapshot_download
    from safetensors.torch import load_file as load_safetensors_file
    from transformers import AutoTokenizer

    if not torch.cuda.is_available() or not args.device.startswith("cuda"):
        raise RuntimeError("official E D-only execution requires CUDA")
    torch.manual_seed(shared.INFRA_SEED)
    torch.cuda.manual_seed_all(shared.INFRA_SEED)
    random.seed(shared.INFRA_SEED)

    external_dir = Path(
        snapshot_download(
            repo_id=shared.EXTERNAL_REPO,
            revision=shared.EXTERNAL_REVISION,
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
            repo_id=shared.BASE_REPO,
            revision=shared.BASE_REVISION,
            cache_dir=args.cache_dir,
            allow_patterns=[
                "config.json",
                "generation_config.json",
                "model.safetensors.index.json",
                "model-*.safetensors",
            ],
        )
    )
    model_state = shared.verify_file(
        external_dir / "model_state.safetensors",
        shared.MODEL_STATE_BYTES,
        shared.MODEL_STATE_SHA256,
    )
    base_files = [
        shared.verify_file(base_dir / name, size, digest)
        for name, (size, digest) in shared.BASE_SHARDS.items()
    ]
    tokenizer_file = shared.verify_file(
        external_dir / "tokenizer/tokenizer.json",
        shared.TOKENIZER_JSON_BYTES,
        shared.TOKENIZER_JSON_SHA256,
    )
    shared.require_equal(
        shared.sha256_file(external_dir / "train_cfg.json"),
        "94bd10a7308f094526e2fd8ad71f581902af4c9af962a2e8e82a949c3a9b80c5",
        "external train_cfg.json",
    )
    observed_snapshot_bytes = shared.snapshot_bytes(external_dir, base_dir)
    if observed_snapshot_bytes > MAX_SNAPSHOT_BYTES:
        raise RuntimeError("downloaded snapshots exceed the frozen 40 GiB shape")
    projected_transfer_bytes = (
        PRIOR_CUMULATIVE_TRANSFER_BYTES + observed_snapshot_bytes
    )
    if projected_transfer_bytes > MAX_CUMULATIVE_DOWNLOAD_BYTES:
        raise RuntimeError("execution exceeded the authorized 70 GiB cap")

    sys.path.insert(0, str(args.official_code_dir.resolve()))
    from model import Model

    tokenizer = AutoTokenizer.from_pretrained(
        str(external_dir / "tokenizer"), use_fast=True, trust_remote_code=False
    )
    tokenizer.add_special_tokens(
        {"additional_special_tokens": shared.SPECIAL_TOKENS}
    )
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
        for token in shared.SPECIAL_TOKENS
    }
    shared.require_equal(
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
        "parameterCount": sum(
            parameter.numel() for parameter in llm_model.parameters()
        ),
        "parameterDtypes": sorted(
            {str(parameter.dtype) for parameter in llm_model.parameters()}
        ),
    }
    validate_load_keys(model_load)
    del state_dict
    gc.collect()
    torch.cuda.empty_cache()

    shared.action_from_output = official_action_from_output
    runner = shared.OfficialMicroturnRunner(
        llm_model, tokenizer, torch, args.device
    )
    development = shared.run_development(runner, pack, journal)
    shared.require_equal(len(development), 32, "completed D observations")
    shared.require_equal(
        len({item["id"] for item in development}), 32, "unique D observations"
    )

    completed_at = shared.utc_now()
    allocation_seconds = time.time() - allocation_started
    estimated_cost_usd = args.hourly_usd * allocation_seconds / 3600
    cumulative_gpu_seconds = (
        PRIOR_CUMULATIVE_GPU_SECONDS + allocation_seconds
    )
    cumulative_cost_usd = PRIOR_CUMULATIVE_COST_USD + estimated_cost_usd
    if cumulative_gpu_seconds > shared.MAX_GPU_SECONDS:
        raise RuntimeError("cumulative GPU budget exceeded")
    if cumulative_cost_usd > shared.MAX_COST_USD:
        raise RuntimeError("cumulative external cost budget exceeded")

    raw = {
        "schemaVersion": SCHEMA,
        "experimentId": shared.EXPERIMENT_ID,
        "candidateId": shared.CANDIDATE_ID,
        "stage": STAGE,
        "status": "COMPLETED",
        "startedAt": started_at,
        "completedAt": completed_at,
        "authorization": {
            "path": str(args.authorization),
            "authorizationSha256": authorization["authorizationSha256"],
            "sentinelRerunAuthorized": False,
            "developmentAuthorized": True,
            "holdoutInferenceAuthorized": False,
            "localReproductionAuthorized": False,
            "automaticRetryAuthorized": False,
        },
        "priorSentinelEvidence": {
            "path": str(args.prior_sentinel_report),
            "fileSha256": PRIOR_SENTINEL_REPORT_SHA256,
            "reportSha256": prior_report["reportSha256"],
            "officialSentinelsPassed": 4,
            "sentinelGenerationsThisRun": 0,
        },
        "checkpoint": {
            "officialCodeCommit": shared.OFFICIAL_CODE_COMMIT,
            "externalRepo": shared.EXTERNAL_REPO,
            "externalSnapshotCommit": shared.EXTERNAL_REVISION,
            "baseRepo": shared.BASE_REPO,
            "baseSnapshotCommit": shared.BASE_REVISION,
            "modelState": model_state,
            "tokenizerJson": tokenizer_file,
            "baseFiles": base_files,
        },
        "configuration": {
            "overlapWindowSeconds": shared.OVERLAP_WINDOW_SECONDS,
            "maxNewTokens": shared.MAX_NEW_TOKENS,
            "doSample": False,
            "infraSeed": shared.INFRA_SEED,
            "freePromptAdded": False,
            "quantized": False,
            "officialRuntimeContextMapping": True,
            "specialTokenIds": expected_special_ids,
        },
        "inputs": {
            "developmentPackPath": str(args.pack),
            "developmentPackFileSha256": shared.sha256_file(args.pack),
            "developmentPackSha256": pack["packSha256"],
            "holdoutTransferred": False,
        },
        "environment": {
            "provider": args.provider,
            "platform": shared.platform.platform(),
            "python": sys.version,
            "packages": shared.package_versions(
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
            "snapshotArtifactBytes": observed_snapshot_bytes,
            "priorCumulativeTransferBytesUpperBound": (
                PRIOR_CUMULATIVE_TRANSFER_BYTES
            ),
            "projectedCumulativeTransferBytes": projected_transfer_bytes,
            "maximumCumulativeDownloadBytes": MAX_CUMULATIVE_DOWNLOAD_BYTES,
            "allocationSeconds": allocation_seconds,
            "priorCumulativeGpuSeconds": PRIOR_CUMULATIVE_GPU_SECONDS,
            "cumulativeGpuSeconds": cumulative_gpu_seconds,
            "maximumGpuSeconds": shared.MAX_GPU_SECONDS,
            "hourlyUsd": args.hourly_usd,
            "estimatedCostUsd": estimated_cost_usd,
            "priorCumulativeCostUsd": PRIOR_CUMULATIVE_COST_USD,
            "cumulativeEstimatedCostUsd": cumulative_cost_usd,
            "maximumExternalCostUsd": shared.MAX_COST_USD,
        },
        "development": development,
    }
    raw["evidenceSha256"] = shared.sha256_json(raw)
    shared.atomic_json(args.output, raw)
    journal.append(
        {
            "stage": "FINAL",
            "status": raw["status"],
            "developmentUtterances": len(development),
            "evidenceSha256": raw["evidenceSha256"],
        }
    )
    print(
        json.dumps(
            {
                "status": raw["status"],
                "sentinelGenerations": 0,
                "developmentUtterances": len(development),
                "cumulativeGpuSeconds": cumulative_gpu_seconds,
                "cumulativeEstimatedCostUsd": cumulative_cost_usd,
                "projectedCumulativeTransferBytes": projected_transfer_bytes,
                "evidenceSha256": raw["evidenceSha256"],
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
