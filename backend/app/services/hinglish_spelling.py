"""
Everyday Hinglish spelling (v1.3.1).

Apex, the Hinglish speech model, writes textbook transliteration: "yah",
"nahin", "yahaan", "lie", "zyaada", "vaala", "kuchh", "pahle". People write
"yeh", "nahi", "yahan", "liye", "zyada", "wala", "kuch", "pehle". On a clean
12.7-minute vlog 268 of 467 captions held one, and on the measured clips
most of the strict word error was this style, not misheard words
(PROGRESS.md, v1.3.1).

Everyday spelling is a fixed word map, applied to the words of a Hinglish
caption: whole words only, keeping their capitals and the punctuation
around them. Built from Apex's own output on three clips, with only
spellings that mean one thing; the words left out and why are in
PROGRESS.md. Four of Apex's spellings are English words too ("lie", "ham",
"die", "tin"): those change only next to a clearly Hindi word, so "ke lie"
becomes "ke liye" and "I lie" stays.
"""

import copy
import re

EVERYDAY = "everyday"
FORMAL = "formal"
DEFAULT = EVERYDAY
# code: (label, example). Served by the API with the language options.
SPELLINGS: dict[str, tuple[str, str]] = {
    EVERYDAY: ("Everyday", "pehle, liye"),
    FORMAL: ("Formal", "pahle, lie"),
}

WORDS: dict[str, str] = {
    # pronouns and little words
    "yah": "yeh", "vah": "woh", "nahin": "nahi", "kuchh": "kuch", "kyonki": "kyunki",
    "mainne": "maine", "hamen": "humein", "hamko": "humko", "hamaara": "hamara",
    "hamaari": "hamari", "hamaare": "hamare", "tumhaara": "tumhara", "tumhaari": "tumhari",
    "tumhaare": "tumhare", "ismen": "ismein", "usmen": "usmein", "jismen": "jismein",
    "kismen": "kismein", "inmen": "inmein", "unmen": "unmein", "islie": "isliye",
    "kislie": "kisliye", "chaahie": "chahiye", "vahi": "wahi", "vahin": "wahin",
    "vaise": "waise", "vaisa": "waisa", "vaisi": "waisi", "yahaan": "yahan",
    "vahaan": "wahan", "jahaan": "jahan", "kahaan": "kahan", "zyaada": "zyada",
    "zyaadaatar": "zyadatar", "vaala": "wala", "vaale": "wale", "vaali": "wali",
    "vaalon": "walon", "chiz": "cheez", "chizen": "cheezein", "chizon": "cheezon",
    "pahle": "pehle", "pahla": "pehla", "pahli": "pehli", "sirph": "sirf",
    "kaaphi": "kaafi", "maaphi": "maafi", "taraph": "taraf", "sopha": "sofa",
    "achchha": "achha", "achchhi": "achhi", "achchhe": "achhe", "oopar": "upar",
    "divaali": "diwali", "aavaaz": "awaaz", "vagairah": "wagairah", "vajah": "wajah",
    "vaapas": "wapas", "khoobsoorat": "khoobsurat", "chaakoo": "chaaku",
    "chaaloo": "chaalu", "bhaabhi": "bhabhi",
    # -ae, -ai and -ie endings
    "nae": "naye", "gae": "gaye", "gai": "gayi", "aae": "aaye", "aai": "aayi",
    "jae": "jaaye", "kie": "kiye", "aaega": "aayega", "aaegi": "aayegi",
    "aaenge": "aayenge", "aaainge": "aayenge", "jaega": "jaayega", "jaegi": "jaayegi",
    "jaenge": "jaayenge", "paega": "payega", "chalaega": "chalayega",
    "lagaenge": "lagayenge", "karaenge": "karayenge", "bataenge": "batayenge",
    "karie": "kariye", "dekhie": "dekhiye", "chalie": "chaliye", "bataie": "bataiye",
    # the future in -oonga
    "karoonga": "karunga", "karoongi": "karungi", "banaoonga": "banaunga",
    "banaoongi": "banaungi", "rakhoonga": "rakhunga", "rahoonga": "rahunga",
    "loonga": "lunga", "loongi": "lungi", "doonga": "dunga", "doongi": "dungi",
    "dikhoonga": "dikhunga", "chhodoonga": "chhodunga", "aaoongi": "aaungi",
    "lagaoonga": "lagaunga", "ghusoonga": "ghusunga", "paoonga": "paunga",
    # the inherent vowel written out
    "baithakar": "baithkar", "dekhate": "dekhte", "dekhana": "dekhna",
    "rakhate": "rakhte", "pahunchate": "pahunchte", "pichhali": "pichhli",
    "pahachaan": "pehchaan", "pahnana": "pehnana", "kah": "keh", "rah": "reh",
    "rahne": "rehne", "kahna": "kehna",
    # a long aa where everyday writing has a short one
    "chaahe": "chahe", "chaahte": "chahte", "chaahta": "chahta", "chaahti": "chahti",
    "khaana": "khana", "baahar": "bahar", "bataata": "batata", "bataane": "batane",
    "bataana": "batana", "bataaya": "bataya", "banaata": "banata",
    "banaate": "banate", "banaati": "banati", "dikhaata": "dikhata",
    "dikhaana": "dikhana", "dikhaane": "dikhane", "banaane": "banane",
    "lagaana": "lagana", "lagaaya": "lagaya", "karaane": "karane", "karaaya": "karaya",
    "chalaane": "chalane", "chalaaya": "chalaya", "nikaala": "nikala",
    "nikaale": "nikale", "nikaal": "nikal", "nikaalna": "nikalna", "nikaalne": "nikalne",
    "taiyaariyaan": "taiyariyan", "mithaiyaan": "mithaiyan", "ladkiyaan": "ladkiyan",
    "pyaara": "pyara", "pyaari": "pyari", "shaayad": "shayad", "saamaan": "samaan",
    "dhyaan": "dhyan", "khyaal": "khayal", "maahaul": "mahaul", "gyaarah": "gyarah",
    "baarah": "barah",
    # places and names Apex lengthens
    "laddaakh": "ladakh", "haidraabaad": "hyderabad", "jammoo": "jammu", "paayal": "payal",
}

# Apex spellings that are English words too: changed only next to a word
# that is clearly Hindi.
TWINS: dict[str, str] = {"lie": "liye", "ham": "hum", "die": "diye", "tin": "teen"}

# Clearly Hindi: never an English word ("to", "do", "main", "is", "par", "the"
# and "so" are both, and left out). Every spelling in WORDS counts as well.
_HINDI = frozenset({
    "ke", "ki", "ka", "ko", "se", "ne", "hai", "hain", "tha", "thi", "hoon", "ho", "log",
    "logon", "kar", "karke", "karne", "kya", "aur", "bhi", "raha", "rahe", "rahi", "gaya",
    "aapke", "aapko", "mere", "tere", "iske", "uske", "isake", "usake", "kis", "kisi",
    "unke", "inke", "apne", "sab", "sabse", "yahi", "filhaal", "dikhaane", "de", "diye",
    "liye", "hazaar", "sau", "baje", "ghante", "ghanta", "din", "saal", "mahine",
    "saadhe", "dekhenge", "chahte", "ya", "bhai", "yaar",
})
HINDI = _HINDI | frozenset(WORDS) | frozenset(WORDS.values())

_WORD = re.compile(r"[A-Za-z]+")


def _respell(word: str, target: str) -> str:
    """`target` with `word`'s capitals: Nahin -> Nahi, NAHIN -> NAHI."""
    if len(word) > 1 and word.isupper():
        return target.upper()
    if word[0].isupper():
        return target[0].upper() + target[1:]
    return target


def _everyday_pieces(pieces: list[str]) -> list[str]:
    """
    Each piece with its words in everyday spelling, reading the pieces as one
    run of text, so a word's neighbours can sit in the pieces either side
    (Whisper's timed words are one piece each).
    """
    found = [(p, m) for p, piece in enumerate(pieces) for m in _WORD.finditer(piece)]
    lows = [m.group(0).lower() for _, m in found]
    targets: list[str | None] = []
    for i, low in enumerate(lows):
        target = WORDS.get(low)
        if target is None and low in TWINS:
            near = (lows[j] for j in (i - 1, i + 1) if 0 <= j < len(lows))
            if any(word in HINDI for word in near):
                target = TWINS[low]
        targets.append(target)

    out = list(pieces)
    # Right to left within a piece, so earlier offsets stay valid.
    for (p, m), target in reversed(list(zip(found, targets))):
        if target is not None:
            piece = out[p]
            out[p] = piece[:m.start()] + _respell(m.group(0), target) + piece[m.end():]
    return out


def everyday(text: str) -> str:
    """`text` with Apex's textbook spellings in everyday ones."""
    return _everyday_pieces([text])[0]


def everyday_segment(segment):
    """A transcription Segment in everyday spelling: its text and its timed words alike."""
    out = copy.copy(segment)
    out.text = everyday(segment.text)
    speech = getattr(segment, "speech", None) or []
    if speech:
        words = _everyday_pieces([w for _, _, w in speech])
        out.speech = [(s, e, w) for (s, e, _), w in zip(speech, words)]
    return out
