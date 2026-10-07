"""
Turning caption rows into subtitle files.

Four formats, three of them sidecars (SRT, VTT, JSON) and one an ASS document
used only as an intermediate — it is what gets handed to libass to burn text
into pixels.

Nothing here rewrites caption text. The words that reach a subtitle file are
the words in the database, which are the words Whisper heard.
"""

import json
from collections.abc import Sequence

from app.models.caption import Caption
from app.models.caption_style import CaptionStyle
from app.services.caption_style import (
    scale_for,
    to_ass_free_alignment,
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


def to_srt(captions: Sequence[Caption]) -> str:
    """
    SubRip. Indices are 1-based and must be contiguous — some players stop at
    the first gap, so this numbers the output rather than using `sequence`,
    which is 0-based and could have been renumbered by an edit.
    """
    blocks = [
        f"{index}\n{srt_time(c.start_ms)} --> {srt_time(c.end_ms)}\n{c.text.strip()}\n"
        for index, c in enumerate(captions, start=1)
    ]
    return "\n".join(blocks)


def to_vtt(captions: Sequence[Caption]) -> str:
    """WebVTT. The `WEBVTT` header is mandatory; browsers reject the file without it."""
    blocks = [
        f"{vtt_time(c.start_ms)} --> {vtt_time(c.end_ms)}\n{c.text.strip()}\n"
        for c in captions
    ]
    return "WEBVTT\n\n" + "\n".join(blocks)


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


def _emphasis_tags(caption: Caption, style: CaptionStyle, scale: float) -> list[str]:
    """
    Inline override tags for a caption that carries emphasis.

    These are the ASS equivalent of the per-caption overrides the editor shows:
    the same three fields, applied to one line instead of the whole video.
    """
    tags = []

    if caption.override_color is not None:
        tags.append(f"\\c{to_ass_inline_colour(caption.override_color)}")
    if caption.override_bold is not None:
        tags.append(f"\\b{1 if caption.override_bold else 0}")
    if caption.override_scale is not None:
        tags.append(f"\\fs{round(style.font_size * caption.override_scale * scale)}")

    return tags


def _placement_tags(style: CaptionStyle, width: int, height: int) -> list[str]:
    """
    Inline override tags for a caption the user placed by hand.

    Empty for an anchored style, which is the default and every existing row:
    the Style line's own Alignment and margins already say where the text goes,
    and adding `\\pos` would only restate it less clearly.

    When `pos_x`/`pos_y` are set they are fractions of the frame, so they are
    multiplied by the real video size here — the same size that becomes
    PlayResX/Y, which is the canvas libass measures `\\pos` against.

    What this does *not* touch is the wrap width. MarginL/MarginR keep working
    under `\\pos` (verified by burning the same line both ways: 700px margins
    wrapped six lines wide either way), so the Style line is still the one
    place line breaking is decided and the preview only has to mirror it once.
    """
    if style.pos_x is None or style.pos_y is None:
        return []

    return [
        f"\\an{to_ass_free_alignment(style)}",
        f"\\pos({round(style.pos_x * width)},{round(style.pos_y * height)})",
    ]


def to_ass(captions: Sequence[Caption], style: CaptionStyle, width: int, height: int) -> str:
    """
    A full ASS document: script header, the M7 style, and one Dialogue per caption.

    `PlayResX/Y` must be the real video size. libass scales everything it draws
    to this virtual canvas, so if it disagrees with the frame the captions come
    out the wrong size — which is exactly the preview/export mismatch the whole
    styling milestone was built to avoid.
    """
    scale = scale_for(height)

    events = [
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for caption in captions:
        # `uppercase` is the one style field ASS cannot express, so it is applied
        # to the text instead of to the Style line. Only here: the stored caption
        # and the SRT/VTT sidecars keep their original case, because this is how
        # the captions are *drawn on the video*, not what they say.
        body = caption.text.upper() if style.uppercase else caption.text
        # One override block rather than two adjacent ones. Both are legal ASS,
        # but placement and emphasis are independent and either can be empty,
        # so building the list first is the version with no empty `{}` in it.
        tags = _placement_tags(style, width, height) + _emphasis_tags(caption, style, scale)
        prefix = "{" + "".join(tags) + "}" if tags else ""
        text = prefix + escape_ass_text(body)
        events.append(
            f"Dialogue: 0,{ass_time(caption.start_ms)},{ass_time(caption.end_ms)},"
            f"Default,,0,0,0,,{text}"
        )

    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "WrapStyle: 0\n"
        # Without this libass ignores PlayResX/Y for scaling and the sizes drift.
        "ScaledBorderAndShadow: yes\n"
        f"PlayResX: {width}\n"
        f"PlayResY: {height}\n"
        "\n"
        f"{to_ass_style_block(style, height)}"
        "\n" + "\n".join(events) + "\n"
    )
