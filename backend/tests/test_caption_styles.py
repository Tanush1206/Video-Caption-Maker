import pytest

from app.models.caption_style import Alignment, CaptionStyle, VerticalPosition
from app.services import caption_style as style_service


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
    style = CaptionStyle(video_id=1, position=position, alignment=alignment)
    assert style_service.to_ass_alignment(style) == expected


# ── Resolution independence ──────────────────────────────────────────────


def test_sizes_scale_with_video_height():
    """
    One style has to mean the same thing on a 360p and a 4K video.

    Sizes are stored against a 1080p canvas, so a 54px caption is 18px on 360p
    and 108px on 2160p — the same fraction of the frame in all three.
    """
    style = CaptionStyle(
        video_id=1,
        font_key="sans",
        font_size=54,
        bold=False,
        italic=False,
        text_color="#FFFFFF",
        outline_color="#000000",
        outline_width=3,
        box_color="#000000",
        box_opacity=0.0,
        position=VerticalPosition.BOTTOM,
        alignment=Alignment.CENTER,
        margin_v=60,
        margin_h=60,
    )

    assert style_service.to_ass_style(style, 1080)["Fontsize"] == 54
    assert style_service.to_ass_style(style, 360)["Fontsize"] == 18
    assert style_service.to_ass_style(style, 2160)["Fontsize"] == 108
    assert style_service.to_ass_style(style, 360)["MarginV"] == 20


def test_a_box_switches_border_style_and_keeps_padding():
    base = dict(
        video_id=1, font_key="sans", font_size=54, bold=False, italic=False,
        text_color="#FFFFFF", outline_color="#000000", outline_width=0,
        box_color="#000000", position=VerticalPosition.BOTTOM,
        alignment=Alignment.CENTER, margin_v=60, margin_h=60,
    )

    outlined = style_service.to_ass_style(CaptionStyle(**base, box_opacity=0.0), 1080)
    boxed = style_service.to_ass_style(CaptionStyle(**base, box_opacity=0.75), 1080)

    assert outlined["BorderStyle"] == 1
    assert boxed["BorderStyle"] == 3
    # At BorderStyle 3 the Outline field is the box's padding. Leaving it at
    # the user's 0 would print text touching the edges of its own background.
    assert boxed["Outline"] > 0


def test_ass_booleans_are_minus_one():
    """libass reads 1 as false here; only -1 is true."""
    style = CaptionStyle(video_id=1, bold=True, italic=False, box_opacity=0.0,
                         font_key="sans", font_size=54, text_color="#FFFFFF",
                         outline_color="#000000", outline_width=2, box_color="#000000",
                         position=VerticalPosition.BOTTOM, alignment=Alignment.CENTER,
                         margin_v=60, margin_h=60)

    rendered = style_service.to_ass_style(style, 1080)
    assert rendered["Bold"] == -1
    assert rendered["Italic"] == 0


def test_defaults_come_from_the_columns_not_an_unsaved_instance():
    """
    SQLAlchemy applies `default=` at flush, so CaptionStyle() is all None.

    Resetting a style by reading an unsaved instance would write nulls into
    NOT NULL columns.
    """
    assert CaptionStyle(video_id=1).font_key is None

    defaults = style_service.default_style_fields()
    assert defaults["font_key"] == "sans"
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
    style = CaptionStyle(
        video_id=1, font_key=font.key, font_size=54, bold=True, italic=False,
        text_color="#FFCC00", outline_color="#000000", outline_width=4,
        box_color="#000000", box_opacity=0.0,
        position=VerticalPosition.BOTTOM, alignment=Alignment.CENTER,
        margin_v=60, margin_h=60,
    )

    log = _render_with_libass(style, 720, tmp_path)

    selection = [line for line in log.splitlines() if "fontselect" in line]
    assert selection, "libass logged no font selection"
    assert font.render_name in selection[0], (
        f"asked for {font.render_name!r}, libass chose: {selection[0].strip()}"
    )


def test_the_style_block_is_self_consistent():
    """Format and Style must describe the same columns, in the same order."""
    style = CaptionStyle(
        video_id=1, font_key="sans", font_size=54, bold=False, italic=False,
        text_color="#FFFFFF", outline_color="#000000", outline_width=3,
        box_color="#000000", box_opacity=0.0,
        position=VerticalPosition.BOTTOM, alignment=Alignment.CENTER,
        margin_v=60, margin_h=60,
    )

    lines = style_service.to_ass_style_block(style, 1080).strip().splitlines()
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
    assert body["font_key"] == "sans"
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
