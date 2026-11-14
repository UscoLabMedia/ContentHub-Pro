"""Kokoro (Apache 2.0 model, kokoro-onnx) speech worker for ContentHub Pro.
Reads one JSON request per line on stdin and answers with one JSON line on stdout.
Everything runs locally; nothing is sent anywhere."""
import json
import sys

real_out = sys.stdout
sys.stdout = sys.stderr  # libraries may print: keep stdout clean for the protocol


def reply(obj):
    real_out.write(json.dumps(obj) + "\n")
    real_out.flush()


def main():
    model, voices = sys.argv[1], sys.argv[2]
    import soundfile as sf
    from kokoro_onnx import Kokoro

    k = Kokoro(model, voices)
    reply({"ready": True, "voices": [v for v in k.get_voices() if v[:2] in ("ef", "em")]})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = {}
        try:
            req = json.loads(line)
            samples, rate = k.create(req["text"], voice=req["voice"], speed=float(req.get("speed", 1.0)), lang=req.get("lang", "es"))
            sf.write(req["out"], samples, rate, subtype="PCM_16")
            reply({"id": req.get("id"), "ok": True, "seconds": len(samples) / rate})
        except Exception as e:  # report the problem, keep serving
            reply({"id": req.get("id"), "ok": False, "error": str(e)[:300]})


if __name__ == "__main__":
    main()
