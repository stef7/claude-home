# Phase 2 paused (14/10/2026, 12:07 UTC)

Paused at the user's request, partway through the first whole-file pass.

## Done
- DeepFilterNet3 enhancement of the whole file. It was done in 5-minute chunks, because the single-pass run ran out of memory. The output was only in the session scratchpad and will need redoing if the container is gone.
- faster-whisper large-v3 on the **raw** whole file, from 00:00 to about 13:05.
  - `full.raw.large-v3.PARTIAL.txt` has every segment produced, from the run log.
  - `full.raw.large-v3.PARTIAL.srt` is shorter, because it stopped where the file buffer last flushed.

## Not done
1. large-v3 raw, from about 13:00 to 57:47. At about 2.4x realtime on 4 CPUs, this takes about 1 h 50 min.
2. large-v3 on the enhanced whole file, which takes about 2 h 20 min.
3. Parakeet on raw and enhanced in 10-minute chunks, which takes about 30–40 min.
4. Model-disagreement diffs, using `scripts/diff_models.py`.

## To resume
- A fresh container needs reinstalling first: Python 3.11 venvs, `deepfilternet faster-whisper torch==2.4.1 torchaudio==2.4.1`, and `nemo_toolkit[asr]` in a separate venv. It also needs the models downloaded again. That takes about 15 min.
- Restart large-v3 raw from 13:00 by cutting the audio from 00:13:00 and passing `--offset 780` to `scripts/transcribe_fw.py`. Then join that output to the partial transcript, dropping any overlap.
- Given what Phase 1 showed, consider skipping step 2 (large-v3 on the enhanced file). It roughly halves the remaining time.
