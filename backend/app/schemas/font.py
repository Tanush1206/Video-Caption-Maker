from pydantic import BaseModel


class CatalogueMeta(BaseModel):
    """
    What the catalogue generator kept and skipped.

    Sent so the picker's info panel can be specific about what is missing and
    why, without hardcoding numbers that go stale the next time the catalogue
    is rebuilt. "Some fonts are unavailable" is not an explanation; "46 are CJK
    families over 6MB" is.
    """

    #: Families in Google's own catalogue — the number this app is measured against.
    google_families: int
    #: Shipped with a static face Google's designers drew.
    static: int
    #: Variable-only families, pinned to a static cut at download time.
    instanced: int
    skipped_oversized: int
    skipped_unusable: int


class FontLibraryEntry(BaseModel):
    """
    One family from the Google Fonts catalogue.

    `css_stack` is sent rather than assembled in the browser for the same reason
    the built-in fonts do it: the pairing between what libass is asked for and
    what the browser is asked for is decided in one place, server-side.
    """

    key: str
    family: str
    category: str
    has_bold: bool
    css_stack: str


class FontSearchResult(BaseModel):
    """
    Three counts, because one was actively misleading.

    The picker used to show `total` next to a list of the sixty it had been
    given, so searching "lob" listed two fonts under the heading "1301
    families". `matched` is how many the *query* found; `returned` is how many
    of those came back; `total` is only for the placeholder, which is the one
    place a catalogue-wide number is the honest one.
    """

    total: int
    matched: int
    returned: int
    fonts: list[FontLibraryEntry]
    meta: CatalogueMeta
