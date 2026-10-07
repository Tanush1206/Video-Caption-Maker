"""
The languages captions can be produced in.

One list, shared by the API's validation, the worker's routing and the options
the editor shows. A second copy anywhere would eventually offer a language the
pipeline cannot actually deliver.
"""

# ISO 639-1, which is what Whisper's `language=` expects and what Gemini reads
# happily in a prompt. Deliberately short: five languages that can be checked,
# rather than the ninety-nine Whisper claims and nobody here has verified.
LANGUAGES: dict[str, str] = {
    "en": "English",
    "hi": "Hindi",
    "fr": "French",
    "de": "German",
    "nl": "Dutch",
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


def is_spoken_language(value: str) -> bool:
    return value == AUTO or value in LANGUAGES


def is_caption_language(value: str) -> bool:
    return value == SAME or value in LANGUAGES


def label(code: str) -> str:
    if code == AUTO:
        return "Auto-detect"
    if code == SAME:
        return "Same as spoken"
    return LANGUAGES.get(code, code)


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
