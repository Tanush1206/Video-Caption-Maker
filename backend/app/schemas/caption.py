from pydantic import BaseModel, ConfigDict, Field, model_validator


class CaptionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sequence: int
    start_ms: int
    end_ms: int
    text: str
    confidence: float | None

    # Per-caption emphasis. null means "inherit the video's style", which is
    # not the same as "same value as the video's style" — an inherited caption
    # follows along when the style changes.
    override_color: str | None = None
    override_bold: bool | None = None
    override_scale: float | None = None


class CaptionCreate(BaseModel):
    """
    A caption the user wrote themselves.

    Unlike CaptionUpdate every field is required: there is no stored row to
    fall back on, so a caption with no times or no words is not a partial edit,
    it is an incomplete caption.
    """

    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=5000)

    @model_validator(mode="after")
    def check_timing(self) -> "CaptionCreate":
        if self.start_ms >= self.end_ms:
            raise ValueError("A caption has to end after it starts.")
        return self


class CaptionList(BaseModel):
    items: list[CaptionRead]
    total: int


class CaptionUpdate(BaseModel):
    """
    All fields optional: the editor autosaves a single changed field rather
    than sending the whole caption back.

    The `override_*` fields are nullable on purpose, and the route reads them
    with `exclude_unset` so that sending `null` clears an override while
    omitting the key leaves it alone. Those are different requests.
    """

    text: str | None = Field(default=None, max_length=5000)
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, ge=0)

    override_color: str | None = Field(default=None, pattern=r"^#(?:[0-9a-fA-F]{6})$")
    override_bold: bool | None = None
    # Bounded so emphasis can't blow a caption up until it covers the frame.
    override_scale: float | None = Field(default=None, ge=0.5, le=3.0)

    @model_validator(mode="after")
    def check_timing(self) -> "CaptionUpdate":
        # Only checkable when both are supplied; a one-sided edit is validated
        # against the stored value in the route.
        if self.start_ms is not None and self.end_ms is not None:
            if self.start_ms >= self.end_ms:
                raise ValueError("A caption has to end after it starts.")
        return self


class CaptionSplit(BaseModel):
    at_ms: int = Field(ge=0, description="Timestamp to split at")
    text_offset: int | None = Field(
        default=None,
        ge=0,
        description="Character index to divide the text at; inferred from time if omitted",
    )


class CaptionPair(BaseModel):
    """Both halves of a split, so the client can update without refetching."""

    first: CaptionRead
    second: CaptionRead


class CaptionReplace(BaseModel):
    """
    Find, and optionally replace, across every caption of a video (v1.3.0).

    One request for both the preview and the change, so they can't disagree
    about what matches: `apply` false shows what would change, true changes
    the captions in `caption_ids` (every match when it is null).
    """

    find: str = Field(min_length=1, max_length=200)
    replace: str = Field(default="", max_length=200)
    match_case: bool = False
    whole_word: bool = False
    caption_ids: list[int] | None = None
    apply: bool = False


class CaptionMatch(BaseModel):
    id: int
    start_ms: int
    end_ms: int
    before: str
    after: str
    #: Where the matches are in `before`, as [start, end) character offsets.
    spans: list[tuple[int, int]]
    #: The replacement would leave it empty: it is never applied to this one.
    empty: bool
    #: Changed by this request.
    applied: bool


class CaptionReplaceResult(BaseModel):
    matches: list[CaptionMatch]
    #: Occurrences, not captions: one caption can hold several.
    occurrences: int


class CaptionText(BaseModel):
    id: int
    text: str = Field(min_length=1, max_length=5000)


class CaptionTexts(BaseModel):
    """Captions' texts put back as they were: what Undo sends after a replace."""

    items: list[CaptionText] = Field(max_length=10000)



class WordRun(BaseModel):
    """Words of a caption, and whether a fix changed them: what the list highlights."""

    text: str
    changed: bool


class CaptionFixRead(BaseModel):
    """One caption a Gemini check changed (v1.3.0)."""

    id: int
    caption_id: int
    start_ms: int
    end_ms: int
    before: str
    after: str
    before_words: list[WordRun]
    after_words: list[WordRun]
    undone: bool
    #: Edited by hand since: Undo would overwrite the edit, so it is refused.
    edited: bool


class CaptionFixRunRead(BaseModel):
    """The latest "Improve captions with Gemini" run on a video, and its fixes."""

    id: int
    status: str
    batches_total: int
    batches_done: int
    #: The estimate while queued or running, from this run's own pace.
    seconds_left: int | None
    #: Fixes Gemini offered that the checks refused.
    dropped: int
    #: Requests the configured model failed and Gemini Flash-Lite answered.
    fallback_batches: int
    error_message: str | None
    fixes: list[CaptionFixRead]
