"""Custom vocabulary (v1.3.1, services/vocabulary.py), on Apex's own leo.mp4 captions."""

import pytest

from app.services import vocabulary
from app.services.transcription import Segment

LEO = ["vlog", "BMW", "Akrapovic", "Ladakh", "Hyderabad", "Instagram", "S 1000 RR", "Leo"]


@pytest.mark.parametrize(
    "caption, fixed",
    [
        ("Ab lagaenge ismen acropovic. Sattar hazaar rupe ka", "Ab lagaenge ismen Akrapovic. Sattar hazaar rupe ka"),
        ("poora laddaakh yaad aa gaya", "poora Ladakh yaad aa gaya"),
        ("Mere haidraabaad ke ghar ki", "Mere Hyderabad ke ghar ki"),
        ("ke S 1000 aaraar lagti hai", "ke S 1000 RR lagti hai"),
        ("meri leo par itni sundar modes", "meri Leo par itni sundar modes"),
        # One sound off, next to Hindi: the vlog Apex heard as "block".
        ("Bina kisi deri ke block chaaloo kar raha hoon", "Bina kisi deri ke vlog chaaloo kar raha hoon"),
        ("Is block ke end mein", "Is vlog ke end mein"),
    ],
)
def test_words_that_sound_like_the_vocabulary_take_its_spelling(caption, fixed):
    assert vocabulary.apply(caption, LEO) == fixed


@pytest.mark.parametrize(
    "caption",
    [
        "Turn left at the next block and park",   # an English block stays
        "The S 2000 RR is another bike",          # a different number
        "Lado aur lead dono",                     # short sounds never match by sound
        "हम लद्दाख गए थे",                         # Devanagari is never changed
        "welcome back to a brand new vlog yaar",  # already right
        # One sound off but not its voicing twin, next to Hindi: false
        # matches the first version made on leo.mp4, new-5min and hinglish.mp4.
        "uska ek groom reels ka section banaunga kyonki",
        "zara kadak chaay ho jaaye",
        "pair lambe hain mere",
        "mera wallet kho gaya hai",
        "jo log bolte hain",
        "ye kholega aur dekhega",
        "Link par click karo",
    ],
)
def test_nothing_else_changes(caption):
    assert vocabulary.apply(caption, LEO) == caption


def test_an_empty_list_changes_nothing():
    assert vocabulary.apply("poora laddaakh yaad aa gaya", []) == "poora laddaakh yaad aa gaya"


def test_segment_text_and_timed_words_both_change():
    segment = Segment(start_ms=0, end_ms=1500, text=" poora laddaakh yaad", confidence=None,
                      speech=[(0, 400, " poora"), (400, 900, " laddaakh"), (900, 1500, " yaad")])
    out = vocabulary.apply_segment(segment, LEO)
    assert out.text == " poora Ladakh yaad"
    assert [w for _, _, w in out.speech] == [" poora", " Ladakh", " yaad"]
    assert segment.text == " poora laddaakh yaad"


def test_the_list_is_cleaned_and_checked():
    assert vocabulary.clean(["  vlog ", "VLOG", "", "S  1000 RR", "Akrapovic"]) == ["vlog", "S 1000 RR", "Akrapovic"]
    assert vocabulary.invalid(["vlog", "AT&T", "Dr. Who", "O'Brien", "Hyderabad-based", "हैदराबाद"]) is None
    assert vocabulary.invalid(["<script>"]) is not None
    assert vocabulary.invalid(["x" * 41]) is not None
    assert vocabulary.invalid([f"word{i}" for i in range(101)]) is not None
