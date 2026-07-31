import argparse
import base64
import json
import sys
import threading
import time
from collections import OrderedDict


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--engine",
        choices=("whisper", "parakeet"),
        default="whisper",
    )
    parser.add_argument("--model", default="base")
    parser.add_argument("--cache-dir")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--warmup-ms", type=int, default=500)
    parser.add_argument("--fake", action="store_true")
    parser.add_argument("--fake-delay-ms", type=int, default=0)
    return parser.parse_args()


class Coordinator:
    def __init__(self):
        self.condition = threading.Condition()
        self.pending = OrderedDict()
        self.cancelled = set()
        self.active = set()
        self.closed = False

    def submit(self, command):
        with self.condition:
            session_id = command["sessionId"]
            previous = self.pending.pop(session_id, None)
            if previous is not None:
                emit(
                    {
                        "type": "superseded",
                        "requestId": previous["requestId"],
                        "code": "asr_superseded",
                        "message": "snapshot substituído por áudio mais recente",
                    }
                )
            self.pending[session_id] = command
            self.condition.notify()

    def cancel(self, request_id):
        with self.condition:
            removed = False
            for session_id, command in list(self.pending.items()):
                if command["requestId"] == request_id:
                    self.pending.pop(session_id)
                    removed = True
            if not removed and request_id in self.active:
                self.cancelled.add(request_id)
            self.condition.notify()

    def close(self):
        with self.condition:
            self.closed = True
            self.pending.clear()
            self.condition.notify_all()

    def next(self):
        with self.condition:
            while not self.pending and not self.closed:
                self.condition.wait()
            if self.closed:
                return None
            final_session = next(
                (
                    session_id
                    for session_id, command in self.pending.items()
                    if command.get("mode") == "final"
                ),
                None,
            )
            if final_session is None:
                _, command = self.pending.popitem(last=False)
            else:
                command = self.pending.pop(final_session)
            self.active.add(command["requestId"])
            return command

    def is_cancelled(self, request_id):
        with self.condition:
            return request_id in self.cancelled

    def complete(self, request_id):
        with self.condition:
            self.active.discard(request_id)
            self.cancelled.discard(request_id)


OUTPUT_LOCK = threading.Lock()


def emit(message):
    with OUTPUT_LOCK:
        print(json.dumps(message, ensure_ascii=False), flush=True)


def decode_pcm(command, numpy):
    if command.get("sampleRate") != 16000:
        raise ValueError("worker requer PCM16LE mono em 16 kHz")
    raw = base64.b64decode(command["pcmBase64"], validate=True)
    if len(raw) % 2 != 0:
        raise ValueError("PCM16LE desalinhado")
    return numpy.frombuffer(raw, dtype="<i2").astype(numpy.float32) / 32768.0


def create_transcriber(args):
    if args.fake:
        def fake_transcribe(command):
            if args.fake_delay_ms:
                time.sleep(args.fake_delay_ms / 1000)
            sample_count = len(
                base64.b64decode(command["pcmBase64"], validate=True)
            ) // 2
            duration_ms = round(sample_count / command["sampleRate"] * 1000)
            return {
                "engine": "fake",
                "text": f"fala de teste {duration_ms}",
                "elapsedMs": args.fake_delay_ms,
                "language": command.get("language", "pt"),
                "languageProbability": 1,
                "segments": [],
            }

        return fake_transcribe, {
            "model": "fake",
            "modelLoadMs": 0,
            "warmupMs": 0,
        }

    if args.engine == "parakeet":
        return create_parakeet_transcriber(args)

    return create_whisper_transcriber(args)


def create_parakeet_transcriber(args):
    import numpy
    import onnx_asr
    import onnxruntime

    if args.device != "cpu":
        raise ValueError("Parakeet ONNX desta vertical requer --device cpu")

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
        quantization=args.compute_type,
        sess_options=session_options,
        providers=["CPUExecutionProvider"],
    )
    model_load_ms = round((time.perf_counter() - model_started) * 1000)

    warmup_started = time.perf_counter()
    if args.warmup_ms > 0:
        silence = numpy.zeros(
            round(16000 * args.warmup_ms / 1000),
            dtype=numpy.float32,
        )
        model.recognize(silence, sample_rate=16_000)
    warmup_ms = round((time.perf_counter() - warmup_started) * 1000)

    def transcribe(command):
        audio = decode_pcm(command, numpy)
        started = time.perf_counter()
        text = model.recognize(audio, sample_rate=16_000)
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        return {
            "engine": "parakeet",
            "text": str(text).strip(),
            "elapsedMs": elapsed_ms,
            "language": command.get("language", "pt"),
            "languageProbability": None,
            "segments": [],
        }

    return transcribe, {
        "engine": "parakeet",
        "model": args.model,
        "modelLoadMs": model_load_ms,
        "warmupMs": warmup_ms,
    }


def create_whisper_transcriber(args):
    import numpy
    from faster_whisper import WhisperModel

    model_started = time.perf_counter()
    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
        cpu_threads=args.threads,
        num_workers=args.workers,
        download_root=args.cache_dir,
    )
    model_load_ms = round((time.perf_counter() - model_started) * 1000)

    warmup_started = time.perf_counter()
    if args.warmup_ms > 0:
        silence = numpy.zeros(
            round(16000 * args.warmup_ms / 1000),
            dtype=numpy.float32,
        )
        segments, _ = model.transcribe(
            silence,
            language="pt",
            beam_size=1,
            best_of=1,
            temperature=0.0,
            condition_on_previous_text=False,
            without_timestamps=True,
            vad_filter=False,
        )
        list(segments)
    warmup_ms = round((time.perf_counter() - warmup_started) * 1000)

    def transcribe(command):
        audio = decode_pcm(command, numpy)
        partial = command.get("mode") == "partial"
        started = time.perf_counter()
        segments, info = model.transcribe(
            audio,
            language=command.get("language", "pt"),
            beam_size=1,
            best_of=1,
            temperature=0.0,
            condition_on_previous_text=False,
            without_timestamps=partial,
            word_timestamps=False,
            vad_filter=False,
        )
        realized = list(segments)
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        return {
            "engine": "whisper",
            "text": "".join(segment.text for segment in realized).strip(),
            "elapsedMs": elapsed_ms,
            "language": info.language,
            "languageProbability": info.language_probability,
            "segments": [
                {
                    "start": segment.start,
                    "end": segment.end,
                    "text": segment.text.strip(),
                }
                for segment in realized
            ],
        }

    return transcribe, {
        "engine": "whisper",
        "model": args.model,
        "modelLoadMs": model_load_ms,
        "warmupMs": warmup_ms,
    }


def run_inference(coordinator, transcribe):
    while True:
        command = coordinator.next()
        if command is None:
            return
        request_id = command["requestId"]
        try:
            if coordinator.is_cancelled(request_id):
                continue
            result = transcribe(command)
            if coordinator.is_cancelled(request_id):
                continue
            emit(
                {
                    "type": "result",
                    "requestId": request_id,
                    "sessionId": command["sessionId"],
                    "generation": command["generation"],
                    "mode": command["mode"],
                    **result,
                }
            )
        except Exception as error:
            if not coordinator.is_cancelled(request_id):
                emit(
                    {
                        "type": "error",
                        "requestId": request_id,
                        "code": "asr_inference_error",
                        "message": str(error),
                    }
                )
        finally:
            coordinator.complete(request_id)


def main():
    args = parse_args()
    if args.threads < 1 or args.workers < 1:
        raise ValueError("threads e workers precisam ser positivos")
    transcribe, runtime = create_transcriber(args)
    coordinator = Coordinator()
    inference_threads = [
        threading.Thread(
            target=run_inference,
            args=(coordinator, transcribe),
            daemon=True,
        )
        for _ in range(args.workers)
    ]
    for inference in inference_threads:
        inference.start()
    emit(
        {
            "type": "ready",
            "device": args.device,
            "computeType": args.compute_type,
            "workers": args.workers,
            "threadsPerWorker": args.threads,
            **runtime,
        }
    )

    for raw_line in sys.stdin:
        try:
            command = json.loads(raw_line)
            command_type = command.get("type")
            if command_type == "transcribe":
                coordinator.submit(command)
            elif command_type == "cancel":
                coordinator.cancel(command["requestId"])
            elif command_type == "close":
                coordinator.close()
                break
            else:
                emit(
                    {
                        "type": "protocol-error",
                        "requestId": command.get("requestId"),
                        "code": "asr_protocol_error",
                        "message": f"comando desconhecido: {command_type}",
                    }
                )
        except Exception as error:
            emit(
                {
                    "type": "protocol-error",
                    "requestId": None,
                    "code": "asr_protocol_error",
                    "message": str(error),
                }
            )

    coordinator.close()
    for inference in inference_threads:
        inference.join()


if __name__ == "__main__":
    main()
