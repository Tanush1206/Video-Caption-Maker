import pytest

from app.models.caption_style import Alignment, CaptionStyle
from app.services import caption_style as style_service
from app.services import subtitles
from tests.conftest import a_style


async def upload(client, headers, content: bytes):
    return await client.post(
        "/api/videos", headers=headers, files={"file": ("clip.mp4", content, "video/mp4")}
    )


# ── Options ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_options_lists_fonts_and_presets(client):
    response = await client.get("/api/styles/options")

    assert response.status_code == 200
    body = response.json()
    # Against the table rather than a hardcoded list: this asserts the endpoint
    # offers everything the service knows about, and adding a face does not
    # break a test that was never about the specific names.
    assert {f["key"] for f in body["fonts"]} == {f.key for f in style_service.FONTS}
    # The vendored faces are the ones that can go missing — they come from a
    # bind mount rather than the image, so a compose file without it would
    # leave them absent while everything still starts.
    assert {"poppins", "lato", "barlow-condensed", "anton", "bebas-neue"} <= {
        f["key"] for f in body["fonts"]
    }
    assert set(body["presets"]) == {"youtube", "tiktok", "minimal"}
    # The browser needs the stack to preview with; without it the client would
    # have to guess a family and the preview would stop matching the render.
    assert all(f["css_stack"] for f in body["fonts"])


def test_every_offered_font_is_installed_in_the_image():
    """
    The guard against the whole class of "preview doesn't match the export".

    libass substitutes a font it cannot find without any error, so an entry in
    FONTS that isn't installed renders as something else while the browser
    previews the real thing. Checked against fontconfig, which is what libass
    itself asks.
    """
    import subprocess

    installed = subprocess.run(
        ["fc-list", ":", "family"], capture_output=True, timeout=30
    ).stdout.decode()

    for font in style_service.FONTS:
        assert font.render_name in installed, (
            f"{font.render_name!r} is offered but not installed; "
            "add it to backend/Dockerfile or remove it from FONTS"
        )


# ── Colour conversion ────────────────────────────────────────────────────


def test_hex_becomes_ass_bgr():
    """ASS orders channels blue-green-red, backwards from hex."""
    assert style_service.to_ass_colour("#FF0000") == "&H000000FF"  # red
    assert style_service.to_ass_colour("#0000FF") == "&H00FF0000"  # blue
    assert style_service.to_ass_colour("#FFFFFF") == "&H00FFFFFF"


def test_ass_alpha_is_transparency_not_opacity():
    """
    The inversion that catches everyone.

    ASS's alpha byte is how *see-through* the colour is, so 0 is fully opaque
    and 255 invisible — the opposite of the opacity the UI works in.
    """
    assert style_service.to_ass_colour("#000000", opacity=1.0).startswith("&H00")
    assert style_service.to_ass_colour("#000000", opacity=0.0).startswith("&HFF")
    assert style_service.to_ass_colour("#000000", opacity=0.5).startswith("&H80")


# ── Alignment ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("alignment", "expected"),
    [(Alignment.LEFT, 4), (Alignment.CENTER, 5), (Alignment.RIGHT, 6)],
)
def test_alignment_is_the_middle_row_of_the_keypad(alignment, expected):
    r"""
    `\an` sets both the meaning of `\pos` and how the lines justify.

    The horizontal half follows the caption's alignment; the vertical half is
    the middle, so `\pos`'s y is the vertical centre of the lines, which is
    where the layout puts it.
    """
    style = a_style(alignment=alignment)
    assert style_service.to_ass_alignment(style) == expected


# ── Resolution independence ──────────────────────────────────────────────


def test_sizes_scale_with_video_height():
    """
    One style has to mean the same thing on a 360p and a 4K video.

    Sizes are stored against a 1080p canvas, so a 54px caption is 18px on 360p
    and 108px on 2160p — the same fraction of the frame in all three.
    """
    style = a_style(font_size=54)

    assert style_service.to_ass_style(style, 1080)["Fontsize"] == 54
    assert style_service.to_ass_style(style, 360)["Fontsize"] == 18
    assert style_service.to_ass_style(style, 2160)["Fontsize"] == 108


def test_a_box_is_drawn_not_libass_bordered():
    """
    The text is always BorderStyle 1; a box replaces its outline and shadow
    and is a drawn rectangle of its own (see test_caption_layout.py).
    BorderStyle 3 boxed each font run separately, and overlapping runs
    burned darker.
    """
    outlined = style_service.to_ass_style(a_style(outline_width=3, box_opacity=0.0), 1080)
    boxed = style_service.to_ass_style(a_style(outline_width=3, shadow=4, box_opacity=0.75), 1080)

    assert outlined["BorderStyle"] == boxed["BorderStyle"] == 1
    assert outlined["Outline"] == 3
    assert (boxed["Outline"], boxed["Shadow"]) == (0, 0)


def test_backcolour_is_the_shadow_colour():
    """
    BackColour is the drop shadow's colour at BorderStyle 1.

    This is the failure mode worth a test of its own, because it is silent. If
    it carried the box colour at box_opacity 0, ASS would be handed an alpha of
    0xFF — and ASS alpha is *transparency* — so the shadow would render
    exactly as asked and be completely invisible.
    """
    shadowed = style_service.to_ass_style(
        a_style(box_opacity=0.0, shadow=4, shadow_color="#FF0000"), 1080
    )

    # Opaque (alpha 00) and the shadow's own colour, in ASS's backwards BGR.
    assert shadowed["BackColour"] == "&H000000FF"
    assert shadowed["Shadow"] == 4


def test_shadow_and_tracking_scale_with_the_frame():
    """Every reference-pixel length has to scale, not just the font size."""
    style = a_style(box_opacity=0.0, shadow=6, letter_spacing=4)

    assert style_service.to_ass_style(style, 1080)["Shadow"] == 6
    assert style_service.to_ass_style(style, 360)["Shadow"] == 2
    assert style_service.to_ass_style(style, 1080)["Spacing"] == 4
    assert style_service.to_ass_style(style, 2160)["Spacing"] == 8


def test_presets_set_every_styling_field():
    """
    A preset is "make it look like this", so a field it omits is a field left
    at whatever the user last chose — pick YouTube and keep your shadow.

    Checked against the model's own columns so a new one cannot be added to the
    schema and forgotten in three preset dicts.
    """
    expected = set(style_service.default_style_fields())

    for name, preset in style_service.PRESETS.items():
        assert set(preset) == expected, (
            f"preset {name!r} is missing {sorted(expected - set(preset))} "
            f"and has unknown {sorted(set(preset) - expected)}"
        )


def test_ass_booleans_are_minus_one():
    """libass reads 1 as false here; only -1 is true."""
    rendered = style_service.to_ass_style(
        a_style(bold=True, italic=False, underline=True, strikeout=False), 1080
    )
    assert rendered["Bold"] == -1
    assert rendered["Italic"] == 0
    assert rendered["Underline"] == -1
    assert rendered["StrikeOut"] == 0


def test_defaults_come_from_the_columns_not_an_unsaved_instance():
    """
    SQLAlchemy applies `default=` at flush, so CaptionStyle() is all None.

    Resetting a style by reading an unsaved instance would write nulls into
    NOT NULL columns.
    """
    assert CaptionStyle(video_id=1).font_key is None

    defaults = style_service.default_style_fields()
    # Pinned deliberately, so changing what a new style opens on has to be a
    # decision someone makes rather than one that slips through.
    assert defaults["font_key"] == "poppins"
    assert defaults["text_color"] == "#FFFFFF"
    assert "id" not in defaults and "video_id" not in defaults


# ── The preview/render contract ──────────────────────────────────────────


def _render_with_libass(style: CaptionStyle, height: int, tmp_path) -> str:
    """Burn one frame and hand back FFmpeg's verbose log."""
    import subprocess

    width = round(height * 16 / 9)
    ass = tmp_path / "style.ass"
    ass.write_text(
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {width}\nPlayResY: {height}\n\n"
        f"{style_service.to_ass_style_block(style, height)}\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        "Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,the quick brown fox\n"
    )

    result = subprocess.run(
        [
            "ffmpeg", "-v", "verbose", "-y",
            "-f", "lavfi", "-i", f"color=c=navy:s={width}x{height}:d=1",
            "-vf", f"subtitles={ass}",
            "-frames:v", "1", str(tmp_path / "frame.png"),
        ],
        capture_output=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr.decode()[-600:]
    return result.stderr.decode()


@pytest.mark.parametrize("font", style_service.FONTS, ids=lambda f: f.key)
def test_libass_resolves_the_font_we_asked_for(font, tmp_path):
    """
    The whole milestone in one assertion.

    libass substitutes a missing family silently — no error, no warning, just a
    different typeface in the exported video while the browser previewed the
    real one. Its `fontselect` log line is the only place it admits what it
    actually loaded, so that is what gets asserted.

    This is also the test that caught the ASS Format line missing its `Name`
    field: every value shifted one column left, libass read the style name as
    the font name, and quietly rendered in DejaVu.
    """
    style = a_style(font_key=font.key, bold=True, text_color="#FFCC00", outline_width=4)

    log = _render_with_libass(style, 720, tmp_path)

    selection = [line for line in log.splitlines() if "fontselect" in line]
    assert selection, "libass logged no font selection"
    assert font.render_name in selection[0], (
        f"asked for {font.render_name!r}, libass chose: {selection[0].strip()}"
    )


def test_the_style_block_is_self_consistent():
    """Format and Style must describe the same columns, in the same order."""
    lines = style_service.to_ass_style_block(a_style(font_key="sans"), 1080).strip().splitlines()
    header = [f.strip() for f in lines[1].removeprefix("Format:").split(",")]
    values = lines[2].removeprefix("Style:").split(",")

    assert header[0] == "Name", "libass reads positionally; Name must come first"
    assert len(header) == len(values)
    assert values[header.index("Fontname")] == "Liberation Sans"


# ── Routes ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_style_is_created_on_first_read(client, auth_headers, sample_video_bytes):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    response = await client.get(f"/api/videos/{video_id}/style", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["font_key"] == "poppins"
    assert body["text_color"] == "#FFFFFF"
    assert body["reference_height"] == 1080


@pytest.mark.asyncio
async def test_patch_changes_only_what_was_sent(client, auth_headers, sample_video_bytes):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]
    await client.get(f"/api/videos/{video_id}/style", headers=auth_headers)

    response = await client.patch(
        f"/api/videos/{video_id}/style", headers=auth_headers, json={"font_size": 72}
    )

    assert response.status_code == 200
    assert response.json()["font_size"] == 72
    assert response.json()["text_color"] == "#FFFFFF"  # untouched


@pytest.mark.asyncio
async def test_unknown_font_is_rejected(client, auth_headers, sample_video_bytes):
    """An unavailable family would render as a substitute with no warning."""
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    response = await client.patch(
        f"/api/videos/{video_id}/style", headers=auth_headers, json={"font_key": "comic-sans"}
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_malformed_colour_is_rejected(client, auth_headers, sample_video_bytes):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    for bad in ["#FFF", "white", "FFFFFF", "#GGGGGG"]:
        response = await client.patch(
            f"/api/videos/{video_id}/style", headers=auth_headers, json={"text_color": bad}
        )
        assert response.status_code == 422, f"{bad!r} was accepted"


@pytest.mark.asyncio
async def test_the_style_carries_the_fonts_win_span(client, auth_headers, sample_video_bytes):
    """
    libass sizes a face by its whole cell, (usWinAscent + usWinDescent) /
    unitsPerEm, where CSS sizes the em; the preview needs the ratio to agree
    with the export. Measured from the installed files: Liberation Sans is
    (1854 + 434) / 2048, Poppins Bold (1050 + 712) / 1000.
    """
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]
    url = f"/api/videos/{video_id}/style"

    sans = (await client.patch(url, headers=auth_headers, json={"font_key": "sans"})).json()
    assert sans["font_win_span"] == pytest.approx((1854 + 434) / 2048, abs=0.002)
    poppins = (
        await client.patch(url, headers=auth_headers, json={"font_key": "poppins", "bold": True})
    ).json()
    assert poppins["font_win_span"] == pytest.approx(1.762, abs=0.002)


@pytest.mark.asyncio
async def test_reset_and_presets_clear_a_hand_placement(client, auth_headers, sample_video_bytes):
    """
    Reset is "back to the defaults" and a preset names its own position, so
    neither may leave a dragged or resized caption where it was left: both
    put the box back centred, at the default width and line count.
    """
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]
    url = f"/api/videos/{video_id}/style"
    placed = {"pos_x": 0.3, "pos_y": 0.2, "box_width": 0.4, "max_lines": 3}
    back = (0.5, style_service.PLACEMENT_Y["bottom"], None, 2)

    assert (await client.patch(url, headers=auth_headers, json=placed)).json()["pos_x"] == 0.3
    reset = (await client.delete(url, headers=auth_headers)).json()
    assert (reset["pos_x"], reset["pos_y"], reset["box_width"], reset["max_lines"]) == back

    for name, preset in style_service.PRESETS.items():
        await client.patch(url, headers=auth_headers, json=placed)
        applied = (
            await client.post(f"{url}/preset", headers=auth_headers, json={"name": name})
        ).json()
        assert (applied["pos_x"], applied["pos_y"], applied["box_width"], applied["max_lines"]) == (
            0.5, preset["pos_y"], None, 2
        ), name


@pytest.mark.asyncio
async def test_preset_and_reset(client, auth_headers, sample_video_bytes):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    applied = await client.post(
        f"/api/videos/{video_id}/style/preset", headers=auth_headers, json={"name": "tiktok"}
    )
    assert applied.status_code == 200
    assert applied.json()["pos_y"] == style_service.PLACEMENT_Y["middle"]
    assert applied.json()["outline_width"] == 5

    reset = await client.delete(f"/api/videos/{video_id}/style", headers=auth_headers)
    assert reset.status_code == 200
    assert reset.json()["pos_y"] == style_service.PLACEMENT_Y["bottom"]
    assert reset.json()["font_size"] == 54


@pytest.mark.asyncio
async def test_unknown_preset_is_rejected(client, auth_headers, sample_video_bytes):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    response = await client.post(
        f"/api/videos/{video_id}/style/preset", headers=auth_headers, json={"name": "vhs"}
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_another_user_cannot_reach_your_style(
    client, auth_headers, second_user_headers, sample_video_bytes
):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    for method, path, kwargs in [
        ("get", f"/api/videos/{video_id}/style", {}),
        ("patch", f"/api/videos/{video_id}/style", {"json": {"font_size": 20}}),
        ("post", f"/api/videos/{video_id}/style/preset", {"json": {"name": "tiktok"}}),
        ("delete", f"/api/videos/{video_id}/style", {}),
    ]:
        response = await getattr(client, method)(
            path, headers=second_user_headers, **kwargs
        )
        assert response.status_code == 404, f"{method} {path}"


@pytest.mark.asyncio
async def test_deleting_the_video_removes_its_style(
    client, auth_headers, sample_video_bytes, db_session
):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]
    await client.get(f"/api/videos/{video_id}/style", headers=auth_headers)

    await client.delete(f"/api/videos/{video_id}", headers=auth_headers)

    assert await style_service.get_style(db_session, video_id) is None


# ── Placement ────────────────────────────────────────────────────────────
#
# Every caption is placed by its own `\an\pos` and broken into its own lines
# by the layout (services/caption_layout.py); the Style line only carries
# the look. These pin what reaches the ASS file. The layout itself, and what
# libass draws from it, are tested in test_caption_layout.py.


def _a_caption(**overrides):
    from app.models.caption import Caption

    fields = dict(
        start_ms=0, end_ms=5000, text="Placed by hand",
        override_color=None, override_bold=None, override_scale=None,
    )
    return Caption(**{**fields, **overrides})


def _dialogue(doc: str) -> str:
    return next(line for line in doc.splitlines() if line.startswith("Dialogue:"))


def test_every_caption_is_positioned_and_sized_per_event():
    r"""
    The box centre is multiplied by the real frame, because that is what
    becomes PlayResX/Y — the canvas libass measures `\pos` against. A short
    caption well inside the safe area is where it was asked to be.
    """
    style = a_style(pos_x=0.25, pos_y=0.30, alignment=Alignment.CENTER, font_size=54)
    doc = subtitles.to_ass([_a_caption()], style, 1920, 1080)

    assert r"{\an5\pos(480,324)\fs54}" in _dialogue(doc)


def test_placement_and_emphasis_share_one_override_block():
    """Two adjacent blocks are legal ASS, but an empty `{}` is not worth risking."""
    style = a_style(pos_x=0.5, pos_y=0.5, alignment=Alignment.CENTER, font_size=54)
    doc = subtitles.to_ass([_a_caption(override_bold=True)], style, 1920, 1080)
    line = _dialogue(doc)

    assert r"{\an5\pos(960,540)\fs54\b1}" in line
    assert "}{" not in line


def test_libass_never_wraps_or_places_on_its_own():
    r"""
    WrapStyle 2 (no wrapping: only the layout's `\N`) and no margins, so the
    lines and the position in the MP4 are the layout's and nobody else's.
    """
    style = a_style()
    doc = subtitles.to_ass([_a_caption()], style, 1920, 1080)

    assert "WrapStyle: 2" in doc
    fields = style_service.to_ass_style(style, 1080)
    assert (fields["MarginL"], fields["MarginR"], fields["MarginV"]) == (0, 0, 0)


@pytest.mark.asyncio
async def test_placement_round_trips(client, auth_headers, sample_video_bytes):
    """
    The centre, width and line limit are saved as sent. A null width is the
    frame's default again; a null centre or line limit is refused, where it
    used to be the way back to an anchor that no longer exists.
    """
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]
    url = f"/api/videos/{video_id}/style"

    placed = await client.patch(
        url, headers=auth_headers,
        json={"pos_x": 0.37, "pos_y": 0.62, "box_width": 0.6, "max_lines": 3},
    )
    assert placed.status_code == 200
    body = placed.json()
    assert (body["pos_x"], body["pos_y"], body["box_width"], body["max_lines"]) == pytest.approx(
        (0.37, 0.62, 0.6, 3)
    )

    # An unrelated patch must not disturb the placement.
    kept = await client.patch(url, headers=auth_headers, json={"font_size": 72})
    assert kept.json()["pos_x"] == pytest.approx(0.37)

    cleared = await client.patch(url, headers=auth_headers, json={"box_width": None})
    assert cleared.status_code == 200
    assert cleared.json()["box_width"] is None

    for bad in ({"pos_x": None}, {"pos_y": None}, {"max_lines": None}):
        assert (await client.patch(url, headers=auth_headers, json=bad)).status_code == 422, bad


@pytest.mark.asyncio
async def test_width_and_line_limit_are_bounded(client, auth_headers, sample_video_bytes):
    """20% up to the safe area's 94%; one to three lines."""
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]
    url = f"/api/videos/{video_id}/style"

    for bad in ({"box_width": 0.1}, {"box_width": 0.95}, {"max_lines": 0}, {"max_lines": 4}):
        assert (await client.patch(url, headers=auth_headers, json=bad)).status_code == 422, bad
    for good in ({"box_width": 0.2}, {"box_width": 0.94}, {"max_lines": 1}, {"max_lines": 3}):
        assert (await client.patch(url, headers=auth_headers, json=good)).status_code == 200, good


@pytest.mark.asyncio
async def test_placement_outside_the_frame_is_rejected(
    client, auth_headers, sample_video_bytes
):
    """A caption at 1.4 is off the canvas — invisible in the preview and the burn."""
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    for bad in [{"pos_x": 1.4}, {"pos_y": -0.2}]:
        response = await client.patch(
            f"/api/videos/{video_id}/style", headers=auth_headers, json=bad
        )
        assert response.status_code == 422


# ── Migration to the box model ───────────────────────────────────────────


def _alembic(*args: str) -> None:
    import os
    import subprocess
    import sys
    from pathlib import Path

    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=Path(__file__).resolve().parents[1],
        env=os.environ.copy(),
        check=True,
        capture_output=True,
    )


@pytest.mark.asyncio
async def test_old_placements_convert_to_the_box_centre(client, auth_headers, sample_video_bytes):
    """
    c8f2a6d41e93 turns an anchor and margins, or a hand placement by an edge,
    into the box centre a one-line caption had, so old videos look the same:
    in from the edge by the margin, the padding or outline and half the font's
    cell; a left- or right-aligned one half the default width further in.
    """
    from sqlalchemy import text

    from app.database import AsyncSessionLocal, engine

    ids = [(await upload(client, auth_headers, sample_video_bytes)).json()["id"] for _ in range(4)]
    for video_id in ids:
        await client.get(f"/api/videos/{video_id}/style", headers=auth_headers)
    await engine.dispose()
    _alembic("downgrade", "b4e7c2d91a36")
    try:
        old = [
            # anchored top-left, margins 100 / 60, outline 3, size 54
            dict(position="top", alignment="left", margin_v=100, margin_h=60, pos_x=None, pos_y=None, box_opacity=0),
            # anchored bottom-centre, boxed with padding 10
            dict(position="bottom", alignment="center", margin_v=60, margin_h=60, pos_x=None, pos_y=None, box_opacity=0.7),
            # hand-placed, centred: already its centre
            dict(position="bottom", alignment="center", margin_v=60, margin_h=60, pos_x=0.3, pos_y=0.2, box_opacity=0),
            # hand-placed by its left edge
            dict(position="bottom", alignment="left", margin_v=60, margin_h=60, pos_x=0.1, pos_y=0.6, box_opacity=0),
        ]
        async with AsyncSessionLocal() as session:
            for video_id, fields in zip(ids, old):
                await session.execute(
                    text(
                        "UPDATE caption_styles SET position = CAST(:position AS caption_vertical_position),"
                        " alignment = CAST(:alignment AS caption_alignment), margin_v = :margin_v,"
                        " margin_h = :margin_h, pos_x = :pos_x, pos_y = :pos_y, box_opacity = :box_opacity,"
                        " box_padding = 10, outline_width = 3, font_size = 54 WHERE video_id = :id"
                    ),
                    {**fields, "id": video_id},
                )
            await session.commit()
        await engine.dispose()
    finally:
        _alembic("upgrade", "head")

    got = [(await client.get(f"/api/videos/{i}/style", headers=auth_headers)).json() for i in ids]
    assert (got[0]["pos_x"], got[0]["pos_y"]) == pytest.approx((60 / 1920 + 0.4, (100 + 3 + 27) / 1080))
    assert (got[1]["pos_x"], got[1]["pos_y"]) == pytest.approx((0.5, 1 - (60 + 10 + 27) / 1080))
    assert (got[2]["pos_x"], got[2]["pos_y"]) == pytest.approx((0.3, 0.2))
    assert (got[3]["pos_x"], got[3]["pos_y"]) == pytest.approx((0.5, 0.6))
    assert all(g["box_width"] is None and g["max_lines"] == 2 for g in got)
