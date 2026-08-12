"""
The Google Fonts library.

Mostly offline: the catalogue is a committed file, and the one test that
actually reaches the network is marked so it can be deselected.
"""

import pytest

from app.services import caption_style as style_service
from app.services import font_library


def test_catalogue_loads_and_is_substantial():
    fonts = font_library.all_fonts()
    # Not an exact number — the catalogue is regenerated occasionally and
    # Google adds families. This asserts it loaded at all and is the right
    # order of magnitude, which is what would actually break.
    assert len(fonts) > 1000
    assert "pacifico" in fonts
    assert fonts["pacifico"].family == "Pacifico"


def test_catalogue_holds_no_variable_fonts():
    """
    The whole reason the catalogue is filtered.

    A variable family would have libass take the default instance and
    synthesise a fake bold while the browser interpolated a real one along the
    weight axis — the preview disagreeing with the export.
    """
    for font in font_library.all_fonts().values():
        assert "[" not in font.regular, f"{font.family} points at a variable file"
        if font.bold:
            assert "[" not in font.bold, f"{font.family} bold points at a variable file"


def test_search_puts_prefix_matches_first():
    """
    'pac' matches Pacifico at the start and Space Mono in the middle, and the
    prefix has to come first — a search for the font you already have in mind
    should not bury it under coincidences.
    """
    families = [f.family for f in font_library.search("pac")]
    assert "Pacifico" in families and "Space Mono" in families
    assert families.index("Pacifico") < families.index("Space Mono")


def test_variable_only_families_are_simply_absent():
    """
    Roboto is the clearest case: enormously popular, and variable-only, so it
    is not offered at all rather than offered and rendered wrong. Worth pinning
    because "why is Roboto missing" is the first question anyone will ask.
    """
    assert font_library.get("roboto") is None
    assert not any(f.family == "Roboto" for f in font_library.search("roboto"))


def test_search_is_bounded():
    assert len(font_library.search("", limit=10)) == 10


def test_matches_is_the_uncapped_count_search_slices():
    """
    The distinction the picker's counts depend on.

    `search` returns a page; `matches` returns everything, which is the only
    way the API can say "first 60 of 960" rather than quoting the catalogue
    total beside a list of two results.
    """
    everything = font_library.matches("a")
    assert len(everything) > 60
    assert font_library.search("a", limit=60) == everything[:60]


@pytest.mark.parametrize(
    ("query", "expected"),
    [("lob", 2), ("pacifico", 1), ("definitely-not-a-font", 0)],
)
async def test_api_counts_describe_the_query_not_the_catalogue(client, query, expected):
    """
    The bug a user spotted: searching "lob" listed two fonts under a heading
    that read "1301 families", which looks like a picker that cannot count.

    `total` stays in the response because the placeholder legitimately wants
    it, but `matched` is what sits next to the results.
    """
    response = await client.get(f"/api/fonts?q={query}")
    assert response.status_code == 200

    body = response.json()
    assert body["matched"] == expected
    assert body["returned"] == expected == len(body["fonts"])
    assert body["total"] == len(font_library.all_fonts())


async def test_api_reports_what_it_left_out(client):
    """A broad query has to admit it is showing a slice."""
    body = (await client.get("/api/fonts?q=a&limit=5")).json()
    assert body["returned"] == 5
    assert body["matched"] > 5


def test_unknown_font_falls_back_rather_than_raising():
    """Playback must never break because a style names a font that vanished."""
    assert style_service.get_font("no-such-font").key == style_service.DEFAULT_FONT_KEY


def test_catalogue_font_resolves_to_itself():
    font = style_service.get_font("pacifico")
    assert font.render_name == "Pacifico"
    # No metric-compatible stand-in in the stack: the browser is served the
    # exact file libass loads, so a generic fallback would only ever hide a
    # failed download behind text rendered in something else.
    assert font.css_stack.startswith('"Pacifico"')


def test_builtins_win_over_the_catalogue():
    """
    A built-in key must keep its own definition.

    'lato' and 'poppins' are vendored in the repo *and* present in the
    catalogue. The built-in is the one with a guaranteed local file, so it has
    to be the one that answers.
    """
    assert style_service.get_font("lato").render_name == "Lato"
    assert style_service.get_font("lato") is style_service.FONTS_BY_KEY["lato"]


@pytest.mark.parametrize("weight", ["regular", "bold"])
def test_unknown_key_raises_lookup_error(weight):
    with pytest.raises(LookupError):
        font_library.ensure("definitely-not-a-font", weight)


def test_rejects_a_weight_that_is_not_a_weight():
    with pytest.raises(LookupError):
        font_library.ensure("pacifico", "../../etc/passwd")


def test_validate_rejects_a_404_page():
    """
    The failure this guard exists for.

    An HTML error page written to disk as a .ttf makes libass fall back
    silently, which is exactly the class of bug the font table was built to
    prevent — so a download is checked before it is cached, not after it has
    produced a wrong-looking export.
    """
    with pytest.raises(ValueError, match="not a TrueType file"):
        font_library._validate(b"<!DOCTYPE html><title>404</title>")


def test_validate_rejects_a_variable_font():
    # A plausible header claiming an fvar table, which the catalogue filter is
    # supposed to have excluded upstream.
    import struct

    tags = [b"fvar", b"head", b"OS/2", b"glyf"]
    header = struct.pack(">IHHHH", 0x00010000, len(tags), 0, 0, 0)
    directory = b"".join(tag + struct.pack(">III", 0, 0, 0) for tag in tags)
    with pytest.raises(ValueError, match="variable font"):
        font_library._validate(header + directory)


@pytest.mark.network
def test_downloads_and_caches_a_real_face(tmp_path, monkeypatch):
    """
    The end-to-end path, against Google's actual CDN.

    Marked `network` so the suite can run offline: deselect with
    `-m "not network"`.
    """
    monkeypatch.setattr(
        font_library, "cache_dir", lambda: tmp_path
    )

    path = font_library.ensure("pacifico")
    assert path.exists() and path.stat().st_size > 10_000
    assert path.read_bytes()[:4] == b"\x00\x01\x00\x00"

    # The vertical span is cached beside the file, because the browser needs it
    # to draw text the size the export will use and re-reading the font on
    # every request would be silly.
    span = font_library.win_span("pacifico")
    assert span is not None and 1.0 < span < 3.0
