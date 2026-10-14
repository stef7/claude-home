#!/usr/bin/env python
"""nvidia/parakeet-tdt-0.6b-v3 via NeMo (CPU) -> JSON (segments+words), SRT, [mm:ss] text."""
import argparse, json, time, sys
ap = argparse.ArgumentParser()
ap.add_argument("audio", nargs="+"); ap.add_argument("--out_prefixes", nargs="+", required=True)
ap.add_argument("--nemo", required=True)
ap.add_argument("--offsets", nargs="+", type=float, default=None)
ap.add_argument("--long", action="store_true", help="switch to local attention for long audio")
a = ap.parse_args()
import torch; torch.set_num_threads(4)
import nemo.collections.asr as nemo_asr
t0 = time.time()
model = nemo_asr.models.ASRModel.restore_from(a.nemo, map_location="cpu")
model.eval()
if a.long:
    model.change_attention_model("rel_pos_local_attn", [256, 256])
    model.change_subsampling_conv_chunking_factor(1)

def ts(sec):
    m, s = divmod(sec, 60); h, m = divmod(int(m), 60)
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")
def mmss(sec):
    m, s = divmod(int(sec), 60); return f"{m:02d}:{s:02d}"

offs = a.offsets or [0.0] * len(a.audio)
with torch.inference_mode():
    hyps = model.transcribe(a.audio, timestamps=True, batch_size=1)
for audio, prefix, off, h in zip(a.audio, a.out_prefixes, offs, hyps):
    segs = h.timestamp.get("segment", []); words = h.timestamp.get("word", [])
    out = []
    with open(prefix + ".srt", "w") as srt, open(prefix + ".txt", "w") as txt:
        for i, s in enumerate(segs, 1):
            ws = [{"w": w["word"], "s": round(w["start"] + off, 3), "e": round(w["end"] + off, 3)} for w in words if w["start"] >= s["start"] - 1e-3 and w["end"] <= s["end"] + 1e-3]
            rec = {"id": i, "start": round(s["start"] + off, 3), "end": round(s["end"] + off, 3), "text": s["segment"].strip(), "words": ws}
            out.append(rec)
            srt.write(f"{i}\n{ts(rec['start'])} --> {ts(rec['end'])}\n{rec['text']}\n\n")
            txt.write(f"[{mmss(rec['start'])}] {rec['text']}\n")
    json.dump({"audio": audio, "model": a.nemo, "offset": off, "text": h.text, "elapsed_s": round(time.time()-t0,1), "segments": out,
               "words": [{"w": w["word"], "s": round(w["start"]+off,3), "e": round(w["end"]+off,3)} for w in words]}, open(prefix + ".json", "w"), indent=1)
    print(f"DONE {audio}: {h.text[:200]}", flush=True)
