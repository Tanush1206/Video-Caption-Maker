"""
Turning caption rows into subtitle files.

Four formats, three of them sidecars (SRT, VTT, JSON) and one an ASS document
used only as an intermediate — it is what gets handed to libass to burn text
into pixels.

Nothing here rewrites caption text. The words that reach a subtitle file are
the words in the database, which are the words Whisper heard.
"""

import json
from collections.abc import Iterator, Sequence

from app.models.caption import Caption
from app.models.caption_style import Alignment, CaptionStyle
from app.services.caption_layout import Layout, Line, Measurer, layout_caption
from app.services.caption_style import (
    font_win_span,
    get_font,
    script_font_span,
    to_ass_alignment,
    to_ass_inline_colour,
    to_ass_style_block,
)


def _clock(ms: int, *, decimal: str, places: int) -> str:
    """HH:MM:SS<sep>fraction, shared by the formats that only differ in punctuation."""
    ms = max(0, ms)
    hours, remainder = divmod(ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1000)

    fraction = millis if places == 3 else millis // 10
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}{decimal}{fraction:0{places}d}"


def srt_time(ms: int) -> str:
    """SRT uses a comma for the decimal separator. VTT uses a full stop."""
    return _clock(ms, decimal=",", places=3)


def vtt_time(ms: int) -> str:
    return _clock(ms, decimal=".", places=3)


def ass_time(ms: int) -> str:
    """
    ASS wants H:MM:SS.cc — an unpadded hour and **centiseconds**, not
    milliseconds. Writing three digits there silently shifts every caption.

    Built directly rather than by trimming `_clock`'s output: stripping the
    leading zero off "00:00:00.00" takes both of them and yields ":00:00.00".
    """
    ms = max(0, ms)
    hours, remainder = divmod(ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1000)
    return f"{hours}:{minutes:02d}:{seconds:02d}.{millis // 10:02d}"


def to_srt(captions: Sequence[Caption], texts: Sequence[str] | None = None) -> str:
    """
    SubRip. Indices are 1-based and must be contiguous — some players stop at
    the first gap, so this numbers the output rather than using `sequence`,
    which is 0-based and could have been renumbered by an edit.

    `texts` are the captions as the burn breaks them (`laid_out_texts`); the
    stored text, manual breaks and all, when there is no frame to lay out on.
    """
    texts = texts or [c.text.strip() for c in captions]
    blocks = [
        f"{index}\n{srt_time(c.start_ms)} --> {srt_time(c.end_ms)}\n{text}\n"
        for index, (c, text) in enumerate(zip(captions, texts), start=1)
    ]
    return "\n".join(blocks)


def to_vtt(captions: Sequence[Caption], texts: Sequence[str] | None = None) -> str:
    """WebVTT. The `WEBVTT` header is mandatory; browsers reject the file without it."""
    texts = texts or [c.text.strip() for c in captions]
    blocks = [
        f"{vtt_time(c.start_ms)} --> {vtt_time(c.end_ms)}\n{text}\n"
        for c, text in zip(captions, texts)
    ]
    return "WEBVTT\n\n" + "\n".join(blocks)


def _layouts(
    captions: Sequence[Caption], style: CaptionStyle, width: int, height: int
) -> Iterator[tuple[Caption, Layout, bool]]:
    """Every caption laid out on this frame, as the burn draws it."""
    measurers = {bold: Measurer(style, bold) for bold in (False, True)}
    for caption in captions:
        bold = style.bold if caption.override_bold is None else caption.override_bold
        layout = layout_caption(
            caption.text,
            style,
            width,
            height,
            override_scale=caption.override_scale,
            bold=bold,
            measurer=measurers[bold],
        )
        yield caption, layout, bold


def _in_original_case(text: str, lines: Sequence[str], uppercase: bool) -> list[str]:
    """
    The laid-out lines, cut from the caption's own text.

    The layout works on what is drawn, which is upper-cased for an uppercase
    style, and SRT/VTT keep the words as they are. Each line is the same run
    of letters in the original: counted without spaces, and with each
    original letter counting as many as its capital has (German ß is SS).
    """
    out, pos = [], 0
    for line in lines:
        need = sum(1 for ch in line if not ch.isspace())
        start, got = pos, 0
        while pos < len(text) and (got < need or text[pos].isspace() and got == 0):
            ch = text[pos]
            if not ch.isspace():
                got += len(ch.upper()) if uppercase else 1
            pos += 1
        out.append(" ".join(text[start:pos].split()))
    return out


def laid_out_texts(
    captions: Sequence[Caption], style: CaptionStyle, width: int, height: int
) -> list[str]:
    """
    Each caption's text broken into the lines the burn draws, for SRT and VTT.

    The same layout as the MP4 (manual breaks, line style, box width, font
    shrink) on the video's own frame, so a sidecar breaks where the burn does.
    """
    return [
        "\n".join(_in_original_case(caption.text, layout.text, style.uppercase))
        for caption, layout, _ in _layouts(captions, style, width, height)
    ]


def to_json(captions: Sequence[Caption]) -> str:
    """
    Machine-readable, and the only format that keeps confidence and emphasis.

    Milliseconds stay integers rather than becoming float seconds — the whole
    reason they are stored that way is that float timing comparisons lie.
    """
    return json.dumps(
        {
            "captions": [
                {
                    "index": index,
                    "start_ms": c.start_ms,
                    "end_ms": c.end_ms,
                    "text": c.text,
                    "confidence": c.confidence,
                    "emphasis": (
                        None
                        if c.override_bold is None
                        and c.override_color is None
                        and c.override_scale is None
                        else {
                            "color": c.override_color,
                            "bold": c.override_bold,
                            "scale": c.override_scale,
                        }
                    ),
                }
                for index, c in enumerate(captions, start=1)
            ]
        },
        indent=2,
    )


def escape_ass_text(text: str) -> str:
    """
    Make caption text safe to put in a Dialogue line.

    `{` opens an override block in ASS, so a caption containing one would have
    part of itself swallowed as formatting — or, worse, interpreted. Braces are
    substituted rather than escaped because libass has no reliable escape for
    them, and a visible parenthesis is better than a vanished word.

    Newlines become `\\N`, ASS's hard line break. A raw newline would end the
    Dialogue line and orphan the rest of the caption.
    """
    return (
        text.replace("{", "(")
        .replace("}", ")")
        .replace("\r\n", "\n")
        .replace("\n", "\\N")
        .strip()
    )


def _emphasis_tags(caption: Caption) -> list[str]:
    """
    Inline override tags for a caption that carries emphasis.

    These are the ASS equivalent of the per-caption overrides the editor shows,
    applied to one line instead of the whole video. The third, the size, is
    part of the layout (`_layout_tags`), because it changes where lines break.
    """
    tags = []

    if caption.override_color is not None:
        tags.append(f"\\c{to_ass_inline_colour(caption.override_color)}")
    if caption.override_bold is not None:
        tags.append(f"\\b{1 if caption.override_bold else 0}")

    return tags


def _num(value: float) -> str:
    """A coordinate or size for a tag: two decimals at most, no trailing zeros."""
    return f"{round(value, 2):g}"


def _script_runs(layout_line: Line, style: CaptionStyle, size: float, bold: bool) -> str:
    """
    One laid-out line, with each script word in its own font at the caption font's em.

    `size` is the caption's Fontsize as libass will apply it. libass makes a
    face's whole cell that size, so a script font with a different win span
    has to be asked for at `size * its span / the caption font's span` to come
    out with the same em — the em the browser draws it at (see SCRIPT_FONTS).
    Afterwards the caption's own font and size are put back. The words are the
    layout's segments, so the burn draws each in the font it was measured in.
    """
    primary = get_font(style.font_key).render_name
    primary_span = font_win_span(style.font_key, bold)
    out = []
    for segment in layout_line.segments:
        # Braces only: `escape_ass_text` also strips, and a segment's edge is
        # often the space between two words. A laid-out line has no newlines.
        text = segment.text.replace("{", "(").replace("}", ")")
        if segment.family is None:
            out.append(text)
            continue
        scaled = size * script_font_span(segment.family, bold) / primary_span
        out.append(
            f"{{\\fn{segment.family}\\fs{_num(scaled)}}}{text}"
            f"{{\\fn{primary}\\fs{_num(size)}}}"
        )
    return "".join(out)


def _box_event(layout: Layout, style: CaptionStyle) -> str:
    r"""
    The caption's box, as a filled rectangle drawn under its text.

    `\p1` draws in frame pixels from `\pos` at `\an7` (the top-left corner),
    so the rectangle is the layout's to the hundredth of a pixel — the one
    the preview paints. Filled with `\1c`/`\1a`: no outline, no shadow.
    """
    alpha = round((1.0 - max(0.0, min(1.0, style.box_opacity))) * 255)
    w, h = _num(layout.width), _num(layout.height)
    return (
        f"{{\\an7\\pos({_num(layout.x)},{_num(layout.y)})\\bord0\\shad0"
        f"\\1c{to_ass_inline_colour(style.box_color)}\\1a&H{alpha:02X}&\\p1}}"
        f"m 0 0 l {w} 0 {w} {h} 0 {h}{{\\p0}}"
    )


def _layout_tags(layout: Layout, style: CaptionStyle) -> list[str]:
    """
    Where the laid-out caption goes, and at what size.

    `\\an4/5/6` with `\\pos` at the vertical middle of the lines and their left
    edge, centre or right edge — the padding is inside the layout's rectangle,
    and libass draws it outside the text. Fractions of a pixel are kept: libass
    takes them, and the clamp is measured to them.
    """
    if style.alignment == Alignment.LEFT:
        x = layout.x + layout.pad
    elif style.alignment == Alignment.RIGHT:
        x = layout.x + layout.width - layout.pad
    else:
        x = layout.x + layout.width / 2
    y = layout.y + layout.height / 2
    return [
        f"\\an{to_ass_alignment(style)}",
        f"\\pos({_num(x)},{_num(y)})",
        f"\\fs{_num(layout.size)}",
    ]


def to_ass(captions: Sequence[Caption], style: CaptionStyle, width: int, height: int) -> str:
    """
    A full ASS document: script header, the M7 style, and one Dialogue per caption.

    `PlayResX/Y` must be the real video size. libass scales everything it draws
    to this virtual canvas, so if it disagrees with the frame the captions come
    out the wrong size — which is exactly the preview/export mismatch the whole
    styling milestone was built to avoid.
    """
    events = [
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    # `uppercase` is the one style field ASS cannot express, so the layout
    # applies it to the text instead of to the Style line. Only here: the
    # stored caption and the SRT/VTT sidecars keep their original case,
    # because this is how the captions are *drawn on the video*.
    for caption, layout, bold in _layouts(captions, style, width, height):
        tags = _layout_tags(layout, style) + _emphasis_tags(caption)
        text = "{" + "".join(tags) + "}" + "\\N".join(
            _script_runs(line, style, layout.size, bold) for line in layout.lines
        )
        span = f"{ass_time(caption.start_ms)},{ass_time(caption.end_ms)}"
        # The box on layer 0, the text above it on layer 1.
        if style.box_opacity > 0:
            events.append(f"Dialogue: 0,{span},Default,,0,0,0,,{_box_event(layout, style)}")
        events.append(f"Dialogue: 1,{span},Default,,0,0,0,,{text}")

    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        # 2: no wrapping at all. The lines are the layout's, broken with `\N`,
        # and libass must not break them again.
        "WrapStyle: 2\n"
        # Without this libass ignores PlayResX/Y for scaling and the sizes drift.
        "ScaledBorderAndShadow: yes\n"
        f"PlayResX: {width}\n"
        f"PlayResY: {height}\n"
        "\n"
        f"{to_ass_style_block(style, height)}"
        "\n" + "\n".join(events) + "\n"
    )
