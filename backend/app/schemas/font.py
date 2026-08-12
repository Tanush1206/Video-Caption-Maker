from pydantic import BaseModel


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
