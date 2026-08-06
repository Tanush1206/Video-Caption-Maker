from pydantic import BaseModel, ConfigDict


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
