import pytest

from app.models.caption_style import Alignment, CaptionStyle, VerticalPosition
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
    ("position", "alignment", "expected"),
    [
        (VerticalPosition.BOTTOM, Alignment.LEFT, 1),
        (VerticalPosition.BOTTOM, Alignment.CENTER, 2),
        (VerticalPosition.MIDDLE, Alignment.CENTER, 5),
        (VerticalPosition.TOP, Alignment.RIGHT, 9),
    ],
)
def test_alignment_follows_the_numeric_keypad(position, alignment, expected):
    style = a_style(position=position, alignment=alignment)
    assert style_service.to_ass_alignment(style) == expected


# ── Resolution independence ──────────────────────────────────────────────


def test_sizes_scale_with_video_height():
    """
    One style has to mean the same thing on a 360p and a 4K video.

    Sizes are stored against a 1080p canvas, so a 54px caption is 18px on 360p
    and 108px on 2160p — the same fraction of the frame in all three.
    """
    style = a_style(font_size=54, margin_v=60)

    assert style_service.to_ass_style(style, 1080)["Fontsize"] == 54
    assert style_service.to_ass_style(style, 360)["Fontsize"] == 18
    assert style_service.to_ass_style(style, 2160)["Fontsize"] == 108
    assert style_service.to_ass_style(style, 360)["MarginV"] == 20


def test_a_box_switches_border_style_and_keeps_padding():
    outlined = style_service.to_ass_style(a_style(outline_width=0, box_opacity=0.0), 1080)
    boxed = style_service.to_ass_style(a_style(outline_width=0, box_opacity=0.75), 1080)

    assert outlined["BorderStyle"] == 1
    assert boxed["BorderStyle"] == 3
    # At BorderStyle 3 the Outline field is the box's padding. Leaving it at
    # the user's 0 would print text touching the edges of its own background.
    assert boxed["Outline"] > 0


def test_backcolour_follows_whichever_thing_is_being_drawn():
    """
    BackColour is the box fill at BorderStyle 3 and the shadow colour at 1.

    This is the failure mode worth a test of its own, because it is silent. If
    an unboxed style kept the box colour at box_opacity, ASS would be handed an
    alpha of 0 — and ASS alpha is *transparency* — so the shadow would render
    exactly as asked and be completely invisible.
    """
    shadowed = style_service.to_ass_style(
        a_style(box_opacity=0.0, shadow=4, shadow_color="#FF0000"), 1080
    )
    boxed = style_service.to_ass_style(
        a_style(box_opacity=0.75, shadow=4, box_color="#0000FF"), 1080
    )

    # Opaque (alpha 00) and the shadow's own colour, in ASS's backwards BGR.
    assert shadowed["BackColour"] == "&H000000FF"
    assert shadowed["Shadow"] == 4

    # Boxed: the box wins the field, and the shadow is not drawn at all rather
    # than drawn in the box's colour on top of the box.
    assert boxed["BackColour"] == "&H40FF0000"
    assert boxed["Shadow"] == 0


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
async def test_preset_and_reset(client, auth_headers, sample_video_bytes):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    applied = await client.post(
        f"/api/videos/{video_id}/style/preset", headers=auth_headers, json={"name": "tiktok"}
    )
    assert applied.status_code == 200
    assert applied.json()["position"] == "middle"
    assert applied.json()["outline_width"] == 5

    reset = await client.delete(f"/api/videos/{video_id}/style", headers=auth_headers)
    assert reset.status_code == 200
    assert reset.json()["position"] == "bottom"
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


# ── Free placement ───────────────────────────────────────────────────────
#
# Dragging the caption stores an x/y fraction instead of an anchor, and the
# burn expresses it with a per-event `\pos()` override rather than the Style
# line. These pin the two halves of that: that the override is only emitted
# when it was asked for, and that it says what the preview is drawing.


def _a_caption(**overrides):
    from app.models.caption import Caption

    fields = dict(
        start_ms=0, end_ms=5000, text="Placed by hand",
        override_color=None, override_bold=None, override_scale=None,
    )
    return Caption(**{**fields, **overrides})


def _dialogue(doc: str) -> str:
    return next(line for line in doc.splitlines() if line.startswith("Dialogue:"))


@pytest.mark.parametrize(
    ("alignment", "expected"),
    [(Alignment.LEFT, 4), (Alignment.CENTER, 5), (Alignment.RIGHT, 6)],
)
def test_free_alignment_stays_on_the_middle_row(alignment, expected):
    r"""
    `\an` sets both the meaning of `\pos` and how wrapped lines justify.

    The horizontal half has to follow the caption's alignment or a wrapped line
    would justify differently in the two renderers. The vertical half is pinned
    to the middle so that `pos_y` means "the vertical centre of the text" on
    both sides — which is what CSS `translate(-50%)` gives it.
    """
    style = a_style(alignment=alignment)
    assert style_service.to_ass_free_alignment(style) == expected


def test_an_anchored_caption_carries_no_position_override():
    """The default, and every style that existed before this feature."""
    doc = subtitles.to_ass([_a_caption()], a_style(), 1920, 1080)

    assert r"\pos" not in _dialogue(doc)
    assert r"\an" not in _dialogue(doc)


def test_a_hand_placed_caption_is_positioned_per_event():
    r"""
    The fractions are multiplied by the real frame, because that is what
    becomes PlayResX/Y — the canvas libass measures `\pos` against.
    """
    style = a_style(pos_x=0.25, pos_y=0.30, alignment=Alignment.CENTER)
    doc = subtitles.to_ass([_a_caption()], style, 1920, 1080)

    assert r"{\an5\pos(480,324)}" in _dialogue(doc)


def test_placement_and_emphasis_share_one_override_block():
    """Two adjacent blocks are legal ASS, but an empty `{}` is not worth risking."""
    style = a_style(pos_x=0.5, pos_y=0.5, alignment=Alignment.CENTER)
    doc = subtitles.to_ass([_a_caption(override_bold=True)], style, 1920, 1080)
    line = _dialogue(doc)

    assert r"{\an5\pos(960,540)\b1}" in line
    assert "}{" not in line


def test_free_placement_keeps_the_horizontal_margins():
    r"""
    `\pos` takes over the position and nothing else.

    libass still breaks lines at PlayResX minus MarginL/MarginR under `\pos` —
    burning the same line both ways at a 700px margin gives six lines, 498px
    wide, either way. So `margin_h` stays meaningful and the Style line remains
    the single place line breaking is decided.
    """
    style = a_style(pos_x=0.5, pos_y=0.5, margin_h=120)

    assert style_service.to_ass_style(style, 1080)["MarginL"] == 120
    assert style_service.to_ass_style(style, 1080)["MarginR"] == 120


@pytest.mark.asyncio
async def test_placement_round_trips_and_can_be_cleared(
    client, auth_headers, sample_video_bytes
):
    """
    Clearing is the placement grid putting a dragged caption back on an anchor.

    It only works because the route applies the patch with `exclude_unset`
    rather than `exclude_none`: an explicit null has to reach the column, where
    an omitted field must not.
    """
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]
    await client.get(f"/api/videos/{video_id}/style", headers=auth_headers)

    placed = await client.patch(
        f"/api/videos/{video_id}/style",
        headers=auth_headers,
        json={"pos_x": 0.37, "pos_y": 0.62},
    )
    assert placed.status_code == 200
    assert placed.json()["pos_x"] == pytest.approx(0.37)
    assert placed.json()["pos_y"] == pytest.approx(0.62)

    # An unrelated patch must not disturb the placement.
    kept = await client.patch(
        f"/api/videos/{video_id}/style", headers=auth_headers, json={"font_size": 72}
    )
    assert kept.json()["pos_x"] == pytest.approx(0.37)

    cleared = await client.patch(
        f"/api/videos/{video_id}/style",
        headers=auth_headers,
        json={"pos_x": None, "pos_y": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["pos_x"] is None
    assert cleared.json()["pos_y"] is None


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
