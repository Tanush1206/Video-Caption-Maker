"""Are the models a release downloads still on Hugging Face? (v1.4.0, launch audit M2)

    docker run --rm -v "$PWD/scripts:/s:ro" <backend image> python /s/weekly_models.py

Run inside the released backend image by .github/workflows/weekly-check.yml,
so the list is that release's own: every model it pins (Apex, IndicXlit,
M2M100, MiniLM) at its pinned commit, and the Whisper models it looks up
through faster-whisper (on `main`: not pinned in the app). For each, the
files the app asks for must still be there; prints one line per model and
exits 1 if any is missing.
"""
import fnmatch
import sys

from huggingface_hub import HfApi

sys.path.insert(0, "/app")
from app.config import get_settings  # noqa: E402
from app.services import embeddings, hardware, hinglish, transcription, translation  # noqa: E402

models = [
    ("Hinglish (Apex)", hinglish.APEX_REPO, hinglish.APEX_REVISION, hinglish.APEX_FILES),
    ("Hindi transliterator (IndicXlit)", hinglish.XLIT_REPO, hinglish.XLIT_REVISION, hinglish.XLIT_FILES),
    ("search embeddings (MiniLM)", get_settings().embedding_model, embeddings.EMBEDDING_REVISION, embeddings.EMBEDDING_FILES),
]
models += [(f"translation ({name})", repo, revision, translation.M2M100_FILES)
           for name, (repo, revision) in translation.M2M100_MODELS.items()]
# WHISPER_FILES filters a download; only these three are in every model
# (preprocessor_config.json is only in the 128-mel v3 models, not small).
WHISPER_REQUIRED = ["config.json", "model.bin", "tokenizer.json"]
models += [(f"speech ({name})", transcription._repo_for(name), None, WHISPER_REQUIRED)
           for name in hardware.WHISPER_CHOICES]

api = HfApi()
missing = 0
for label, repo, revision, patterns in models:
    try:
        info = api.model_info(repo, revision=revision, files_metadata=True)
    except Exception as exc:  # noqa: BLE001 - any failure is the finding
        print(f"MISSING {label}: {repo}@{revision or 'main'}: {type(exc).__name__}: {exc}")
        missing += 1
        continue
    files = {s.rfilename: s.size or 0 for s in info.siblings}
    absent = [p for p in patterns if not any(fnmatch.fnmatch(f, p) for f in files)]
    size = sum(n for f, n in files.items() if any(fnmatch.fnmatch(f, p) for p in patterns))
    if absent:
        print(f"MISSING {label}: {repo}@{revision or 'main'} lacks {absent}")
        missing += 1
    else:
        print(f"ok      {label}: {repo}@{(revision or 'main')[:12]} {size / 1e6:,.0f} MB")
print(f"{len(models) - missing} of {len(models)} models available")
sys.exit(1 if missing else 0)
