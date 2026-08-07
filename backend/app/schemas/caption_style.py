from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.caption_style import REFERENCE_HEIGHT, Alignment, VerticalPosition
from app.services.caption_style import FONTS_BY_KEY, PRESETS

# #RRGGBB only. Short form (#FFF) and named colours are rejected rather than
# normalised: the ASS conversion slices fixed byte positions out of this string,
# so accepting a second shape would mean two code paths that must agree forever.
HEX_COLOUR = r"^#(?:[0-9a-fA-F]{6})$"


class CaptionStyleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    video_id: int
    font_key: str
    font_size: int
    bold: bool
    italic: bool
    text_color: str
    outline_color: str
    outline_width: int
    box_color: str
    box_opacity: float
    position: VerticalPosition
    alignment: Alignment
    margin_v: int
    margin_h: int

    # Echoed so the client never has to hardcode it to size the preview.
    reference_height: int = REFERENCE_HEIGHT


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
    text_color: str | None = Field(default=None, pattern=HEX_COLOUR)
    outline_color: str | None = Field(default=None, pattern=HEX_COLOUR)
    outline_width: int | None = Field(default=None, ge=0, le=20)
    box_color: str | None = Field(default=None, pattern=HEX_COLOUR)
    box_opacity: float | None = Field(default=None, ge=0.0, le=1.0)
    position: VerticalPosition | None = None
    alignment: Alignment | None = None
    margin_v: int | None = Field(default=None, ge=0, le=500)
    margin_h: int | None = Field(default=None, ge=0, le=500)

    @field_validator("font_key")
    @classmethod
    def known_font(cls, value: str | None) -> str | None:
        # libass substitutes a font it cannot find without complaining, so an
        # unknown family here would render as something else entirely while the
        # browser previewed the real thing.
        if value is not None and value not in FONTS_BY_KEY:
            raise ValueError(f"Unknown font: {value}")
        return value

    @field_validator("text_color", "outline_color", "box_color")
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
