import argparse
import json
import time
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", nargs="+")
    parser.add_argument(
        "--engine",
        choices=("whisper", "parakeet"),
        default="whisper",
    )
    parser.add_argument("--model", default="base")
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--language", default="pt")
    parser.add_argument("--threads", type=int, default=4)
    return parser.parse_args()


args = parse_args()


def transcribe_whisper():
    from faster_whisper import WhisperModel

    model_started = time.perf_counter()
    model = WhisperModel(
        args.model,
        device="cpu",
        compute_type="int8",
        cpu_threads=args.threads,
        download_root=args.cache_dir,
    )
    model_load_ms = round((time.perf_counter() - model_started) * 1000)
    results = []

    for raw_path in args.audio:
        path = Path(raw_path)
        started = time.perf_counter()
        segments, info = model.transcribe(
            str(path),
            language=args.language,
            beam_size=1,
            best_of=1,
            temperature=0.0,
            condition_on_previous_text=False,
            vad_filter=True,
            word_timestamps=True,
        )
        realized_segments = list(segments)
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        results.append(
            {
                "file": str(path),
                "text": "".join(
                    segment.text for segment in realized_segments
                ).strip(),
                "elapsedMs": elapsed_ms,
                "language": info.language,
                "languageProbability": info.language_probability,
                "durationSeconds": info.duration,
                "segments": [
                    {
                        "start": segment.start,
                        "end": segment.end,
                        "text": segment.text.strip(),
                    }
                    for segment in realized_segments
                ],
            }
        )

    return model_load_ms, results, {
        "beamSize": 1,
        "bestOf": 1,
        "temperature": 0.0,
        "conditionOnPreviousText": False,
        "vadFilter": True,
    }


def transcribe_parakeet():
    import onnx_asr
    import onnxruntime
    import soundfile

    session_options = onnxruntime.SessionOptions()
    session_options.intra_op_num_threads = args.threads
    session_options.inter_op_num_threads = 1
    session_options.execution_mode = (
        onnxruntime.ExecutionMode.ORT_SEQUENTIAL
    )
    session_options.graph_optimization_level = (
        onnxruntime.GraphOptimizationLevel.ORT_ENABLE_ALL
    )

    model_started = time.perf_counter()
    model = onnx_asr.load_model(
        args.model,
        quantization="int8",
        sess_options=session_options,
        providers=["CPUExecutionProvider"],
    )
    model_load_ms = round((time.perf_counter() - model_started) * 1000)
    results = []
    for raw_path in args.audio:
        path = Path(raw_path)
        waveform, sample_rate = soundfile.read(
            path,
            dtype="float32",
            always_2d=False,
        )
        if waveform.ndim > 1:
            waveform = waveform.mean(axis=1)
        started = time.perf_counter()
        text = model.recognize(waveform, sample_rate=sample_rate)
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        results.append(
            {
                "file": str(path),
                "text": str(text).strip(),
                "elapsedMs": elapsed_ms,
                "language": args.language,
                "languageProbability": None,
                "durationSeconds": None,
                "segments": [],
            }
        )

    return model_load_ms, results, {
        "transducer": "tdt",
        "quantization": "int8",
        "languageSelection": "automatic",
    }


if args.engine == "parakeet":
    model_load_ms, results, decoding = transcribe_parakeet()
else:
    model_load_ms, results, decoding = transcribe_whisper()

print(
    json.dumps(
        {
            "model": args.model,
            "engine": args.engine,
            "device": "cpu",
            "computeType": "int8",
            "decoding": decoding,
            "modelLoadMs": model_load_ms,
            "results": results,
        },
        ensure_ascii=False,
    )
)
