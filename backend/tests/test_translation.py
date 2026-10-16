"""Local translation: sentences, not fragments, and the guards on decoding."""

from types import SimpleNamespace

from app.services import translation
from app.services.translation import sentence_groups, split_like


def test_captions_that_make_one_sentence_are_grouped():
    texts = [
        "Welcome back to the kitchen.",
        "First, chop two onions and fry them slowly",
        "until they are soft.",
        "",
        "Then add the tomatoes, a little salt,",
        "and a cup of water.",
        "रसोई में फिर से आपका स्वागत है।",
    ]
    assert sentence_groups(texts) == [[0], [1, 2], [3], [4, 5], [6]]


def test_a_sentence_that_never_ends_is_cut_at_the_limits():
    assert sentence_groups(["and then"] * 9) == [[0, 1, 2, 3], [4, 5, 6, 7], [8]]
    long = ["x" * 150] * 4
    assert sentence_groups(long) == [[0, 1, 2], [3]]


def test_a_translated_sentence_splits_back_over_the_same_captions():
    parts = ["Then add the tomatoes, a little salt,", "and a cup of water."]
    pieces = split_like("Ensuite, ajoutez les tomates, un peu de sel, et une tasse d'eau.", parts)
    # Same count, every word kept in order, and the cut after the comma
    # nearest the source's own boundary.
    assert pieces == ["Ensuite, ajoutez les tomates, un peu de sel,", "et une tasse d'eau."]


def test_split_shares_follow_the_source_lengths():
    pieces = split_like("a b c d e f g h i j", ["short", "a much much longer caption here"])
    assert len(pieces) == 2
    assert len(pieces[0].split()) < len(pieces[1].split())
    assert " ".join(pieces).split() == "a b c d e f g h i j".split()


def test_split_gives_up_when_there_are_fewer_words_than_captions():
    assert split_like("Merci.", ["Thank you", "for watching", "everyone."]) is None
    assert split_like("Merci.", ["Thank you."]) == ["Merci."]


class _FakeModel:
    """Upper-cases each input and records what it was given."""

    def __init__(self, words_out=None):
        self.calls = []
        self.words_out = words_out

    def encode(self, text, out_type=str):
        return text.split()

    def decode(self, tokens):
        return " ".join(tokens)

    def translate_batch(self, sources, target_prefix, **options):
        self.calls.append(([" ".join(s[1:-1]) for s in sources], options))
        out = []
        for source, prefix in zip(sources, target_prefix):
            words = [w.upper() for w in source[1:-1]]
            if self.words_out is not None:
                words = words[: self.words_out]
            out.append(SimpleNamespace(hypotheses=[[*prefix, *words]]))
        return out


def _local(monkeypatch, model):
    monkeypatch.setattr(translation, "_load", lambda on_download=None: (model, model))
    monkeypatch.setattr(translation, "_languages", {"en", "fr"})


def test_the_model_sees_whole_sentences_and_each_caption_keeps_its_place(monkeypatch):
    model = _FakeModel()
    _local(monkeypatch, model)
    texts = ["First, chop two onions", "until they are soft.", "", "Done."]

    out = translation.translate_locally(texts, "fr", source="en")

    sent = [line for batch, _ in model.calls for line in batch]
    assert sent == ["First, chop two onions until they are soft.", "Done."]
    assert out == ["FIRST, CHOP TWO ONIONS", "UNTIL THEY ARE SOFT.", "", "DONE."]


def test_a_sentence_that_will_not_split_is_translated_caption_by_caption(monkeypatch):
    # The "translation" of the joined sentence is one word: too few for two
    # captions, so each caption goes through on its own instead.
    model = _FakeModel(words_out=1)
    _local(monkeypatch, model)

    out = translation.translate_locally(["Thank you", "for watching."], "fr", source="en")

    assert model.calls[0][0] == ["Thank you for watching."]
    assert model.calls[1][0] == ["Thank you", "for watching."]
    assert out == ["THANK", "FOR"]


def test_decoding_is_capped_and_cannot_loop(monkeypatch):
    model = _FakeModel()
    _local(monkeypatch, model)

    translation.translate_locally(["one two three four five."], "fr", source="en")

    options = model.calls[0][1]
    # Seven tokens in: the language tag, five words, </s>.
    assert options["max_decoding_length"] == 3 * 7 + 10
    assert options["no_repeat_ngram_size"] == 4
