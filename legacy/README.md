# Legacy scripts

Move your original local RAG pipeline scripts here for reference:

- `mp4_to_mp3.py`
- `mp3_to_json.py`
- `preprocess_json.py`
- `process_incoming.py`

These aren't wired into the new app — they're kept so we can compare logic
(e.g. your Whisper timestamp handling, your cosine-similarity search) while
rebuilding each piece properly in `backend/app/`.

Your old `embeddings.joblib` isn't compatible with the new pipeline (moving
from Ollama bge-m3 to Sentence Transformers), so it's not needed here —
keep it wherever your old project lives if you want it for comparison later.
