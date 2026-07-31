"""Probe reproducível do Parakeet TDT v3 ONNX no corpus PT-BR local.

Este arquivo produz apenas transcrições e tempos em JSON. O scorer canônico
continua em JavaScript, para que Whisper e Parakeet sejam comparados com a
mesma normalização de português.
"""

import argparse
import json
import time
from pathlib import Path

import numpy
import onnx_asr
import onnxruntime
import soundfile


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--manifest",
        default="eval/generated/coraa/manifest.json",
    )
    parser.add_argument(
        "--model",
        default="nemo-parakeet-tdt-0.6b-v3",
    )
    parser.add_argument("--quantization", default="int8")
    parser.add_argument("--threads", type=int, default=4)
    return parser.parse_args()


def load_audio(path):
    waveform, sample_rate = soundfile.read(
        path,
        dtype="float32",
        always_2d=False,
    )
    if waveform.ndim > 1:
        waveform = waveform.mean(axis=1)
    return numpy.asarray(waveform, dtype=numpy.float32), sample_rate


def main():
    args = parse_args()
    if args.threads < 1:
        raise ValueError("--threads precisa ser positivo")

    manifest_path = Path(args.manifest).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    session_options = onnxruntime.SessionOptions()
    session_options.intra_op_num_threads = args.threads
    session_options.inter_op_num_threads = 1
    session_options.execution_mode = (
        onnxruntime.ExecutionMode.ORT_SEQUENTIAL
    )
    session_options.graph_optimization_level = (
        onnxruntime.GraphOptimizationLevel.ORT_ENABLE_ALL
    )

    load_started = time.perf_counter()
    model = onnx_asr.load_model(
        args.model,
        quantization=args.quantization,
        sess_options=session_options,
        providers=["CPUExecutionProvider"],
    )
    model_load_ms = round((time.perf_counter() - load_started) * 1000)

    warmup = numpy.zeros(8_000, dtype=numpy.float32)
    warmup_started = time.perf_counter()
    model.recognize(warmup, sample_rate=16_000)
    warmup_ms = round((time.perf_counter() - warmup_started) * 1000)

    results = []
    for item in manifest["cases"]:
        audio_path = Path(item["audio"]).resolve()
        waveform, sample_rate = load_audio(audio_path)
        batch = waveform[numpy.newaxis, :]
        lengths = numpy.asarray([len(waveform)], dtype=numpy.int64)
        batch, lengths = model.resampler(batch, lengths, sample_rate)
        started = time.perf_counter()
        result = next(
            model.asr.recognize_batch(
                batch,
                lengths,
                need_logprobs=True,
            )
        )
        text = result.text.strip()
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        average_logprob = (
            sum(result.logprobs) / len(result.logprobs)
            if result.logprobs
            else None
        )
        results.append(
            {
                "id": item["id"],
                "file": str(audio_path),
                "expected": item["expected"],
                "category": item.get("category", "unspecified"),
                "durationMs": round(
                    len(waveform) / sample_rate * 1000
                ),
                "elapsedMs": elapsed_ms,
                "text": text,
                "averageLogprob": average_logprob,
                "tokens": result.tokens,
            }
        )

    print(
        json.dumps(
            {
                "schemaVersion": 1,
                "engine": "onnx-asr",
                "model": args.model,
                "quantization": args.quantization,
                "threads": args.threads,
                "modelLoadMs": model_load_ms,
                "warmupMs": warmup_ms,
                "manifest": str(manifest_path),
                "results": results,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
