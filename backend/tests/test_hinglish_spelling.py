"""Everyday Hinglish spelling (v1.3.1, services/hinglish_spelling.py)."""

import pytest

from app.services import hinglish_spelling as spelling
from app.services.transcription import Segment


@pytest.mark.parametrize(
    "formal, everyday",
    [
        # Tanush's list, from leo.mp4 (v1.3.1 brief)
        ("yah", "yeh"), ("nahin", "nahi"), ("yahaan", "yahan"), ("vah", "woh"),
        ("zyaada", "zyada"), ("vaala", "wala"), ("kyonki", "kyunki"), ("kuchh", "kuch"),
        ("pahle", "pehle"), ("achchha", "achha"), ("mainne", "maine"), ("chiz", "cheez"),
        ("nae", "naye"), ("gae", "gaye"), ("sirph", "sirf"), ("baithakar", "baithkar"),
    ],
)
def test_his_list_becomes_everyday(formal, everyday):
    assert spelling.everyday(formal) == everyday


def test_capitals_and_punctuation_are_kept():
    assert spelling.everyday("Yah bhi jagah hi nahin hai, bilkul.") == "Yeh bhi jagah hi nahi hai, bilkul."
    assert spelling.everyday("NAHIN! Nahin? (nahin)") == "NAHI! Nahi? (nahi)"
    assert spelling.everyday("Zyaada...") == "Zyada..."


def test_whole_words_only():
    # "yahaan" holds "yah", "nahinn" is not "nahin": neither is touched by the wrong entry.
    assert spelling.everyday("yahaan") == "yahan"
    assert spelling.everyday("nahinn vaalaa") == "nahinn vaalaa"
    # English words stay English.
    assert spelling.everyday("I want a new studio in Mumbai") == "I want a new studio in Mumbai"


def test_english_twins_change_only_next_to_hindi():
    assert spelling.everyday("aap logon ke lie lekar aaya") == "aap logon ke liye lekar aaya"
    assert spelling.everyday("Ham log yahaan par") == "Hum log yahan par"
    assert spelling.everyday("saari space die gai hai") == "saari space diye gayi hai"
    assert spelling.everyday("tin hazaar kilometer") == "teen hazaar kilometer"
    # Next to English, or alone, they are English.
    assert spelling.everyday("I never lie to you") == "I never lie to you"
    assert spelling.everyday("a ham sandwich") == "a ham sandwich"
    assert spelling.everyday("lie") == "lie"


def test_formal_words_already_everyday_are_untouched():
    text = "aapko poora saath baat jaate phir hoon mein hain"
    assert spelling.everyday(text) == text


def test_left_out_words_stay():
    # PROGRESS.md v1.3.1: a mishearing, no single everyday spelling, his own spelling.
    assert spelling.everyday("van chhah kyon") == "van chhah kyon"


def test_every_target_is_lowercase_and_differs():
    for table in (spelling.WORDS, spelling.TWINS):
        for formal, everyday in table.items():
            assert formal != everyday
            assert formal == formal.lower() and everyday == everyday.lower()
            # A target is never itself mapped again: one pass is the end state.
            assert everyday not in spelling.WORDS


def test_applying_twice_changes_nothing_more():
    text = "Yah sab kuchh mainne ke lie kiya, zyaada nahin"
    once = spelling.everyday(text)
    assert spelling.everyday(once) == once


def test_segment_text_and_timed_words_both_change():
    segment = Segment(
        start_ms=0, end_ms=2000, text=" Ham log ke lie nahin.", confidence=0.9,
        speech=[(0, 300, " Ham"), (300, 600, " log"), (600, 800, " ke"), (800, 1100, " lie"), (1100, 1500, " nahin.")],
    )
    out = spelling.everyday_segment(segment)
    assert out.text == " Hum log ke liye nahi."
    assert [w for _, _, w in out.speech] == [" Hum", " log", " ke", " liye", " nahi."]
    # Times untouched, and the original segment too.
    assert [(s, e) for s, e, _ in out.speech] == [(s, e) for s, e, _ in segment.speech]
    assert segment.text == " Ham log ke lie nahin."


def test_twin_neighbours_reach_across_timed_words():
    # Each timed word is its own piece; "lie" sees "ke" in the piece before.
    segment = Segment(start_ms=0, end_ms=900, text=" ke lie", confidence=None,
                      speech=[(0, 400, " ke"), (400, 900, " lie")])
    assert [w for _, _, w in spelling.everyday_segment(segment).speech] == [" ke", " liye"]


def test_banaata_follows_bataata():
    """Found in leo.mp4 0:25 after v1.3.1 was built: the siblings of "bataata" -> "batata"."""
    assert spelling.everyday("main studio banaata hoon, banaate hain, banaati hai") == "main studio banata hoon, banate hain, banati hai"
