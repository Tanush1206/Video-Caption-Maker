from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.caption_style import REFERENCE_HEIGHT, Alignment, LineStyle
from app.services import font_library
from app.services.caption_style import (
    FONTS_BY_KEY,
    PRESETS,
    font_win_span,
    get_font,
    script_font_span,
    script_fonts,
)

# #RRGGBB only. Short form (#FFF) and named colours are rejected rather than
# normalised: the ASS conversion slices fixed byte positions out of this string,
# so accepting a second shape would mean two code paths that must agree forever.
HEX_COLOUR = r"^#(?:[0-9a-fA-F]{6})$"


class ScriptFont(BaseModel):
    family: str
    chars: str
    span: float


class CaptionStyleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    video_id: int
    font_key: str
    font_size: int
    bold: bool
    italic: bool
    underline: bool
    strikeout: bool
    uppercase: bool
    letter_spacing: int
    text_color: str
    outline_color: str
    outline_width: int
    shadow: int
    shadow_color: str
    box_color: str
    box_opacity: float
    box_padding: int
    alignment: Alignment
    # The box's centre, as fractions of the frame (see the model).
    pos_x: float
    pos_y: float
    # Null: the default for the frame's shape, which the client resolves the
    # same way the layout does (caption_layout.default_width).
    box_width: float | None = None
    max_lines: int = 2
    line_style: LineStyle = LineStyle.BALANCED
    words_per_line: int = 2

    # Echoed so the client never has to hardcode it to size the preview.
    reference_height: int = REFERENCE_HEIGHT

    # Resolved from font_key below, not stored.
    #
    # The overlay needs a CSS family for whatever font is selected, and with
    # 1301 of them the client can no longer look that up in a list it already
    # holds. Deciding it here keeps the rule that the pairing between what
    # libass renders and what the browser is asked for lives in one place,
    # server-side — which is the same reason FontRead carries css_stack.
    font_family: str = ""
    font_css_stack: str = ""
    # (usWinAscent + usWinDescent) / unitsPerEm of the face libass will use:
    # libass makes that span the font size, CSS makes the em the font size,
    # so the preview divides by this (see caption_style.font_win_span).
    font_win_span: float = 1.0
    # The faces the preview must list before the caption font, each limited to
    # its script by unicode-range: the same faces the burn names per run
    # (caption_style.script_fonts). Cyrillic is in it only for a caption font
    # that has no Cyrillic of its own.
    script_font_stack: str = ""
    # The same faces as data, for the editor's copy of the layout rule: which
    # characters each draws (a regex character class, as the burn matches
    # them) and its win span, which sets the height of a line it is on.
    script_fonts: list[ScriptFont] = []

    @model_validator(mode="after")
    def resolve_font(self) -> "CaptionStyleRead":
        font = get_font(self.font_key)
        self.font_family = font.render_name
        self.font_css_stack = font.css_stack
        self.font_win_span = round(font_win_span(self.font_key, self.bold), 4)
        faces = script_fonts(self.font_key, self.bold)
        self.script_font_stack = ", ".join(f'"{family}"' for family, _ in faces)
        self.script_fonts = [
            ScriptFont(family=family, chars=chars, span=round(script_font_span(family, self.bold), 4))
            for family, chars in faces
        ]
        return self


class CaptionStyleUpdate(BaseModel):
    """
    Every field optional — the panel sends the one knob that moved.

    The bounds are not cosmetic. A font size of 400 reference pixels covers a
    1080p frame with two words, and a negative margin pushes captions off the
    canvas entirely, where they are invisible in the preview *and* in the burn.
    """

    font_key: str | None = None
    font_size: int | None = Field(default=None, ge=12, le=200)
    bold: bool | None = None
    italic: bool | None = None
    underline: bool | None = None
    strikeout: bool | None = None
    uppercase: bool | None = None
    # Negative is legitimate — tightening tracking is a real typographic choice
    # and ASS `Spacing` accepts it. Floored well short of the point where
    # glyphs stack on top of each other.
    letter_spacing: int | None = Field(default=None, ge=-10, le=50)
    text_color: str | None = Field(default=None, pattern=HEX_COLOUR)
    outline_color: str | None = Field(default=None, pattern=HEX_COLOUR)
    outline_width: int | None = Field(default=None, ge=0, le=20)
    shadow: int | None = Field(default=None, ge=0, le=20)
    shadow_color: str | None = Field(default=None, pattern=HEX_COLOUR)
    box_color: str | None = Field(default=None, pattern=HEX_COLOUR)
    box_opacity: float | None = Field(default=None, ge=0.0, le=1.0)
    box_padding: int | None = Field(default=None, ge=0, le=60)
    alignment: Alignment | None = None

    # Fractions of the frame. Bounded to the frame, though the layout slides
    # every caption inside the safe area whatever these say.
    pos_x: float | None = Field(default=None, ge=0.0, le=1.0)
    pos_y: float | None = Field(default=None, ge=0.0, le=1.0)
    # 20% up to the whole safe area's width (94%). An explicit null puts it
    # back on the default for the frame's shape: the route applies the patch
    # with `exclude_unset`, so a null is sent through, not dropped.
    box_width: float | None = Field(default=None, ge=0.2, le=0.94)
    # Up to 6 for Stacked; the panel offers 1-3 for Auto and Balanced.
    max_lines: int | None = Field(default=None, ge=1, le=6)
    line_style: LineStyle | None = None
    words_per_line: int | None = Field(default=None, ge=1, le=4)

    @model_validator(mode="after")
    def no_nulls(self) -> "CaptionStyleUpdate":
        # Every other column is NOT NULL, so a null there was a 500 from the
        # database instead of a 422 here.
        nulls = [f for f in self.model_fields_set if f != "box_width" and getattr(self, f) is None]
        if nulls:
            raise ValueError(f"Can't be null: {', '.join(sorted(nulls))}")
        return self

    @field_validator("font_key")
    @classmethod
    def known_font(cls, value: str | None) -> str | None:
        # libass substitutes a font it cannot find without complaining, so an
        # unknown family here would render as something else entirely while the
        # browser previewed the real thing.
        #
        # Two sources now: the nine built-ins, which are always present, and the
        # Google Fonts catalogue, whose files are fetched on demand. Membership
        # of the catalogue is enough to accept the key — the file is guaranteed
        # to exist by render time because the editor cannot display a font it
        # has not already pulled through /api/fonts.
        if value is None:
            return value
        if value not in FONTS_BY_KEY and font_library.get(value) is None:
            raise ValueError(f"Unknown font: {value}")
        return value

    @field_validator("text_color", "outline_color", "shadow_color", "box_color")
    @classmethod
    def normalise_case(cls, value: str | None) -> str | None:
        return value.upper() if value else value


class PresetApply(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def known_preset(cls, value: str) -> str:
        if value not in PRESETS:
            raise ValueError(f"Unknown preset: {value}")
        return value


class FontRead(BaseModel):
    """
    A selectable face.

    `css_stack` is sent to the client rather than kept server-side, because the
    browser preview and the burn have to use metric-compatible faces and the
    pairing is decided in one place — here.
    """

    key: str
    label: str
    css_stack: str


class StyleOptions(BaseModel):
    fonts: list[FontRead]
    presets: list[str]
