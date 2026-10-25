"""FluentLoop local text-to-speech worker (Kokoro-82M, https://huggingface.co/hexgrad/Kokoro-82M).

Started by the Rust backend as a child process. It is NOT a server: it talks only through
stdin/stdout pipes using one JSON object per line, so nothing is exposed on the network.

  python kokoro_worker.py --prepare   download the model + English voices once into $HF_HOME
  python kokoro_worker.py             serve requests:
     -> {"id": "...", "text": "...", "voice": "af_heart", "speed": 1.0, "out": "/abs/file.wav"}
     <- {"type": "ready"}                                  (once, after the model is loaded)
     <- {"id": "...", "type": "progress", "done": 1, "total": 4}
     <- {"id": "...", "type": "done", "duration": 12.3, "chunks": 4}
     <- {"id": "...", "type": "error", "message": "..."}
"""

import json
import os
import re
import sys

REPO = "hexgrad/Kokoro-82M"
SAMPLE_RATE = 24000
MAX_CHUNK_CHARS = 400

# Library code may print to stdout; keep the real stdout for the protocol only.
PROTOCOL = sys.stdout
sys.stdout = sys.stderr


def send(obj):
    PROTOCOL.write(json.dumps(obj) + "\n")
    PROTOCOL.flush()


def english_voices():
    from huggingface_hub import list_repo_files

    files = list_repo_files(REPO)
    return sorted(f[7:-3] for f in files if f.startswith("voices/") and f[7:9] in ("af", "am", "bf", "bm"))


def prepare():
    os.environ.pop("HF_HUB_OFFLINE", None)
    from huggingface_hub import hf_hub_download

    voices = english_voices()
    for name in ["config.json", "kokoro-v1_0.pth"] + [f"voices/{v}.pt" for v in voices]:
        path = hf_hub_download(REPO, name)
        print(f"cached {name} -> {path}", file=sys.stderr)
    # Builds the US and UK text front-ends now (misaki may fetch its spaCy model on first use).
    from kokoro import KPipeline

    for lang in ("a", "b"):
        KPipeline(lang_code=lang, repo_id=REPO, model=False)
    send({"type": "prepared", "voices": voices})


def split_text(text):
    """Paragraphs -> sentences -> chunks of at most MAX_CHUNK_CHARS. Returns (chunk, pause_after_seconds)."""
    out = []
    for para in [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]:
        sentences = re.split(r"(?<=[.!?…])\s+", " ".join(para.split()))
        buf = ""
        for s in sentences:
            while len(s) > MAX_CHUNK_CHARS:  # very long sentence: cut at a comma or space
                cut = max(s.rfind(", ", 0, MAX_CHUNK_CHARS), s.rfind(" ", 0, MAX_CHUNK_CHARS))
                cut = cut if cut > 0 else MAX_CHUNK_CHARS
                if buf:
                    out.append((buf, 0.15))
                    buf = ""
                out.append((s[: cut + 1].strip(), 0.1))
                s = s[cut + 1 :].strip()
            if buf and len(buf) + 1 + len(s) > MAX_CHUNK_CHARS:
                out.append((buf, 0.15))
                buf = s
            else:
                buf = f"{buf} {s}".strip()
        if buf:
            out.append((buf, 0.45))
    return out


def serve():
    import numpy as np
    import soundfile as sf
    import torch
    from kokoro import KModel, KPipeline

    torch.set_num_threads(max(1, min(8, os.cpu_count() or 4)))
    model = KModel(repo_id=REPO).eval()
    pipelines = {}

    def pipeline_for(voice):
        lang = "b" if voice.startswith("b") else "a"
        if lang not in pipelines:
            pipelines[lang] = KPipeline(lang_code=lang, repo_id=REPO, model=model)
        return pipelines[lang]

    pipeline_for("a")
    send({"type": "ready"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            text = (req.get("text") or "").strip()
            voice = req.get("voice") or "af_heart"
            speed = float(req.get("speed") or 1.0)
            out_path = req["out"]
            if not text:
                raise ValueError("Text is empty")
            if not re.fullmatch(r"[ab][fm]_[a-z]+", voice):
                raise ValueError(f"Unsupported voice: {voice}")
            pipe = pipeline_for(voice)
            chunks = split_text(text)
            pieces = []
            for i, (chunk, pause) in enumerate(chunks):
                for result in pipe(chunk, voice=voice, speed=speed, split_pattern=None):
                    if result.audio is not None:
                        pieces.append(result.audio.detach().cpu().numpy())
                pieces.append(np.zeros(int(SAMPLE_RATE * pause), dtype=np.float32))
                send({"id": req_id, "type": "progress", "done": i + 1, "total": len(chunks)})
            if not pieces:
                raise ValueError("No audio was produced")
            audio = np.concatenate(pieces)
            tmp = out_path + ".part"
            sf.write(tmp, audio, SAMPLE_RATE, subtype="PCM_16", format="WAV")
            os.replace(tmp, out_path)
            send({"id": req_id, "type": "done", "duration": round(len(audio) / SAMPLE_RATE, 3), "chunks": len(chunks)})
        except Exception as e:  # report and keep serving
            send({"id": req_id, "type": "error", "message": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    try:
        if "--prepare" in sys.argv:
            prepare()
        else:
            serve()
    except Exception as e:
        send({"type": "fatal", "message": f"{type(e).__name__}: {e}"})
        sys.exit(1)
