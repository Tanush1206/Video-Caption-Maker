from pydantic import BaseModel, Field


class SearchResult(BaseModel):
    video_id: int
    # Carried so library-wide results can say which video each hit came from.
    video_title: str
    caption_id: int
    start_ms: int
    end_ms: int
    text: str
    # Similarity in 0..1; 1 is an exact match.
    score: float


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResult]
    total: int


class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    video_id: int | None = Field(
        default=None, description="Restrict to one video; omit to search everything"
    )


class Citation(BaseModel):
    """
    A source the answer leaned on.

    The timestamp comes from our own retrieved caption, never from the model —
    see rag.py for why that distinction is the whole safety story.
    """

    index: int
    video_id: int
    video_title: str
    caption_id: int
    start_ms: int
    text: str


class AskResponse(BaseModel):
    question: str
    answer: str
    # False when the transcript didn't answer, so the UI can present it as an
    # honest miss rather than as a result.
    grounded: bool
    citations: list[Citation]
    results: list[SearchResult]
