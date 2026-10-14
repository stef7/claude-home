#!/usr/bin/env python
"""faster-whisper large-v3 (cpu/int8) -> JSON (segments+words), SRT, [mm:ss] text."""
import argparse, json, sys, time
from faster_whisper import WhisperModel

PROMPT = ("Liberal Friends of Israel, Central Shule, Frank Schiefler, Jillian Segal, ASECA, "
          "Special Envoy to Combat Antisemitism, ECAJ, NSW Jewish Board of Deputies, Dominic Perrottet, "
          "David Southwick, Tim Wilson, James Paterson, Amelia Hamer, Rachel Westaway, David Kitchen, "
          "Hastings, Prahran, Malvern, Bayswater, Jess Wilson, Ben Carroll.")

def ts(sec):
    m, s = divmod(sec, 60); h, m = divmod(int(m), 60)
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")

def mmss(sec):
    m, s = divmod(int(sec), 60)
    return f"{m:02d}:{s:02d}"

ap = argparse.ArgumentParser()
ap.add_argument("audio"); ap.add_argument("out_prefix")
ap.add_argument("--model", required=True)
ap.add_argument("--offset", type=float, default=0.0, help="seconds to add so timestamps match the full recording")
ap.add_argument("--threads", type=int, default=4)
a = ap.parse_args()

t0 = time.time()
model = WhisperModel(a.model, device="cpu", compute_type="int8", cpu_threads=a.threads)
segs, info = model.transcribe(a.audio, language="en", beam_size=5, word_timestamps=True, initial_prompt=PROMPT)
out = []
with open(a.out_prefix + ".srt", "w") as srt, open(a.out_prefix + ".txt", "w") as txt:
    for i, s in enumerate(segs, 1):
        words = [{"w": w.word, "s": round(w.start + a.offset, 3), "e": round(w.end + a.offset, 3), "p": round(w.probability, 3)} for w in (s.words or [])]
        rec = {"id": i, "start": round(s.start + a.offset, 3), "end": round(s.end + a.offset, 3), "text": s.text.strip(),
               "avg_logprob": round(s.avg_logprob, 3), "no_speech_prob": round(s.no_speech_prob, 3), "words": words}
        out.append(rec)
        srt.write(f"{i}\n{ts(rec['start'])} --> {ts(rec['end'])}\n{rec['text']}\n\n")
        txt.write(f"[{mmss(rec['start'])}] {rec['text']}\n")
        print(f"[{mmss(rec['start'])}] {rec['text']}", flush=True)
json.dump({"audio": a.audio, "model": a.model, "offset": a.offset, "duration": info.duration,
           "elapsed_s": round(time.time() - t0, 1), "segments": out}, open(a.out_prefix + ".json", "w"), indent=1)
print(f"DONE {a.audio} in {time.time()-t0:.0f}s", flush=True)
