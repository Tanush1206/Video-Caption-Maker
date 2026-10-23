"""
The languages captions can be produced in.

One list, shared by the API's validation, the worker's routing and the options
the editor shows. A second copy anywhere would eventually offer a language the
pipeline cannot actually deliver.
"""

# ISO 639-1, which is what Whisper's `language=` expects, what M2M100's
# language tokens are named after, and what Gemini reads happily in a prompt.
# Deliberately short: languages that were checked end to end — Whisper,
# M2M100's own language list, a translation sweep and a burned-in export —
# rather than the ninety-nine Whisper claims. Telugu is not in M2M100, and
# Kannada, Gujarati and Punjabi came out of it unusable; see PROGRESS.md
# (v1.0.7) for the samples. Arabic, Urdu and CJK need right-to-left or CJK
# rendering first (docs/ROADMAP.md).
#
# The same list is the spoken languages offered. A language heard that isn't
# here is transcribed only when someone chooses to try anyway.
LANGUAGES: dict[str, str] = {
    "en": "English",
    "hi": "Hindi",
    "fr": "French",
    "de": "German",
    "nl": "Dutch",
    "es": "Spanish",
    "pt": "Portuguese",
    "it": "Italian",
    "ru": "Russian",
}

# Offered from v1.0.7 to v1.0.10, removed in v1.0.11: on FLEURS large-v3 heard
# them at 63-122% word error (Malayalam mostly in other scripts) and M2M100
# translated into them at chrF 24-43 (docs/TESTING.md, "Language quality").
# Videos made in them keep their captions and still export; they are named
# here so what was made in them still reads as Tamil rather than "ta".
RETIRED: dict[str, str] = {
    "bn": "Bengali",
    "mr": "Marathi",
    "ta": "Tamil",
    "ml": "Malayalam",
}

# Each language in its own name and script, which is how someone looking for
# their language finds it in a list of ten.
NATIVE_NAMES: dict[str, str] = {
    "en": "English",
    "hi": "हिन्दी",
    "fr": "Français",
    "de": "Deutsch",
    "nl": "Nederlands",
    "es": "Español",
    "pt": "Português",
    "it": "Italiano",
    "ru": "Русский",
}

# "Whatever is being spoken" — the default, and the only honest answer before
# anyone has listened to the file.
AUTO = "auto"

# "Leave the captions in whatever language was spoken", as opposed to naming a
# target. Distinct from AUTO: that one is about the *input*.
SAME = "same"


# There is no substitution table here, and there was one.
#
# Under `medium`, Punjabi audio transcribed measurably better when Whisper was
# told it was Hindi (-0.71 against -1.47), so `pa -> hi` was hard-coded. Under
# `large-v3` that reverses completely:
#
#     detected pa, transcribed as pa    11 segments  162s  -0.108   Gurmukhi
#     detected pa, transcribed as hi    37 segments  127s  -0.204   Devanagari
#
# The substitution was never a fact about the two languages. It was a fact
# about `medium` being bad at Punjabi, and it expired the moment the model
# changed — while looking exactly as principled as it had the day it was
# measured. Detection is now simply believed.


# How Hindi captions are written (v1.0.9). Roman ("Hinglish": Hindi in Latin
# letters, English words in English spelling) is how most people type Hindi
# and comes from its own speech model (services/hinglish.py); Devanagari is
# what Whisper itself writes.
ROMAN = "roman"
DEVANAGARI = "devanagari"
HINDI_SCRIPTS: dict[str, tuple[str, str]] = {
    ROMAN: ("Hinglish (Roman)", "Hinglish"),
    DEVANAGARI: ("हिन्दी (Devanagari)", "हिन्दी"),
}
# Decide from detection, the same rule the language step presets with.
SCRIPT_AUTO = "auto"

# Hinglish is the default only when Hindi is heard this surely. Below it,
# nothing is preset: the person chooses. Marathi, which detection trades with
# Hindi, isn't offered since v1.0.11: hearing it asks for another spoken
# language (Hindi among them) or a try anyway, like any language not offered.
HINGLISH_MIN_CONFIDENCE = 0.70


def is_hindi_script(value: str) -> bool:
    return value in HINDI_SCRIPTS or value == SCRIPT_AUTO


def default_hindi_script(detected: str | None, confidence: float | None) -> str | None:
    """The script to preset for what was heard: Hinglish for sure Hindi, otherwise none (ask)."""
    if detected == "hi" and confidence is not None and confidence >= HINGLISH_MIN_CONFIDENCE:
        return ROMAN
    return None


def hindi_script_for(chosen: str | None, spoken: str, confidence: float | None) -> str:
    """
    The script a job writes Hindi in.

    A choice is kept. "auto" (started before detection answered) applies the
    preset rule, and anything it wouldn't preset stays Devanagari, as Hindi
    always was. NULL, a video from before v1.0.9 or a client that doesn't
    send one, is Devanagari.
    """
    if chosen in HINDI_SCRIPTS:
        return chosen
    if chosen == SCRIPT_AUTO:
        return default_hindi_script(spoken, confidence) or DEVANAGARI
    return DEVANAGARI


def is_spoken_language(value: str) -> bool:
    return value == AUTO or value in LANGUAGES


def is_caption_language(value: str) -> bool:
    return value == SAME or value in LANGUAGES


def native_name(code: str) -> str | None:
    """The language's name in itself, or None for "auto" and "same"."""
    return NATIVE_NAMES.get(code)


def label(code: str) -> str:
    if code == AUTO:
        return "Auto-detect"
    if code == SAME:
        return "Same as spoken"
    return LANGUAGES.get(code) or RETIRED.get(code, code)


def needs_translation(spoken: str, caption: str) -> bool:
    """
    Whether a separate translation pass is required after transcribing.

    False when the caption language is whatever was spoken, and false when the
    spoken language is already the target — transcribing English audio with
    English captions is one operation, not two.

    Note this cannot be decided for `AUTO` until Whisper has reported what it
    heard, which is why the worker calls it again with the detected language.
    """
    if caption == SAME:
        return False
    return spoken != caption


def whisper_task(spoken: str, caption: str) -> str:
    """
    Which Whisper task to run.

    Whisper can translate, but **only into English** — there is no target
    parameter, `translate` means "into English" and nothing else. So English
    output gets it for free in the same pass that does the transcription, and
    every other language has to be transcribed first and translated after.

    Using it when the audio is already English would be pointless work, and
    Whisper handles that case worse than plain transcription.
    """
    if caption == "en" and spoken != "en":
        return "translate"
    return "transcribe"
