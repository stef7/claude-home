#!/usr/bin/env python
"""Build schiefler-quotes.md: primary = large-v3 enhanced; disagreements vs other runs marked [A|B]."""
import json, re, sys, os, difflib, argparse

def norm(w):
    w = w.lower().replace("’", "'")
    w = re.sub(r"[^a-z0-9']+", "", w)
    return w

def load_words(path):
    if not os.path.exists(path):
        return None
    d = json.load(open(path))
    if "words" in d and d["words"]:
        ws = d["words"]
    else:
        ws = [w for s in d["segments"] for w in s["words"]]
    return [{"w": w["w"].strip(), "s": w["s"], "e": w["e"]} for w in ws if w["w"].strip()]

def align(prim, alt):
    """Return dict: primary index -> list of alt readings (span-grouped)."""
    a = [norm(w["w"]) for w in prim]; b = [norm(w["w"]) for w in alt]
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    diffs = []  # (i1, i2, alt_text)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        alt_text = " ".join(w["w"] for w in alt[j1:j2]).strip()
        diffs.append((i1, i2, alt_text if alt_text else "—"))
    return diffs

def mmss(sec):
    m, s = divmod(int(sec), 60); return f"{m:02d}:{s:02d}"

ap = argparse.ArgumentParser()
ap.add_argument("--outdir", required=True); ap.add_argument("--md", required=True)
ap.add_argument("--primary", default="enh", choices=["enh","raw"])
ap.add_argument("--ranges", nargs="+", required=True, help="name:label e.g. seg1_32m00-33m50:32:00–33:50")
a = ap.parse_args()

if a.primary == "enh":
    SOURCES = [("large-v3 raw", "raw.large-v3"), ("Parakeet enhanced", "enh.parakeet"), ("Parakeet raw", "raw.parakeet")]
    PRIM_DESC = "faster-whisper **large-v3** (CPU/int8, beam 5) on the **DeepFilterNet3-enhanced** clip"
else:
    SOURCES = [("large-v3 enhanced", "enh.large-v3"), ("Parakeet raw", "raw.parakeet"), ("Parakeet enhanced", "enh.parakeet")]
    PRIM_DESC = "faster-whisper **large-v3** (CPU/int8, beam 5) on the **raw (un-enhanced)** clip"
md = ["# Frank Schiefler segments — LFOI-JAIR-2026-08-02", "",
      "Primary text: " + PRIM_DESC + ".",
      "Timestamps are [mm:ss] into the full recording, taken from the first word of each sentence.", "",
      "Where another run disagrees, the word(s) are marked `[A|B]`: **A** is always the primary (large-v3 enhanced) reading; "
      "**B** (and C, D) are the distinct alternative readings from the other runs, in the order " + ", ".join(l for l, _ in SOURCES) + " "
      "(see the per-range table for which run said what). `—` means that run had nothing at that point. "
      "Differences in case and punctuation only are ignored.", ""]
summary = []
for spec in a.ranges:
    name, label = spec.split(":", 1)
    prim = load_words(os.path.join(a.outdir, f"{name}.{a.primary}.large-v3.json"))
    if prim is None:
        md += [f"## {label}", "", "_primary transcript missing_", ""]; continue
    alts = {}
    for lbl, suf in SOURCES:
        ws = load_words(os.path.join(a.outdir, f"{name}.{suf}.json"))
        if ws is not None:
            alts[lbl] = align(prim, ws)
    # per-token annotation: start index -> {end, {label: alt}}
    marks = {}
    for lbl, diffs in alts.items():
        for i1, i2, alt_text in diffs:
            key = i1
            m = marks.setdefault(key, {"end": i2, "alts": {}})
            m["end"] = max(m["end"], i2)
            m["alts"][lbl] = alt_text
    # render sentences
    lines = []; st = {"cur": [], "start": None}; i = 0; n = len(prim); n_marks = 0
    def flush():
        if st["cur"]:
            lines.append(f"[{mmss(st['start'])}] " + " ".join(st["cur"]).strip()); st["cur"] = []; st["start"] = None
    table = []
    while i < n:
        if st["start"] is None: st["start"] = prim[i]["s"]
        if i in marks:
            end = max(marks[i]["end"], i + 1)
            # merge overlapping marks inside span
            j = i
            while j < end:
                if j in marks and j != i:
                    for lbl, t in marks[j]["alts"].items():
                        marks[i]["alts"].setdefault(lbl, t)
                    end = max(end, marks[j]["end"])
                j += 1
            ptxt = " ".join(w["w"] for w in prim[i:end]) if end > i else "—"
            distinct = []
            for lbl, _ in SOURCES:
                if lbl in marks[i]["alts"]:
                    t = marks[i]["alts"][lbl]
                    if norm(t) != norm(ptxt) and t not in distinct and norm(t) not in [norm(x) for x in distinct]:
                        distinct.append(t)
            if distinct:
                st["cur"].append("[" + ptxt + "|" + "|".join(distinct) + "]"); n_marks += 1
                table.append((mmss(prim[i]["s"]), ptxt, {lbl: marks[i]["alts"].get(lbl, "(same)") for lbl, _ in SOURCES if lbl in alts}))
            else:
                st["cur"].append(ptxt)
            # deletion-only span (end == i): still need to emit token i
            if end == i:
                st["cur"].append(prim[i]["w"]); end = i + 1
            last = prim[end - 1]["w"]; i = end
        else:
            st["cur"].append(prim[i]["w"]); last = prim[i]["w"]; i += 1
        if re.search(r"[.!?]['\")]*$", last):
            flush()
    flush()
    md += [f"## {label}", ""] + lines + [""]
    if table:
        md += ["<details><summary>Disagreement detail (" + str(len(table)) + ")</summary>", "",
               "| time | primary | " + " | ".join(l for l, _ in SOURCES if l in alts) + " |",
               "|---|---|" + "|".join("---" for l, _ in SOURCES if l in alts) + "|"]
        for t, p, d in table:
            md.append(f"| {t} | {p} | " + " | ".join(d.get(l, "") for l, _ in SOURCES if l in alts) + " |")
        md += ["", "</details>", ""]
    summary.append((label, len(prim), n_marks, list(alts.keys())))
md += ["## Run summary", "", "| range | primary words | marked spans | compared against |", "|---|---|---|---|"]
for label, nw, nm, srcs in summary:
    md.append(f"| {label} | {nw} | {nm} | {', '.join(srcs)} |")
open(a.md, "w").write("\n".join(md) + "\n")
print("wrote", a.md)
