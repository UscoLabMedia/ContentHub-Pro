"""Voice conversion worker for ContentHub Pro (voiceclonnx, Apache 2.0; OpenVoice v2 tone-color converter, MIT).
Takes speech made by a base voice and gives it the timbre of a reference sample. Speech to speech: the words,
timing and intonation come from the base voice. Everything runs locally (CPU, onnxruntime); the only network use
is the one-time download of the ONNX models. One JSON request per line on stdin, one JSON answer per line."""
import inspect
import json
import sys

real_out = sys.stdout
sys.stdout = sys.stderr  # libraries may print: keep stdout clean for the protocol


def reply(obj):
    real_out.write(json.dumps(obj) + "\n")
    real_out.flush()


cloners = {}


def get_cloner(engine):
    if engine not in cloners:
        from voiceclonnx import VoiceCloner
        from voiceclonnx.engines.base import get_engine

        kwargs = {}
        if "quantized" in inspect.signature(get_engine(engine).adapter_class.__init__).parameters:
            kwargs["quantized"] = True  # INT8 models: ~3x smaller and faster on CPU
        cloners[engine] = VoiceCloner(engine=engine, **kwargs)
    return cloners[engine]


def main():
    reply({"ready": True})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = {}
        try:
            req = json.loads(line)
            cloner = get_cloner(req["engine"])
            if req.get("op") == "warmup":
                ensure = getattr(cloner._adapter, "_ensure_models", None)
                if ensure:
                    ensure()
                reply({"id": req.get("id"), "ok": True})
                continue
            cloner.clone_voice(req["source"], req["reference"], req["out"])
            reply({"id": req.get("id"), "ok": True, "sample_rate": cloner.sample_rate})
        except Exception as e:  # report the problem, keep serving
            reply({"id": req.get("id"), "ok": False, "error": (type(e).__name__ + ": " + str(e))[:400]})


if __name__ == "__main__":
    main()
