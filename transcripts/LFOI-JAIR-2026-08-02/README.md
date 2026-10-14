# LFOI-JAIR-2026-08-02 transcription

Local-only CPU transcription of a 57:47 reverberant speech recording (16 kHz mono MP3). No audio left the sandbox.

- `phase1/` — four Frank Schiefler ranges (32:00–33:50, 42:05–44:15, 54:05–56:05, 57:05–57:35).
  - `schiefler-quotes.md` — primary = faster-whisper large-v3 on the DeepFilterNet3-enhanced clip (as specified), disagreements marked `[A|B]`.
  - `schiefler-quotes.raw-primary.md` — same, but primary = large-v3 on the raw clip (see note below).
  - `raw-outputs/` — per-clip, per-model outputs: `<clip>.<raw|enh>.<large-v3|parakeet>.{json,srt,txt}` (JSON has word timestamps).
- `phase2/` — whole-recording outputs (SRT, `[mm:ss]` text, JSON) and model-disagreement diffs.
- `scripts/` — the exact scripts used.

Settings: faster-whisper 1.2.1, model Systran/faster-whisper-large-v3, CPU/int8, language=en, beam_size=5,
word_timestamps=True, initial_prompt with the supplied name list. Parakeet: nvidia/parakeet-tdt-0.6b-v3 via
NeMo (CPU), timestamps=True. Enhancement: DeepFilterNet 0.5.6 / DeepFilterNet3 weights, torch 2.4.1 CPU.
Audio clips are not committed (`.gitignore`).

Note: on this recording DeepFilterNet3 enhancement made both models *worse* (hallucinated or garbled passages
that no other run supports). Treat the raw-primary file as the more reliable one.
