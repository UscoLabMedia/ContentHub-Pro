"""Stand-in for server/py/voiceclone_worker.py used by tests: same line protocol, no models.
It "converts" by resampling the source (lower pitch, longer) so a result is audibly different."""
import json, sys, wave, struct
real = sys.stdout; sys.stdout = sys.stderr
def reply(o): real.write(json.dumps(o) + "\n"); real.flush()
reply({"ready": True})
for line in sys.stdin:
    r = json.loads(line)
    if r.get("op") == "warmup": reply({"id": r["id"], "ok": True}); continue
    try:
        w = wave.open(r["source"], "rb"); n = w.getnframes(); rate = w.getframerate(); data = struct.unpack("<%dh" % n, w.readframes(n)); w.close()
        # the reference must be readable (it is the decrypted sample)
        ref = wave.open(r["reference"], "rb"); ref.close()
        out = [data[min(n - 1, int(i * 0.85))] for i in range(int(n / 0.85))]
        o = wave.open(r["out"], "wb"); o.setnchannels(1); o.setsampwidth(2); o.setframerate(rate); o.writeframes(struct.pack("<%dh" % len(out), *out)); o.close()
        reply({"id": r["id"], "ok": True, "sample_rate": rate})
    except Exception as e:
        reply({"id": r["id"], "ok": False, "error": str(e)})
