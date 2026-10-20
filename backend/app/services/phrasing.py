"""
Captions cut into phrases, in every caption language.

The last step before captions are saved, after transcription and any
translation. It works on text and timings alone, so it treats a Hindi
transcript, an English one from Whisper's translate path and a Marathi
translation alike:

  - captions are joined into sentences (up to sentence-ending punctuation, or
    a pause of over a second), so a translated sentence that was forced back
    over its source's caption slots is whole again;
  - each sentence is cut into phrases of about TARGET_CHARS characters: after
    punctuation where there is any, otherwise into even word groups, and
    never leaving a word on its own unless the sentence is one word;
  - captions follow the speech, from Whisper's word timestamps (`speech` on
    each segment, kept through translation): every word gets its own time
    (its timed word's, or, for a translation or a word Whisper's timings
    don't cover, its share of its own segment's spoken time); speech is split
    into runs at every pause of PAUSE_MS or more, a caption never spans one,
    and every run is captioned; a caption starts on its first word and ends
    on its last;
  - within a run, captions are separated by SEPARATION_MS (two frames), so
    nothing flickers off and on; a caption ends at most TAIL_MS after its
    last word, lasts MIN_MS-MAX_MS, and never overlaps the next.

The words go through unchanged and in order: nothing is added, lost or
repeated (`rephrase` checks it).
"""

import difflib
from collections.abc import Sequence
from dataclasses import dataclass

SENTENCE_END = (".", "!", "?", "…", "।", "॥", "。", "！", "？")
CLAUSE_END = (",", ";", ":", "—", "–", "،", "、", "，")

# A phrase aims at about this many characters, and is longer only to keep a
# word from being left alone. English from Whisper's translate path, which
# viewers found right, has a median of 33.
TARGET_CHARS = 32
MAX_CHARS = 48
# A pause this long always ends a sentence, punctuation or not.
SENTENCE_GAP_MS = 1000
# Silence at least this long stays a gap on screen; anything shorter is a
# breath inside the speech and is captioned through.
PAUSE_MS = 500
# Two frames at 25 fps between captions that follow each other, so a viewer
# sees a change rather than a flicker.
SEPARATION_MS = 80
# How long a caption may stay up after its last word.
TAIL_MS = 500
MIN_MS = 800
MAX_MS = 7000
# Without word timings, the fastest believable speech for capping a span by
# its text: 8 characters a second. Ordinary speech is 12-20.
CHARS_PER_SECOND = 8.0
# Rewards for ending a phrase at punctuation, against squared characters off
# the even split. Large enough to move a cut a few words; not to make a phrase
# of 60 characters.
SENTENCE_BONUS = 400.0
CLAUSE_BONUS = 200.0

# Natural word groups where there is no punctuation (M2M100 often leaves a
# long translated sentence without any). A phrase never starts with a word
# that finishes the verb before it — "…सांगणार" | "आहोत…" and "…करू" |
# "शकता…" were cut that way — and prefers to start at a conjunction.
AUXILIARY_PENALTY = 600.0
CONJUNCTION_BONUS = 150.0
AUXILIARIES = frozenset(
    # Hindi
    "है हैं था थे थी थीं हूं हूँ हो रहा रहे रही सकता सकते सकती चुका चुके गया गए गई "
    "जाता जाती जाते होगा होगी होंगे पड़ेगा चाहिए दिया दी लिया ली लेना देना वाला वाले वाली "
    # Hindi postpositions, which belong to the noun before them ("की" is left
    # out: in Marathi it is a conjunction)
    "में से को का के ने पर तक "
    # Marathi
    "आहे आहेत आहोत आहात आहेस होते होता होती होतो लागते लागेल लागतो शकता शकतो शकते "
    "शकतात शकेल पाहिजे गेले गेला गेली देतो घेतो नाही नाहीत असेल असतात "
    # Bengali
    "আছে আছেন ছিল হবে হয় পারেন পারি যায়".split()
)
CONJUNCTIONS = frozenset(
    "and but so because that when if then or which who "
    "और लेकिन क्योंकि तो कि जब अगर या जो "
    "आणि पण कारण तर की जेव्हा जर किंवा जे म्हणून "
    "এবং কিন্তু কারণ যে যখন যদি তাই "
    "y pero porque que cuando si o e mas mais quando ma perché se "
    "et mais quand und aber dass wenn oder en maar dat als of "
    "и но что когда если или потому".split()
)


def _bare(word: str) -> str:
    """A word without the punctuation around it, in lower case."""
    return word.strip(".,;:!?…।॥\"'“”‘’()[]—–-").lower()


@dataclass
class Phrase:
    start_ms: int
    end_ms: int
    text: str
    confidence: float | None
    # When its last word was said: a caption ends no later than
    # TAIL_MS after it.
    spoken_end_ms: int = 0
    # Which pause-free stretch of speech it is in; the gap to the next caption
    # in the same run is a 2-frame separation, never a flicker.
    run: int = 0
    # When its first word was said; with spoken_end_ms, what decides whether
    # the silence to its neighbour is a breath or a pause.
    spoken_start_ms: int = 0


def _sentences(captions: Sequence) -> list[list]:
    """Runs of captions that make one sentence."""
    out, current = [], []
    for caption in captions:
        if not caption.text.strip():
            continue
        if current and caption.start_ms - current[-1].end_ms > SENTENCE_GAP_MS:
            out.append(current)
            current = []
        current.append(caption)
        if caption.text.rstrip().endswith(SENTENCE_END):
            out.append(current)
            current = []
    if current:
        out.append(current)
    return out


def split_phrases(
    words: list[str], most: int | None = None, least: int = 1
) -> list[list[str]]:
    """
    `words` cut into phrases of about TARGET_CHARS, after punctuation where
    possible, and never a phrase of one word when there are two or more.
    `most` and `least` bound the number of phrases (by the time they have to
    fill: 0.8 s each at least, 7 s at most).

    The cuts that minimise each phrase's squared distance from an even split,
    less a bonus for ending on punctuation: exact, by dynamic programming over
    the cut points, so the same words always cut the same way.
    """
    n = len(words)
    if not n:
        return []

    def length(i: int, j: int) -> int:
        return sum(len(w) for w in words[i:j]) + (j - i - 1)

    total = length(0, n)
    count = 1 if n <= 3 or total <= MAX_CHARS else min(n // 2, max(2, round(total / TARGET_CHARS)))
    if most is not None:
        count = min(count, most)
    count = min(n, max(count, least))
    if count < 2:
        return [words]
    # Two words a phrase at least, unless more phrases than that are needed.
    shortest = 2 if 2 * count <= n else 1
    even = total / count
    inf = float("inf")
    # best[k][j]: the cost of the first j words in k phrases, and where the
    # k-th starts.
    best = [[(inf, -1)] * (n + 1) for _ in range(count + 1)]
    best[0][0] = (0.0, -1)
    for k in range(1, count + 1):
        for j in range(shortest * k, n + 1):
            for i in range(shortest * (k - 1), j - shortest + 1):
                if best[k - 1][i][0] == inf:
                    continue
                size = length(i, j)
                cost = (size - even) ** 2 + max(0, size - MAX_CHARS) * 100
                if j < n:
                    last, following = words[j - 1], _bare(words[j])
                    if last.endswith(SENTENCE_END):
                        cost -= SENTENCE_BONUS
                    elif last.endswith(CLAUSE_END):
                        cost -= CLAUSE_BONUS
                    if following in AUXILIARIES:
                        cost += AUXILIARY_PENALTY
                    elif following in CONJUNCTIONS:
                        cost -= CONJUNCTION_BONUS
                cost += best[k - 1][i][0]
                if cost < best[k][j][0]:
                    best[k][j] = (cost, i)
    phrases, j = [], n
    for k in range(count, 0, -1):
        i = best[k][j][1]
        phrases.append(words[i:j])
        j = i
    return phrases[::-1]


def _speech_of(caption) -> list[tuple[int, int, str]]:
    """
    A caption's word timings, or, without any, its own span capped by its
    text: no faster than CHARS_PER_SECOND, so a span stretched over a pause
    doesn't take the pause with it.
    """
    speech = [(s, e, w) for s, e, w in (getattr(caption, "speech", None) or []) if e > s]
    if speech:
        return speech
    longest = max(1000, int(len(caption.text.strip()) / CHARS_PER_SECOND * 1000))
    return [(caption.start_ms, max(caption.start_ms + 1, min(caption.end_ms, caption.start_ms + longest)), "")]


def _word_times(caption) -> tuple[list[tuple[int, int]], int]:
    """
    When each word of a caption was said, (start_ms, end_ms), and how many
    of its words were matched to timed words.

    Words that match Whisper's timed words (in order, by a sequence match, so
    one extra or missing word doesn't lose the rest) take those words' times.
    The others are spread by length over the time between the known words
    around them; next to one known word only, they take as long as their text
    takes to say (CHARS_PER_SECOND); a translation, which matches nothing, is
    spread over the caption's own spoken time. Never across a
    whole run of speech: a word can only drift within its own segment.
    """
    words = caption.text.split()
    speech = _speech_of(caption)
    times: list[tuple[int, int] | None] = [None] * len(words)
    timed = [w for _, _, w in speech]
    if any(timed):
        matcher = difflib.SequenceMatcher(
            a=[_bare(w) for w in words], b=[_bare(w) for w in timed], autojunk=False
        )
        for a, b, size in matcher.get_matching_blocks():
            for k in range(size):
                times[a + k] = (speech[b + k][0], speech[b + k][1])
    matched = sum(t is not None for t in times)

    # The caption's spoken time, measured through the words' own intervals
    # and skipping the pauses between: `moment` maps spoken time to a moment.
    intervals = [(s, e) for s, e, _ in speech]
    spoken = sum(e - s for s, e in intervals) or 1

    def moment(t: float) -> int:
        for s, e in intervals:
            if t <= e - s:
                return int(round(s + t))
            t -= e - s
        return intervals[-1][1]

    def interval_at(moment_ms: int) -> tuple[int, int]:
        return next(((s, e) for s, e in intervals if moment_ms <= e), intervals[-1])

    sizes = [len(w) + 1 for w in words]
    total = sum(sizes) or 1
    offsets = [sum(sizes[:i]) for i in range(len(words) + 1)]
    index = 0
    while index < len(words):
        if times[index] is not None:
            index += 1
            continue
        last = index
        while last + 1 < len(words) and times[last + 1] is None:
            last += 1
        before = times[index - 1][1] if index > 0 else None
        after = times[last + 1][0] if last + 1 < len(words) else None
        span = offsets[last + 1] - offsets[index] or 1
        if before is not None or after is not None:
            # Next to a word that was timed: in the real time between the
            # known words, or, on one side only, for as long as its text
            # takes to say, reaching back (or on) from the known word.
            # Never past the caption's own end: a guess mustn't push the
            # next caption's known words later.
            needed = int(span / CHARS_PER_SECOND * 1000)
            lo = before if before is not None else after - needed
            hi = after if after is not None else max(min(before + needed, caption.end_ms), before)
            hi = max(hi, lo + (last + 1 - index))
            for k in range(index, last + 1):
                a = lo + round((offsets[k] - offsets[index]) / span * (hi - lo))
                b = lo + round((offsets[k + 1] - offsets[index]) / span * (hi - lo))
                times[k] = (a, max(b, a + 1))
            index = last + 1
            continue
        lo = offsets[index] / total * spoken
        hi = offsets[last + 1] / total * spoken
        for k in range(index, last + 1):
            a = lo + (offsets[k] - offsets[index]) / span * (hi - lo)
            b = lo + (offsets[k + 1] - offsets[index]) / span * (hi - lo)
            # A word stays inside the stretch of speech that holds its middle,
            # so it never spans a pause.
            s, e = interval_at(moment((a + b) / 2))
            start = min(max(moment(a), s), e - 1)
            times[k] = (start, max(min(moment(b), e), start + 1))
        index = last + 1
    return [t for t in times if t is not None], matched


def _runs(speech: list[tuple[int, int, str]]) -> list[list[tuple[int, int, str]]]:
    """Words grouped into stretches with no pause of PAUSE_MS or more."""
    runs: list[list[tuple[int, int, str]]] = []
    for item in sorted(speech):
        if runs and item[0] - runs[-1][-1][1] < PAUSE_MS:
            runs[-1].append(item)
        else:
            runs.append([item])
    return runs


def _share(words: list[str], runs: list[list[tuple[int, int, str]]]) -> list[list[str]]:
    """
    A translated sentence's words spread over the runs of speech it came
    from, in proportion to how long each was spoken; each run gets at least
    one word, and a cut lands after punctuation if there is some within two
    words of the even point.
    """
    durations = [r[-1][1] - r[0][0] for r in runs]
    total = sum(durations) or 1
    ends, running = [], 0
    for word in words:
        running += len(word) + 1
        ends.append(running)
    chars = ends[-1]
    cuts, share = [], 0
    for k in range(len(runs) - 1):
        share += durations[k]
        ideal = share / total * chars
        lowest = (cuts[-1] + 1) if cuts else 0
        highest = len(words) - (len(runs) - 1 - k) - 1
        best = min(range(lowest, highest + 1), key=lambda w: abs(ends[w] - ideal))
        for nearby in (best, best - 1, best + 1, best - 2, best + 2):
            if lowest <= nearby <= highest and words[nearby].endswith(SENTENCE_END + CLAUSE_END):
                best = nearby
                break
        cuts.append(best)
    out, start = [], 0
    for cut in [*cuts, len(words) - 1]:
        out.append(words[start:cut + 1])
        start = cut + 1
    return out


def _merge_closest(runs: list[list[tuple[int, int, str]]], count: int) -> list[list[tuple[int, int, str]]]:
    """Fewer runs, joining across the shortest pauses, when there are fewer words than runs."""
    runs = [list(r) for r in runs]
    while len(runs) > max(1, count):
        gaps = [runs[i + 1][0][0] - runs[i][-1][1] for i in range(len(runs) - 1)]
        i = gaps.index(min(gaps))
        runs[i:i + 2] = [runs[i] + runs[i + 1]]
    return runs


def rephrase(captions: Sequence) -> list[Phrase]:
    """
    Phrase-level captions from captions with `start_ms`, `end_ms`, `text`,
    `confidence` and, ideally, `speech` (their word timings).
    """
    out: list[Phrase] = []
    run_index = 0
    said_until = 0
    for sentence in _sentences(captions):
        words = [w for caption in sentence for w in caption.text.split()]
        # Every word with its own time (`_word_times`), in order.
        timed: list[tuple[str, int, int]] = []
        matched = 0
        for caption in sentence:
            times, count = _word_times(caption)
            matched += count
            for word, (start, end) in zip(caption.text.split(), times):
                # In order, and never before the last word was finished,
                # in this sentence or the one before.
                start = max(start, said_until)
                timed.append((word, start, max(end, start + 1)))
                said_until = timed[-1][2]
        if 2 * matched < len(words):
            # Mostly a translation: its words weren't the ones spoken, so
            # their times are guesses and mustn't decide where it is cut.
            speech = [item for caption in sentence for item in _speech_of(caption)]
            runs = _merge_closest(_runs(speech), len(words))
            for run, run_words in zip(runs, _share(words, runs)):
                out.extend(_translated(run_words, run, sentence[0].confidence, run_index))
                run_index += 1
            continue
        # Runs of speech: split at every pause of PAUSE_MS or more.
        runs: list[list[tuple[str, int, int]]] = []
        for item in timed:
            if runs and item[1] - runs[-1][-1][2] < PAUSE_MS:
                runs[-1].append(item)
            else:
                runs.append([item])
        for run in runs:
            out.extend(_timed(run, sentence[0].confidence, run_index))
            run_index += 1
    out.sort(key=lambda p: p.start_ms)
    _settle(out)

    before = [w for caption in captions for w in caption.text.split()]
    after = [w for phrase in out for w in phrase.text.split()]
    if before != after:  # pragma: no cover - a bug here must never lose words
        raise AssertionError("rephrasing changed the words")
    return out


def _timed(run: list[tuple[str, int, int]], confidence, index: int) -> list[Phrase]:
    """The phrases of one run of speech, each from its first word's start to its last word's end."""
    start, end = run[0][1], run[-1][2]
    duration = end - start
    words = [w for w, _, _ in run]
    phrases = split_phrases(words, most=max(1, duration // MIN_MS), least=-(-duration // MAX_MS))
    out, position = [], 0
    for phrase in phrases:
        first, last = run[position], run[position + len(phrase) - 1]
        position += len(phrase)
        out.append(Phrase(first[1], last[2], " ".join(phrase), confidence, last[2], index, first[1]))
    return out


def _translated(words: list[str], run: list[tuple[int, int, str]], confidence, index: int) -> list[Phrase]:
    """The phrases of a translation over one run of speech, timed by their share of its text."""
    start, end = run[0][0], run[-1][1]
    duration = end - start
    phrases = split_phrases(
        words, most=max(1, duration // MIN_MS), least=-(-duration // MAX_MS)
    )
    out, position = [], 0
    # Through the run in proportion to the text. Its last word is
    # whichever word of the run is being said where it ends.
    total = sum(len(w) + 1 for w in words)
    for phrase in phrases:
        size = sum(len(w) + 1 for w in phrase)
        a = start + round(position / total * duration)
        b = max(start + round((position + size) / total * duration), a + 1)
        position += size
        spoken = max((e for s, e, _ in run if s < b), default=b)
        out.append(Phrase(a, b, " ".join(phrase), confidence, max(spoken, b), index, a))
    return out


def _settle(out: list[Phrase]) -> None:
    """
    The timing rules, in place:
      - between captions whose speech is separated by a breath (under
        PAUSE_MS), the earlier one runs on to SEPARATION_MS before the next
        (no flicker); a real pause stays at least PAUSE_MS on screen;
      - a caption ends no more than TAIL_MS after its last word;
      - at least MIN_MS (into the gap after, then the gap before, as far as
        those rules allow; a caption still squeezed joins the neighbour the
        speech runs straight into), at most MAX_MS; never overlapping.
    """
    def space(a: Phrase, b: Phrase) -> int:
        """The gap to keep between two captions: two frames for a breath, a pause for a pause."""
        return SEPARATION_MS if b.spoken_start_ms - a.spoken_end_ms < PAUSE_MS else PAUSE_MS

    def close_gaps() -> None:
        for a, b in zip(out, out[1:]):
            gap = b.start_ms - a.end_ms
            if space(a, b) == SEPARATION_MS:
                if gap < PAUSE_MS:
                    a.end_ms = max(a.start_ms + 1, b.start_ms - SEPARATION_MS)
            elif gap < PAUSE_MS:
                a.end_ms = max(a.start_ms + 1, b.start_ms - PAUSE_MS)

    close_gaps()
    index = 0
    while index < len(out):
        phrase = out[index]
        before = out[index - 1] if index else None
        after = out[index + 1] if index + 1 < len(out) else None
        short = MIN_MS - (phrase.end_ms - phrase.start_ms)
        if short > 0:
            room = phrase.spoken_end_ms + TAIL_MS - phrase.end_ms
            if after is not None:
                room = min(room, after.start_ms - space(phrase, after) - phrase.end_ms)
            phrase.end_ms += max(0, min(short, room))
            short = MIN_MS - (phrase.end_ms - phrase.start_ms)
        if short > 0:
            room = phrase.start_ms - (before.end_ms + space(before, phrase) if before else 0)
            phrase.start_ms -= max(0, min(short, room))
            short = MIN_MS - (phrase.end_ms - phrase.start_ms)
        if short > 0:
            # Still too short: join a neighbour the speech runs straight into
            # (in its run, or across a breath shorter than a pause).
            mates = [
                (n, m) for n, m in ((index - 1, before), (index + 1, after))
                if m is not None and (
                    m.run == phrase.run
                    or (space(phrase, m) if n > index else space(m, phrase)) == SEPARATION_MS
                )
            ]
            if mates:
                n, mate = min(mates, key=lambda nm: nm[1].end_ms - nm[1].start_ms)
                first, second = (mate, phrase) if n < index else (phrase, mate)
                merged = Phrase(
                    first.start_ms, second.end_ms, f"{first.text} {second.text}",
                    first.confidence, second.spoken_end_ms, phrase.run, first.spoken_start_ms,
                )
                lo = min(n, index)
                out[lo:lo + 2] = [merged]
                index = max(0, lo - 1)
                continue
        index += 1
    # At most MAX_MS: cut at the middle word boundary if a caption still runs over.
    index = 0
    while index < len(out):
        phrase = out[index]
        words = phrase.text.split()
        if phrase.end_ms - phrase.start_ms > MAX_MS and len(words) > 1:
            halves = split_phrases(words, least=2, most=2)
            middle = phrase.start_ms + round(
                (phrase.end_ms - phrase.start_ms) * len(" ".join(halves[0])) / len(phrase.text)
            )
            out[index:index + 1] = [
                Phrase(phrase.start_ms, middle - SEPARATION_MS, " ".join(halves[0]),
                       phrase.confidence, middle - SEPARATION_MS, phrase.run, phrase.spoken_start_ms),
                Phrase(middle, phrase.end_ms, " ".join(halves[1]),
                       phrase.confidence, phrase.spoken_end_ms, phrase.run, middle),
            ]
            continue
        if phrase.end_ms - phrase.start_ms > MAX_MS:
            phrase.end_ms = phrase.start_ms + MAX_MS
        index += 1
    close_gaps()
    for a, b in zip(out, out[1:]):
        if a.end_ms > b.start_ms - SEPARATION_MS:
            a.end_ms = max(a.start_ms + 1, b.start_ms - SEPARATION_MS)
