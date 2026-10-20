"""
Phrase-level captions in every language (v1.0.8, bug 3).

Marathi captions of a Hinglish tutorial came out as single words held for
13-15 seconds and sentences cut mid-phrase, 76 captions to English's 116.
Three causes, each tested here with the real failure's shape:
  - Whisper skipped stretches of speech (`_fill_skipped`);
  - alignment stretched a word over the pause after it, and the long-segment
    split made it a caption of its own (`_with_plausible_words`);
  - translated sentences were forced back into their source's slots
    (`phrasing.rephrase`).
The whole pipeline on that video is checked by scripts/caption_quality.py.
"""

from pathlib import Path
from types import SimpleNamespace

from app.services import phrasing, transcription
from app.services.transcription import Segment


def _caps(*rows):
    return [Segment(start_ms=int(a * 1000), end_ms=int(b * 1000), text=t, confidence=-0.3) for a, b, t in rows]


def _words(caps):
    return [w for c in caps for w in c.text.split()]


def _check(phrases):
    """The rules every rephrased result keeps."""
    durations = [(p.end_ms - p.start_ms) / 1000 for p in phrases]
    assert max(durations) <= 7.0
    assert all(b.start_ms >= a.end_ms for a, b in zip(phrases, phrases[1:]))


# ── Rephrasing ──────────────────────────────────────────────────────────


def test_a_word_stretched_over_a_pause_is_neither_alone_nor_long():
    """The Hindi failure: "…इंडिया लिगा" then "हैं।" held from 66.0 to 87.8 s."""
    before = _caps(
        (62.16, 63.88, "और हम चाते हैं टैक्स इंग्लिश में अपियर हूँ।"),
        (63.88, 65.90, "तो यहाँ पर इंग्लिश और ब्रेकेट में इंडिया लिगा"),
        (66.00, 87.78, "हैं।"),
        (88.75, 92.24, "अपके और इसको इसको योस कैसे करना हैंग्या"),
    )
    after = phrasing.rephrase(before)
    _check(after)
    assert _words(after) == _words(before)
    assert all(len(p.text.split()) > 1 for p in after)
    last_of_sentence = next(p for p in after if p.text.endswith("हैं।") and "लिगा" in p.text)
    assert last_of_sentence.end_ms <= 70_000


def test_a_translated_sentence_is_cut_at_phrase_boundaries_not_at_its_old_slots():
    """
    Marathi forced back over the Hindi slots read "…सांगणार" | "आहोत…" and
    "…करू" | "शकता…". Rephrased, no caption starts with a word that ends the
    verb before it.
    """
    before = _caps(
        (0.0, 3.7, "त्यामुळे व्हिडिओमध्ये कॅप्शन्स ऑटो जेनरेट करण्याचा हा मार्ग तुम्हाला सांगणार"),
        (4.5, 6.16, "आहोत जो कदाचित कमी लोकांना माहीत आहे आम्ही"),
        (30.75, 33.0, "सर्वात आधी तुम्हाला गूगलवर जावे लागते आणि क्लिप जेंप वेव अपलिकेशनला अपन करणं हे काम"),
        (33.0, 36.2, "तुम्ही फोनवरूनही करू शकता तर येथे क्रिएट न्यू व्हिडिओवर जाऊन"),
    )
    after = phrasing.rephrase(before)
    _check(after)
    assert _words(after) == _words(before)
    starts = [p.text.split()[0] for p in after]
    assert not set(starts) & phrasing.AUXILIARIES, starts


def test_phrases_are_timed_by_their_share_of_the_text():
    """Two even phrases of one caption share its time evenly."""
    before = _caps((10.0, 14.0, "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima"))
    after = phrasing.rephrase(before)
    assert len(after) >= 2
    shares = [(p.end_ms - p.start_ms) / sum(len(w) + 1 for w in p.text.split()) for p in after]
    assert max(shares) - min(shares) < 5  # ms per character, within rounding


def test_a_long_transcript_comes_out_as_phrases():
    """Long run-on captions: at most 5% single words, nothing over 7 s, nothing lost."""
    sentence = "today we are going to make a simple tomato soup and then we will serve it with fresh bread"
    before = _caps(*[(i * 9.0, i * 9.0 + 8.5, sentence) for i in range(10)])
    after = phrasing.rephrase(before)
    _check(after)
    assert _words(after) == _words(before)
    single = sum(1 for p in after if len(p.text.split()) == 1)
    assert single <= 0.05 * len(after)
    assert len(after) >= 2 * len(before)


def test_a_one_word_sentence_stays_one_word():
    """Unless the speech really is one word."""
    after = phrasing.rephrase(_caps((1.0, 1.6, "Yes."), (3.0, 5.0, "Then we start cooking.")))
    assert [p.text for p in after] == ["Yes.", "Then we start cooking."]


def test_split_phrases_prefers_conjunctions_and_never_leaves_a_word_alone():
    words = "Today we are making a simple tomato soup and then we will serve it with fresh bread because it is good".split()
    phrases = phrasing.split_phrases(words)
    assert all(len(p) > 1 for p in phrases)
    assert any(p[0] in ("and", "because") for p in phrases[1:])
    assert [w for p in phrases for w in p] == words


# ── Transcription ───────────────────────────────────────────────────────


def _word(start, end, text):
    return SimpleNamespace(start=start, end=end, word=text, probability=0.9)


def test_a_word_aligned_across_a_pause_is_capped():
    """".T." ran from 8.1 to 19.1 s; no word is believed longer than 3 s."""
    segment = SimpleNamespace(
        text=" यूसिंग S.R .T.", start=6.3, end=19.1, avg_logprob=-0.3,
        words=[_word(6.3, 7.0, " यूसिंग"), _word(7.0, 8.1, " S.R"), _word(8.1, 19.08, " .T.")],
    )
    pieces = list(transcription._iter([segment]))
    assert len(pieces) == 1, [p.text for p in pieces]
    assert pieces[0].end <= 8.1 + transcription.WORD_MAX_SECONDS


def test_skipped_speech_is_decoded_again_until_nothing_is_left(monkeypatch):
    """
    The full pass jumped from 8 s to 29.4 s. Decoded alone, the stretch also
    stopped early (to 16 s), so what was left is decoded again.
    """
    calls = []

    def fake_decode(model, clip, language, task, spans, levels, on_progress, offset=0.0, **options):
        calls.append(round(offset, 1))
        if round(offset, 1) == 8.0:
            return _caps((11.2, 13.0, "पहला हिस्सा"), (13.0, 16.0, "दूसरा हिस्सा")), None
        if round(offset, 1) == 16.0:
            return _caps((16.0, 18.0, "तीसरा हिस्सा"), (18.0, 22.7, "चौथा हिस्सा"), (22.8, 28.3, "पाँचवाँ")), None
        return [], None

    monkeypatch.setattr(transcription, "_decode", fake_decode)
    monkeypatch.setattr(transcription, "_duration", lambda path: 31.0)
    monkeypatch.setattr(transcription.subprocess, "run", lambda *a, **k: None)

    full = _caps((0.0, 6.3, "शुरू"), (6.3, 8.0, "यूसिंग S.R.T."), (29.4, 31.0, "फाइल।"))
    filled = transcription._fill_skipped(None, Path("/tmp/a.wav"), full, "hi", "transcribe", [], [])
    assert [c.text for c in filled] == [
        "शुरू", "यूसिंग S.R.T.", "पहला हिस्सा", "दूसरा हिस्सा", "तीसरा हिस्सा", "चौथा हिस्सा", "पाँचवाँ", "फाइल।",
    ]
    assert 8.0 in calls and 16.0 in calls
    assert all(b.start_ms >= a.end_ms for a, b in zip(filled, filled[1:]))


# ── Timing to the speech (word timestamps) ──────────────────────────────


def _timed(text, words, start=None, end=None):
    """A caption with word timings: words is [(start_s, end_s, word), ...]."""
    speech = [(int(a * 1000), int(b * 1000), w) for a, b, w in words]
    return Segment(
        start_ms=int((start if start is not None else words[0][0]) * 1000),
        end_ms=int((end if end is not None else words[-1][1]) * 1000),
        text=text, confidence=-0.2, speech=speech,
    )


def _rules(phrases, speech):
    """The timing rules, against the words that were spoken."""
    for a, b in zip(phrases, phrases[1:]):
        gap = b.start_ms - a.end_ms
        assert gap >= 0, "overlap"
        assert gap >= phrasing.PAUSE_MS or gap <= phrasing.SEPARATION_MS, f"a {gap} ms flicker gap"
    for p in phrases:
        assert phrasing.MIN_MS <= p.end_ms - p.start_ms <= phrasing.MAX_MS, (p.text, p.end_ms - p.start_ms)
    for s, e, _ in speech:
        # Every spoken moment is on screen, but for the 2-frame separations.
        uncovered = e - s - sum(
            max(0, min(e, p.end_ms) - max(s, p.start_ms)) for p in phrases
        )
        assert uncovered <= phrasing.SEPARATION_MS, f"speech at {s}-{e} ms is uncaptioned"


def test_captions_follow_the_words_not_the_slot():
    """
    A slot that Whisper stretched over a pause: its words were said in the
    first 2 s, so the caption ends at most half a second after them.
    """
    words = [(10.0, 10.4, "Now"), (10.4, 10.8, "this"), (10.8, 11.1, "is"), (11.1, 11.5, "the"), (11.5, 12.0, "file.")]
    caption = _timed("Now this is the file.", words, end=25.0)
    [phrase] = phrasing.rephrase([caption])
    assert phrase.start_ms == 10_000
    assert phrase.end_ms <= 12_000 + phrasing.TAIL_MS


def test_a_breath_is_bridged_and_a_pause_stays_a_gap():
    """0.3 s between words: no flicker. 1.2 s of silence: a gap on screen."""
    words = [
        (0.0, 0.5, "first"), (0.5, 1.0, "we"), (1.0, 1.6, "chop"), (1.6, 2.2, "onions,"),
        (2.5, 3.0, "then"), (3.0, 3.6, "we"), (3.6, 4.2, "fry"), (4.2, 4.8, "them."),
        (6.0, 6.5, "after"), (6.5, 7.0, "that"), (7.0, 7.6, "we"), (7.6, 8.4, "serve."),
    ]
    caption = _timed(" ".join(w for _, _, w in words), words)
    phrases = phrasing.rephrase([caption])
    _rules(phrases, caption.speech)
    assert any(b.start_ms - a.end_ms >= 1000 for a, b in zip(phrases, phrases[1:])), "the pause was covered"


def test_a_translation_is_timed_to_the_runs_of_speech_it_came_from():
    """Translated text no longer matches the words, but follows their timing."""
    words = [(0.0, 0.6, "आज"), (0.6, 1.2, "हम"), (1.2, 2.0, "सूप"), (2.0, 2.6, "बनाएंगे"),
             (5.0, 5.6, "फिर"), (5.6, 6.2, "परोसेंगे")]
    caption = Segment(start_ms=0, end_ms=6200, text="आज आपण सूप बनवणार आहोत आणि नंतर वाढणार आहोत",
                      confidence=-0.2, speech=[(int(a * 1000), int(b * 1000), w) for a, b, w in words])
    phrases = phrasing.rephrase([caption])
    _rules(phrases, caption.speech)
    assert all(p.end_ms <= 2600 + phrasing.TAIL_MS or p.start_ms >= 5000 for p in phrases), "a caption spans the pause"
    assert [w for p in phrases for w in p.text.split()] == caption.text.split()


def test_a_short_word_alone_lasts_at_least_0_8_s():
    caption = _timed("Yes.", [(3.0, 3.25, "Yes.")])
    following = _timed("Then we start cooking.", [(5.0, 5.4, "Then"), (5.4, 5.7, "we"), (5.7, 6.1, "start"), (6.1, 6.8, "cooking.")])
    phrases = phrasing.rephrase([caption, following])
    assert phrases[0].end_ms - phrases[0].start_ms >= phrasing.MIN_MS
    assert phrases[0].end_ms <= 3250 + phrasing.TAIL_MS


def test_a_long_stretch_of_speech_is_cut_into_captions_of_at_most_7_s():
    words = [(i * 0.5, i * 0.5 + 0.45, f"word{i}") for i in range(40)]
    caption = _timed(" ".join(w for _, _, w in words), words)
    phrases = phrasing.rephrase([caption])
    _rules(phrases, caption.speech)
    assert len(phrases) >= 3


def test_a_word_squeezed_between_two_captions_joins_one():
    """
    "फाइल।" (0.44 s) sat between a caption ending as it started and one
    starting as it ended: no room to reach 0.8 s, so it joins the neighbour the
    speech runs straight into rather than flashing for 0.4 s.
    """
    before = [
        _timed("बस एक बार आपके पास SRT", [(27.0, 27.5, "बस"), (27.5, 27.8, "एक"), (27.8, 28.1, "बार"),
                                          (28.1, 28.5, "आपके"), (28.5, 28.9, "पास"), (28.9, 29.4, "SRT")]),
        _timed("फाइल।", [(29.42, 29.86, "फाइल।")]),
        _timed("जब आपकी अडियो हिंदी में", [(29.86, 30.2, "जब"), (30.2, 30.5, "आपकी"), (30.5, 30.9, "अडियो"),
                                           (30.9, 31.3, "हिंदी"), (31.3, 31.6, "में")]),
    ]
    phrases = phrasing.rephrase(before)
    _rules(phrases, [w for c in before for w in c.speech])
    assert all(p.text != "फाइल।" for p in phrases)


# ── Caption starts (v1.0.9) ─────────────────────────────────────────────
#
# Captions came up to 2.6 s late on the Hindi tutorial: segments whose text
# had a word Whisper's timed words didn't (18 of 89) were spread over the
# whole run of speech by their share of its text, and every caption after the
# first in a run drifted. Each caption now starts on its own first word.
# Allowed: no later than 100 ms after it, no earlier than 200 ms before.


def _starts_on_their_words(phrases, words):
    """Every phrase starts within the allowed window of its first word."""
    said = iter(words)
    for phrase in phrases:
        first = phrase.text.split()[0]
        for start, _, word in said:
            if word == first:
                break
        offset = phrase.start_ms - start
        assert -200 <= offset <= 100, f"{phrase.text!r} starts {offset:+} ms from its first word"
        for _ in phrase.text.split()[1:]:
            next(said)


def _run(sentences):
    """
    One long run of speech, no pause: one segment per (text, words) line,
    words as (start_s, end_s, word); a word Whisper left out of `speech` is
    spread by the old code over the whole run.
    """
    segments = []
    for text, words in sentences:
        speech = [(int(a * 1000), int(b * 1000), w) for a, b, w in words]
        segments.append(Segment(start_ms=speech[0][0], end_ms=speech[-1][1], text=text, confidence=-0.2, speech=speech))
    return segments


def _sentence_of(words, start, untimed_first=False):
    """`words` said back to back from `start`, 0.35 s each; the first left untimed if asked."""
    timed = [(start + i * 0.35, start + (i + 1) * 0.35, w) for i, w in enumerate(words)]
    return " ".join(words), timed[1:] if untimed_first else timed, timed


def _check_language(lines):
    sentences, truth = [], []
    at = 0.0
    for k, words in enumerate(lines):
        text, timed, said = _sentence_of(words, at, untimed_first=k % 3 == 1)
        sentences.append((text, timed))
        truth += [(int(a * 1000), int(b * 1000), w) for a, b, w in said]
        at += len(words) * 0.35
    phrases = phrasing.rephrase(_run(sentences))
    _starts_on_their_words(phrases, truth)
    return phrases


def test_hindi_captions_start_on_their_first_word():
    _check_language([
        "तो वीडियो में कैप्शन ऑटो जनरेट करने का ऐसा तरीका आपको बताने वाले हैं".split(),
        "और आपके कैप्शन पूरी तरह से कस्टमाइज भी होंगे अब ये फाइल".split(),
        "जो कि मुश्किल से काफी कम लोगों को पता है हम लोग ये सब करने वाले हैं".split(),
        "चाहे आपकी ऑडियो हिंदी में क्यों ना हो ये बिल्कुल एक्यूरेसी के साथ".split(),
        "सबसे पहले आपको गूगल पर जाना है और क्लिपचैंप वेब एप्लीकेशन को ओपन कर लेना".split(),
        "बस फाइल डाउनलोड करना है तो वीडियो को टाइमलाइन में यहाँ ऐड कर लो".split(),
    ])


def test_english_captions_start_on_their_first_word():
    _check_language([
        "today I want to show you how to add captions to any video".split(),
        "first open the app and drag your video into the window".split(),
        "it takes a minute or two depending on how long the video is".split(),
        "while it works you can make a cup of tea and wait".split(),
        "when it is done pick the language you want the captions in".split(),
        "you can keep the language that was spoken or translate it".split(),
    ])


def test_spanish_captions_start_on_their_first_word():
    _check_language([
        "hoy vamos a aprender a preparar una sopa de tomate en casa".split(),
        "primero corta dos cebollas en trozos pequeños y fríelas a fuego lento".split(),
        "después añade cuatro tomates maduros un diente de ajo y jengibre".split(),
        "ahora agrega dos vasos de agua tapa la olla y deja que se cocine".split(),
        "cuando los tomates estén deshechos apaga el fuego y deja enfriar".split(),
        "luego pon todo en la batidora y tritúralo bien hasta que quede fino".split(),
    ])


def test_a_word_with_no_timing_takes_the_time_between_its_neighbours():
    """One untimed word in the middle: between the words around it, not anywhere in the caption."""
    words = [(10.0, 10.3, "we"), (10.3, 10.6, "will"), (11.0, 11.4, "soup")]
    caption = _timed("we will make soup", words)
    times, matched = phrasing._word_times(caption)
    assert matched == 3
    assert times[2] == (10600, 11000)


def test_a_guessed_last_word_does_not_push_the_next_caption_late():
    """
    "है" had no timing at the end of its segment (43.80 s) and was given its
    text's length, to 44.18 s: "हमको", said at 43.80, then started there.
    """
    first = _timed("कोई एडिटिंग नहीं कर रहा है", [(42.8, 43.0, "कोई"), (43.02, 43.4, "एडिटिंग"), (43.4, 43.5, "नहीं"),
                                                 (43.5, 43.68, "कर"), (43.68, 43.8, "रहा")], end=43.8)
    second = _timed("हमको बस SRT फाइल डाउनलोड करना है", [(43.8, 44.14, "हमको"), (44.14, 44.42, "बस"), (44.42, 44.88, "SRT"),
                                                        (44.88, 45.0, "फाइल"), (45.0, 45.3, "डाउनलोड"), (45.3, 45.64, "करना"),
                                                        (45.64, 45.68, "है")])
    phrases = phrasing.rephrase([first, second])
    # On screen by the time it is said, whichever caption it falls in.
    start = next(p.start_ms for p in phrases if "हमको" in p.text.split())
    assert start - 43_800 <= 100, start
