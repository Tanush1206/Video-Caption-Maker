"""
The Google Fonts library.

Mostly offline: the catalogue is a committed file, and the one test that
actually reaches the network is marked so it can be deselected.
"""

import io

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


def test_every_variable_source_declares_its_axes():
    """
    The invariant that keeps a variable font from reaching either renderer.

    A variable file is allowed in the catalogue only as *source*: it is pinned
    to a static cut on download. That pinning needs every axis, and an axis
    left free leaves `fvar` in the output — which is the original failure, a
    file where libass takes the default instance and fakes a bold while the
    browser interpolates a real one.

    So the rule is not "no variable paths". It is "no variable path without the
    axes needed to flatten it", checked both ways.
    """
    for font in font_library.all_fonts().values():
        looks_variable = "[" in font.regular
        assert looks_variable == font.is_variable, (
            f"{font.family}: path {font.regular} and axes {font.axes} disagree"
        )
        if font.is_variable:
            assert font.axes, f"{font.family} is variable with no axes to pin"
            # Both weights come from the one variable file.
            assert font.bold in (None, font.regular)


def test_the_popular_variable_only_families_are_available():
    """
    Roboto is the case that drove this.

    It is the most used font on the list, Google publishes it as a variable
    font only, and the first version of the catalogue therefore left it out
    entirely — "why is Roboto missing" being the first question anyone asked.
    It is now included, as a variable source with axes to pin.
    """
    for key in ("roboto", "inter", "opensans", "montserrat", "oswald"):
        font = font_library.get(key)
        assert font is not None, f"{key} is missing from the catalogue"
        assert font.is_variable and "wght" in dict(font.axes)
        # A weight axis reaching 700 is what makes a real bold possible.
        assert font.has_bold


def test_static_families_are_left_alone():
    """A family Google ships static must not be routed through the instancer."""
    pacifico = font_library.get("pacifico")
    assert pacifico is not None
    assert not pacifico.is_variable
    assert pacifico.axes is None


def test_search_puts_prefix_matches_first():
    """
    'pac' matches Pacifico at the start and Space Mono in the middle, and the
    prefix has to come first — a search for the font you already have in mind
    should not bury it under coincidences.
    """
    families = [f.family for f in font_library.search("pac")]
    assert "Pacifico" in families and "Space Mono" in families
    assert families.index("Pacifico") < families.index("Space Mono")


def test_catalogue_meta_accounts_for_every_family():
    """
    The info panel's numbers have to add up, because they are shown to a user
    as an explanation of what is missing.
    """
    meta = font_library.catalogue_meta()
    assert meta["static"] + meta["instanced"] == len(font_library.all_fonts())
    assert (
        meta["static"]
        + meta["instanced"]
        + meta["skipped_oversized"]
        + meta["skipped_unusable"]
        == meta["google_families"]
    )


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


async def test_api_can_return_the_whole_catalogue_at_once(client):
    """
    What the picker actually asks for.

    It windows its list, so it holds every family and renders a dozen. A
    ceiling below the catalogue would silently truncate that to a partial list
    with nothing to give it away — which is exactly what happened when
    instancing took the library from 1301 families to 1832 and the cap was
    still 1500. Asserted against MAX_LIMIT rather than a literal so the two
    cannot drift apart again.
    """
    from app.api.fonts import MAX_LIMIT

    assert MAX_LIMIT > len(font_library.all_fonts())

    body = (await client.get(f"/api/fonts?limit={MAX_LIMIT}")).json()
    assert body["returned"] == body["matched"] == body["total"]
    assert len(body["fonts"]) == len(font_library.all_fonts())


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
def test_instancing_produces_a_real_static_bold(tmp_path, monkeypatch):
    """
    The end of the variable-font problem, checked on the actual bytes.

    Two things have to be true and neither is obvious from the code. The output
    must have no `fvar` — an axis left unpinned would make this a variable font
    again, and libass and the browser would disagree about it. And regular and
    bold must be genuinely different files, because the whole complaint about
    handing over a variable font was that one of the two renderers would
    synthesise its bold rather than draw one.
    """
    from fontTools.ttLib import TTFont

    monkeypatch.setattr(font_library, "cache_dir", lambda: tmp_path)

    roboto = font_library.get("roboto")
    assert roboto.is_variable

    regular = font_library.ensure("roboto", "regular").read_bytes()
    bold = font_library.ensure("roboto", "bold").read_bytes()

    assert regular != bold, "bold is the same file as regular; the pin did nothing"

    for data, expected in ((regular, "Regular"), (bold, "Bold")):
        parsed = TTFont(io.BytesIO(data))
        assert "fvar" not in parsed, "still a variable font after instancing"
        assert parsed["name"].getDebugName(1) == "Roboto"
        assert parsed["name"].getDebugName(2) == expected


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
