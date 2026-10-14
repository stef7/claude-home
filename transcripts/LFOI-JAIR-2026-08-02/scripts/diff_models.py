#!/usr/bin/env python
"""Word-level diff of two transcripts (JSON from transcribe_*.py). Lists disagreeing spans with timestamps."""
import json, re, sys, difflib
def norm(w):
    w = w.lower().replace("’", "'"); return re.sub(r"[^a-z0-9']+", "", w)
def words(path):
    d = json.load(open(path)); ws = d.get("words") or [w for s in d["segments"] for w in s["words"]]
    return [w for w in ws if w["w"].strip()]
def mmss(sec): m, s = divmod(int(sec), 60); return f"{m:02d}:{s:02d}"
A, B, out, la, lb = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
a, b = words(A), words(B)
sm = difflib.SequenceMatcher(a=[norm(w["w"]) for w in a], b=[norm(w["w"]) for w in b], autojunk=False)
rows = []; n_eq = 0
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag == "equal": n_eq += i2 - i1; continue
    t = a[i1]["s"] if i1 < len(a) else (a[i1-1]["e"] if a else 0)
    ctx_a = " ".join(w["w"].strip() for w in a[max(0,i1-3):i1])
    rows.append((t, tag, " ".join(w["w"].strip() for w in a[i1:i2]) or "—", " ".join(w["w"].strip() for w in b[j1:j2]) or "—", ctx_a))
with open(out, "w") as f:
    f.write(f"# Disagreements: {la} vs {lb}\n\n{la}: {len(a)} words; {lb}: {len(b)} words; {n_eq} words identical after case/punctuation normalisation; {len(rows)} differing spans.\n\n")
    f.write(f"| time | preceding context | {la} | {lb} |\n|---|---|---|---|\n")
    for t, tag, x, y, ctx in rows:
        f.write(f"| {mmss(t)} | …{ctx} | {x} | {y} |\n")
print("wrote", out, len(rows), "diffs")
