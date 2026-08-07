from pydantic import BaseModel, ConfigDict, Field, model_validator


class CaptionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sequence: int
    start_ms: int
    end_ms: int
    text: str
    confidence: float | None


class CaptionList(BaseModel):
    items: list[CaptionRead]
    total: int


class CaptionUpdate(BaseModel):
    """
    All fields optional: the editor autosaves a single changed field rather
    than sending the whole caption back.
    """

    text: str | None = Field(default=None, max_length=5000)
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def check_timing(self) -> "CaptionUpdate":
        # Only checkable when both are supplied; a one-sided edit is validated
        # against the stored value in the route.
        if self.start_ms is not None and self.end_ms is not None:
            if self.start_ms >= self.end_ms:
                raise ValueError("start_ms must be less than end_ms")
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
