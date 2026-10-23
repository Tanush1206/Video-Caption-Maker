"""
Language quality report: speech recognition and translation for every language we offer.

Measures, never changes anything. Data: Google FLEURS, test split (CC-BY 4.0),
pinned to one commit, only what is needed (each language's archive is
streamed and read until enough utterances are in). It goes into
test-assets/fleurs/ (gitignored); `clean` deletes it.

Runs on the host with the standard library, plus ffmpeg on PATH. Models run in
the dev stack's worker (`docker compose exec`), through the app's own code;
the pipeline part uploads to a running dev stack.

    python scripts/language_eval.py fetch                  # ~70 utterances a language
    python scripts/language_eval.py asr                    # WER/CER, 50 utterances, GPU + CPU models
    python scripts/language_eval.py pipeline --base http://localhost:3001
    python scripts/language_eval.py mt                     # chrF, en and hi into every caption language
    python scripts/language_eval.py report > report.md
    python scripts/language_eval.py clean

`--langs en,hi` limits any step, `--models large-v3-cuda` the asr runs. Results are JSON in test-assets/fleurs/results/,
so a step can be re-run alone after a model change. Delete the pipeline's
videos: it does so itself, and prints their ids.
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tarfile
import time
import unicodedata
import urllib.request
import uuid
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "test-assets" / "fleurs"
RESULTS = DATA / "results"
FLEURS = "https://huggingface.co/datasets/google/fleurs/resolve/70bb2e84b976b7e960aa89f1c648e09c59f894dd/data"

# Our language codes -> FLEURS configs: the thirteen offered until v1.0.10.
# Tamil, Marathi, Bengali and Malayalam were taken out in v1.0.11 on these
# results and stay here, so a better model for them is measured the same way.
LANGS = {
    "en": "en_us", "hi": "hi_in", "mr": "mr_in", "bn": "bn_in", "ta": "ta_in", "ml": "ml_in",
    "es": "es_419", "pt": "pt_br", "it": "it_it", "ru": "ru_ru", "fr": "fr_fr", "de": "de_de", "nl": "nl_nl",
}
ASR_UTTERANCES = 50
FETCH_UTTERANCES = 70          # the 50, plus enough for ~3 minutes joined
JOINED_SECONDS = 180
GAP_SECONDS = 0.6
MT_SENTENCES = 100

# (model, device, which languages). Apex is the Hinglish model; FLEURS Hindi
# is formal read Hindi, so its Roman output is scored after IndicXlit puts it
# back into Devanagari, which adds errors of its own.
ASR_RUNS = [
    ("large-v3", "cuda", None),
    ("hinglish", "cuda", ["hi"]),
    ("large-v3-turbo", "cpu", None),
    ("small", "cpu", None),
]

# Good / Usable / Weak.
WER_GOOD, WER_USABLE = 0.15, 0.35          # CER for ta, ml (one word is many)
CER_GOOD, CER_USABLE = 0.08, 0.20
CHRF_GOOD, CHRF_USABLE = 55.0, 40.0
CER_LANGS = {"ta", "ml"}


def langs_arg(value: str | None) -> list[str]:
    return [code for code in (value.split(",") if value else LANGS) if code in LANGS]


def compose(*args: str, input_text: str | None = None, check: bool = True) -> str:
    return subprocess.run(
        ["docker", "compose", *args], cwd=ROOT, input=input_text, capture_output=True,
        text=True, encoding="utf-8", check=check,
    ).stdout


# ── fetch ─────────────────────────────────────────────────────────────────


def rows(lang: str) -> list[list[str]]:
    path = DATA / lang / "test.tsv"
    return [line.split("\t") for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def fetch(codes: list[str]) -> None:
    for code in codes:
        target = DATA / code
        (target / "audio").mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(f"{FLEURS}/{LANGS[code]}/test.tsv", timeout=120) as r:
            (target / "test.tsv").write_bytes(r.read())
        by_file = {row[1]: row for row in rows(code)}
        taken: dict[str, str] = {}
        downloaded = 0
        with urllib.request.urlopen(f"{FLEURS}/{LANGS[code]}/audio/test.tar.gz", timeout=120) as r:
            counting = _Counting(r)
            with tarfile.open(fileobj=counting, mode="r|gz") as tar:
                for member in tar:
                    name = Path(member.name).name
                    row = by_file.get(name)
                    # One recording a sentence: distinct sentences, not one read twice.
                    if row is None or row[0] in taken or not member.isfile():
                        continue
                    (target / "audio" / name).write_bytes(tar.extractfile(member).read())
                    taken[row[0]] = name
                    if len(taken) >= FETCH_UTTERANCES:
                        break
            downloaded = counting.read_bytes
        (target / "chosen.json").write_text(json.dumps(taken, indent=0), encoding="utf-8")
        print(f"{code}: {len(taken)} utterances, {downloaded / 1e6:.0f} MB read", flush=True)


class _Counting:
    def __init__(self, raw):
        self.raw, self.read_bytes = raw, 0

    def read(self, size=-1):
        data = self.raw.read(size)
        self.read_bytes += len(data)
        return data


def chosen(code: str) -> list[dict]:
    """The fetched utterances, in id order: id, file, raw and normalised text, seconds."""
    picked = json.loads((DATA / code / "chosen.json").read_text(encoding="utf-8"))
    by_file = {row[1]: row for row in rows(code)}
    out = []
    for sid, name in sorted(picked.items(), key=lambda kv: int(kv[0])):
        row = by_file[name]
        out.append({"id": sid, "file": name, "raw": row[2], "norm": row[3], "seconds": int(row[5]) / 16000})
    return out


# ── asr ───────────────────────────────────────────────────────────────────

WORKER_ASR = r'''
import json, sys, time
from pathlib import Path
from app.services import hardware, hinglish, transcription as t

model, device, langs = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
compute = "float16" if device == "cuda" else "int8"
t.unload_model()
t.load_model(hardware.WhisperProfile(model=model, device=device, compute_type=compute, source="eval"))
out = {}
for lang in langs:
    items = json.load(open(f"/tmp/fleurs/{lang}/items.json", encoding="utf-8"))
    start = time.time()
    res = []
    for item in items:
        audio = Path(f"/tmp/fleurs/{lang}/audio/{item['file']}")
        heard = None
        if model == "large-v3":
            heard, _ = t.detect_language(audio)
        segments, _ = t.transcribe(audio, language=hinglish.APEX_LANGUAGE if model == "hinglish" else lang)
        text = " ".join(s.text.strip() for s in segments)
        res.append({"id": item["id"], "text": text, "heard": heard})
    if model == "hinglish":
        for r, d in zip(res, hinglish.to_devanagari([r["text"] for r in res])):
            r["roman"], r["text"] = r["text"], d
    seconds = sum(i["seconds"] for i in items)
    out[lang] = {"items": res, "audio_s": round(seconds, 1), "took_s": round(time.time() - start, 1)}
    print(f"{model}/{device} {lang}: {len(res)} in {out[lang]['took_s']} s", file=sys.stderr, flush=True)
print(json.dumps(out, ensure_ascii=False))
'''


def to_worker(codes: list[str]) -> None:
    compose("exec", "-T", "worker", "rm", "-rf", "/tmp/fleurs")
    compose("exec", "-T", "worker", "mkdir", "-p", "/tmp/fleurs")
    for code in codes:
        items = chosen(code)[:ASR_UTTERANCES]
        (DATA / code / "items.json").write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
        compose("cp", str(DATA / code), "worker:/tmp/fleurs/")


def asr(codes: list[str], redo: bool = False, models: list[str] | None = None) -> None:
    to_worker(codes)
    RESULTS.mkdir(parents=True, exist_ok=True)
    for model, device, only in ASR_RUNS:
        if models and f"{model}-{device}" not in models:
            continue
        path = RESULTS / f"asr-{model}-{device}.json"
        done = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        # One language a call, saved as it finishes: a CPU pass takes hours,
        # and a re-run picks up where the last one stopped (`--redo` to repeat).
        for code in codes:
            if (only is not None and code not in only) or (code in done and not redo):
                continue
            started = time.time()
            result = subprocess.run(
                ["docker", "compose", "exec", "-T", "-w", "/app", "-e", "PYTHONPATH=/app", "worker",
                 "python", "-", model, device, code],
                cwd=ROOT, input=WORKER_ASR, capture_output=True, text=True, encoding="utf-8",
            )
            if result.returncode != 0:
                print(result.stderr[-2000:], file=sys.stderr)
                raise SystemExit(f"{model}/{device} {code} failed")
            done.update(json.loads(result.stdout.strip().splitlines()[-1]))
            path.write_text(json.dumps(done, ensure_ascii=False, indent=0), encoding="utf-8")
            print(f"{model} on {device}: {code} in {time.time() - started:.0f} s", flush=True)


def normalise(text: str) -> list[str]:
    """Lower case, NFC, no punctuation: the same for reference and output. Numbers aren't spelled out."""
    text = unicodedata.normalize("NFC", text).casefold()
    text = "".join(" " if unicodedata.category(ch).startswith("P") else ch for ch in text)
    return text.split()


def edits(ref: list, hyp: list) -> int:
    previous = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        current = [i]
        for j, h in enumerate(hyp, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (r != h)))
        previous = current
    return previous[-1]


def score_asr(code: str, result: dict) -> dict:
    refs = {i["id"]: i for i in chosen(code)}
    w_err = w_tot = c_err = c_tot = 0
    for item in result["items"]:
        ref, hyp = normalise(refs[item["id"]]["norm"]), normalise(item["text"])
        w_err += edits(ref, hyp)
        w_tot += len(ref)
        c_err += edits(list("".join(ref)), list("".join(hyp)))
        c_tot += len("".join(ref))
    heard = [i["heard"] for i in result["items"] if i.get("heard")]
    return {
        "wer": w_err / max(1, w_tot), "cer": c_err / max(1, c_tot),
        "detected": (sum(h == code for h in heard) / len(heard)) if heard else None,
        "rtf": result["took_s"] / max(1, result["audio_s"]),
    }


# ── pipeline ──────────────────────────────────────────────────────────────

WORKER_ONSETS = r'''
import json, sys
from pathlib import Path
from app.services import transcription as t
levels = t.vocal_envelope(Path(sys.argv[1]), 0.02)
print(json.dumps(levels))
'''


def joined(code: str) -> tuple[Path, list[float]]:
    """About JOINED_SECONDS of the language's utterances, silence between, as an MP4 with a black frame."""
    items, total, used = chosen(code), 0.0, []
    for item in items:
        used.append(item)
        total += item["seconds"] + GAP_SECONDS
        if total >= JOINED_SECONDS:
            break
    work = DATA / code / "joined"
    work.mkdir(exist_ok=True)
    listing, starts, at = [], [], 0.0
    silence = work / "gap.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
                    "-t", str(GAP_SECONDS), str(silence)], check=True)
    for item in used:
        listing += [f"file '{(DATA / code / 'audio' / item['file']).as_posix()}'", f"file '{silence.as_posix()}'"]
        starts.append(round(at, 3))
        at += item["seconds"] + GAP_SECONDS
    (work / "list.txt").write_text("\n".join(listing), encoding="utf-8")
    wav, mp4 = work / "joined.wav", work / f"fleurs-{code}.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(work / "list.txt"),
                    "-ar", "16000", "-ac", "1", str(wav)], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=10",
                    "-i", str(wav), "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(mp4)],
                   check=True)
    return mp4, starts


def api(base: str, method: str, path: str, body=None, raw=None, headers=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(base + path, data=data, method=method, headers=headers or {})
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=600) as r:
        text = r.read()
        return json.loads(text) if text else None


def upload(base: str, mp4: Path, hold: bool) -> dict:
    boundary = uuid.uuid4().hex
    parts = [f"--{boundary}\r\nContent-Disposition: form-data; name=\"hold\"\r\n\r\n{'true' if hold else 'false'}\r\n".encode(),
             f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{mp4.name}\"\r\n"
             f"Content-Type: video/mp4\r\n\r\n".encode() + mp4.read_bytes() + b"\r\n",
             f"--{boundary}--\r\n".encode()]
    return api(base, "POST", "/api/videos", raw=b"".join(parts),
               headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})


def onsets(code: str, starts: list[float]) -> list[float]:
    """Where the voice starts in each utterance of the joined file (20 ms speech band), in seconds."""
    wav = DATA / code / "joined" / "joined.wav"
    compose("cp", str(wav), "worker:/tmp/joined.wav")
    levels = json.loads(subprocess.run(
        ["docker", "compose", "exec", "-T", "-w", "/app", "-e", "PYTHONPATH=/app", "worker", "python", "-", "/tmp/joined.wav"],
        cwd=ROOT, input=WORKER_ONSETS, capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout.strip().splitlines()[-1])
    louder = sorted(levels)[len(levels) // 2:]
    speaking = louder[int(len(louder) * 0.8)]
    out = []
    for start in starts:
        k = int(start / 0.02)
        while k < len(levels) and levels[k] < speaking - 18:
            k += 1
        out.append(k * 0.02)
    return out


def pipeline(codes: list[str], base: str) -> None:
    RESULTS.mkdir(parents=True, exist_ok=True)
    path = RESULTS / "pipeline.json"
    results = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    runs = [(c, None) for c in codes] + ([("hi", "roman")] if "hi" in codes else [])
    for code, script in runs:
        mp4, starts = joined(code)
        voice = onsets(code, starts)
        video = upload(base, mp4, hold=script is not None)
        if script:
            api(base, "POST", f"/api/videos/{video['id']}/transcribe",
                {"spoken_language": code, "caption_language": "same", "hindi_script": script})
        print(f"{code}{'/' + script if script else ''}: video {video['id']}", flush=True)
        while True:
            state = api(base, "GET", f"/api/videos/{video['id']}")
            if state["status"] in ("completed", "failed"):
                break
            time.sleep(5)
        captions = api(base, "GET", f"/api/videos/{video['id']}/captions")["items"]
        coverage = compose("exec", "-T", "worker", "python", "scripts/coverage_check.py", str(video["id"]), check=False)
        timing = compose("exec", "-T", "worker", "python", "scripts/timing_check.py", str(video["id"]), check=False)
        # Drift: each utterance's first caption against where its voice starts.
        offsets = []
        for v in voice:
            near = [c["start_ms"] / 1000 - v for c in captions if abs(c["start_ms"] / 1000 - v) < 2.0]
            if near:
                offsets.append(min(near, key=abs))
        gaps = [line.strip() for line in coverage.splitlines() if re.match(r"\s+\d+\.\d+-", line)]
        results[code + (f"/{script}" if script else "")] = {
            "video": video["id"], "status": state["status"], "heard": state.get("detected_language"),
            "seconds": round(starts[-1] + 10, 0), "captions": len(captions),
            "coverage_pass": "PASS" in coverage and "FAIL" not in coverage, "gaps": gaps,
            "timing_pass": "ALL PASSED" in timing,
            "timing": [line for line in timing.splitlines() if "—" in line or "FAIL" in line][-3:],
            "offsets": offsets, "sample": [c["text"] for c in captions[:3]],
        }
        api(base, "DELETE", f"/api/videos/{video['id']}")
        print(f"   deleted video {video['id']}", flush=True)
        path.write_text(json.dumps(results, ensure_ascii=False, indent=0), encoding="utf-8")


# ── mt ────────────────────────────────────────────────────────────────────

WORKER_MT = r'''
import json, sys, time
from app.services import translation
data = json.load(open("/tmp/fleurs/mt.json", encoding="utf-8"))
out = {}
for source, texts in data["sources"].items():
    for target in data["targets"]:
        if target == source:
            continue
        start = time.time()
        out[f"{source}>{target}"] = {"texts": translation.translate_locally(texts, target, source=source),
                                     "took_s": round(time.time() - start, 1)}
        print(source, target, out[f"{source}>{target}"]["took_s"], file=sys.stderr, flush=True)
print(json.dumps(out, ensure_ascii=False))
'''


def mt(codes: list[str]) -> None:
    by_lang = {code: {row[0]: row[2] for row in rows(code)} for code in LANGS}
    common = sorted(set.intersection(*(set(t) for t in by_lang.values())), key=int)[:MT_SENTENCES]
    sources = {s: [by_lang[s][i] for i in common] for s in ("en", "hi")}
    payload = {"ids": common, "sources": sources, "targets": codes}
    (DATA / "mt.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    compose("exec", "-T", "worker", "mkdir", "-p", "/tmp/fleurs")
    compose("cp", str(DATA / "mt.json"), "worker:/tmp/fleurs/mt.json")
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "-w", "/app", "-e", "PYTHONPATH=/app", "worker", "python", "-"],
        cwd=ROOT, input=WORKER_MT, capture_output=True, text=True, encoding="utf-8",
    )
    if result.returncode != 0:
        print(result.stderr[-2000:], file=sys.stderr)
        raise SystemExit("translation failed")
    out = json.loads(result.stdout.strip().splitlines()[-1])
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "mt.json").write_text(json.dumps({"ids": common, "runs": out}, ensure_ascii=False, indent=0),
                                     encoding="utf-8")


def ngrams(text: str, n: int) -> Counter:
    text = text.replace(" ", "")  # chrF ignores whitespace
    return Counter(text[i:i + n] for i in range(len(text) - n + 1))


def chrf(hyps: list[str], refs: list[str], order: int = 6, beta: float = 2.0) -> float:
    """
    Corpus chrF as sacrebleu 2 computes it: character n-grams 1-6 without
    whitespace, statistics summed over the corpus, an F-beta (beta 2) per
    order, averaged.
    """
    eps, factor, total = 1e-16, beta**2, 0.0
    for n in range(1, order + 1):
        match = hyp_total = ref_total = 0
        for h, r in zip(hyps, refs):
            hc, rc = ngrams(h, n), ngrams(r, n)
            match += sum((hc & rc).values())
            hyp_total += sum(hc.values())
            ref_total += sum(rc.values())
        prec = match / hyp_total if hyp_total else eps
        rec = match / ref_total if ref_total else eps
        denom = factor * prec + rec
        total += (1 + factor) * prec * rec / denom if denom > 0 else eps
    return 100 * total / order


# ── report ────────────────────────────────────────────────────────────────


def grade_asr(code: str, s: dict) -> tuple[str, str]:
    if code in CER_LANGS:
        value, good, usable, name = s["cer"], CER_GOOD, CER_USABLE, "CER"
    else:
        value, good, usable, name = s["wer"], WER_GOOD, WER_USABLE, "WER"
    if value <= good:
        return "Good", f"{name} {value:.0%}"
    if value <= usable:
        return "Usable", f"{name} {value:.0%}"
    return "Weak", f"{name} {value:.0%}"


def report(codes: list[str]) -> None:
    runs = {}
    for model, device, _ in ASR_RUNS:
        path = RESULTS / f"asr-{model}-{device}.json"
        if path.exists():
            runs[(model, device)] = json.loads(path.read_text(encoding="utf-8"))
    print("## Speech recognition (FLEURS test, 50 utterances a language)\n")
    head = " | ".join(f"{m} {d} WER / CER" for (m, d) in runs)
    print(f"| Language | {head} | large-v3 detects it | Grade (large-v3, GPU) |")
    print("|---|" + "---|" * (len(runs) + 2))
    for code in codes:
        cells, grade = [], ""
        detected = "—"
        for (model, device), data in runs.items():
            if code not in data:
                cells.append("—")
                continue
            s = score_asr(code, data[code])
            cells.append(f"{s['wer']:.0%} / {s['cer']:.0%} ({s['rtf']:.2f}× real time)")
            if model == "large-v3":
                detected = f"{s['detected']:.0%}" if s["detected"] is not None else "—"
                g, why = grade_asr(code, s)
                grade = f"**{g}** ({why})"
        print(f"| {code} | {' | '.join(cells)} | {detected} | {grade} |")

    path = RESULTS / "pipeline.json"
    if path.exists():
        pipe = json.loads(path.read_text(encoding="utf-8"))
        print("\n## The app's pipeline (~3 minutes of joined utterances a language, dev stack, GPU)\n")
        print("| Language | Heard as | Captions | Speech with no caption (> 0.7 s) | Timing rules | First caption vs voice: mean / worst late / worst early |")
        print("|---|---|---|---|---|---|")
        for key, r in pipe.items():
            o = r["offsets"]
            drift = (f"{sum(o) / len(o):+.2f} / {max(o):+.2f} / {min(o):+.2f} s ({len(o)} utterances)" if o else "—")
            gaps = "none" if r["coverage_pass"] else "; ".join(r["gaps"]) or "FAIL"
            print(f"| {key} | {r['heard']} | {r['captions']} | {gaps} | {'pass' if r['timing_pass'] else 'FAIL: ' + ' '.join(r['timing'])} | {drift} |")

    path = RESULTS / "mt.json"
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        by_lang = {code: {row[0]: row[2] for row in rows(code)} for code in LANGS}
        print(f"\n## Translation (M2M100 on this machine, {len(data['ids'])} FLEURS sentences, chrF)\n")
        print("| Caption language | from English | from Hindi |")
        print("|---|---|---|")
        for code in codes:
            cells = []
            for source in ("en", "hi"):
                run = data["runs"].get(f"{source}>{code}")
                if not run:
                    cells.append("—")
                    continue
                value = chrf(run["texts"], [by_lang[code][i] for i in data["ids"]])
                grade = "Good" if value >= CHRF_GOOD else "Usable" if value >= CHRF_USABLE else "Weak"
                cells.append(f"{value:.1f} **{grade}**")
            print(f"| {code} | {' | '.join(cells)} |")

    print("\n## Samples (reference, then ours)\n")
    for code in codes:
        print(f"**{code}**")
        refs = {i["id"]: i for i in chosen(code)}
        big = runs.get(("large-v3", "cuda"), {}).get(code)
        for item in (big["items"][:3] if big else []):
            print(f"- ASR ref: {refs[item['id']]['raw']}\n  large-v3: {item['text']}")
        apex = runs.get(("hinglish", "cuda"), {}).get(code)
        for item in (apex["items"][:3] if apex else []):
            print(f"- ASR ref: {refs[item['id']]['raw']}\n  Apex (Roman): {item.get('roman', '')}")
        if (RESULTS / "mt.json").exists():
            data = json.loads((RESULTS / "mt.json").read_text(encoding="utf-8"))
            by = {row[0]: row[2] for row in rows(code)}
            run = data["runs"].get(f"en>{code}") or data["runs"].get(f"hi>{code}")
            for i, text in list(zip(data["ids"], run["texts"]))[:3] if run else []:
                print(f"- MT ref: {by[i]}\n  ours: {text}")
        print()


def clean() -> None:
    shutil.rmtree(DATA, ignore_errors=True)
    compose("exec", "-T", "worker", "rm", "-rf", "/tmp/fleurs", "/tmp/joined.wav", check=False)
    print(f"removed {DATA} and the worker's copies")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("step", choices=["fetch", "asr", "pipeline", "mt", "report", "clean"])
    parser.add_argument("--langs")
    parser.add_argument("--base", default="http://localhost:3001")
    parser.add_argument("--redo", action="store_true", help="asr: run languages already measured again")
    parser.add_argument("--models", help="asr: only these runs, e.g. large-v3-cuda,small-cpu")
    args = parser.parse_args()
    codes = langs_arg(args.langs)
    {"fetch": lambda: fetch(codes), "asr": lambda: asr(codes, args.redo, args.models.split(",") if args.models else None), "pipeline": lambda: pipeline(codes, args.base),
     "mt": lambda: mt(codes), "report": lambda: report(codes), "clean": clean}[args.step]()


if __name__ == "__main__":
    main()
