"""
A dropped upload frees its temporary file at once.

Starlette spools each uploaded file to a temporary file while it parses the
form, and closes those files only when parsing fails on bad data or a disk
error. When the browser cancels the upload, or the connection drops
(`ClientDisconnect`), the half-written file, unnamed and already gone from
the directory, stayed open until Python's cycle collector happened to run: a
2 GB upload cancelled part-way held its 356 MB for as long as we watched
(v1.2.0). This parser closes them on any failure, so the space comes back
when the request ends.
"""

import starlette.requests
from starlette.formparsers import FormData, MultiPartParser


class ClosingMultiPartParser(MultiPartParser):
    async def parse(self) -> FormData:
        try:
            return await super().parse()
        except BaseException:
            for file in self._files_to_close_on_error:
                file.close()
            raise


def install() -> None:
    """Make every form parse in this process use it (`Request.form()` looks it up here)."""
    starlette.requests.MultiPartParser = ClosingMultiPartParser
