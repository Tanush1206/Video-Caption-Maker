"""
A cancelled upload frees its temporary file when the request ends (v1.2.0).

Starlette spools an uploaded file to an unnamed temporary file while it
parses the form, and on a dropped connection left it open for the cycle
collector (app/multipart.py). The browser half (Cancel ends the API's
request through /api/videos) is checked against the built frontend; see
docs/TESTING.md.
"""

import os
from pathlib import Path

import pytest
from starlette.formparsers import MultiPartParser
from starlette.requests import ClientDisconnect

from app.main import app
from app.multipart import ClosingMultiPartParser

BOUNDARY = "vcmtestboundary"
# Past Starlette's 1 MB spool, so the part is a real file on disk.
SENT = 3 * 1024 * 1024


def _head() -> bytes:
    return (
        f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="caption_language"\r\n\r\nsame\r\n'
        f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="big.mp4"\r\n'
        "Content-Type: video/mp4\r\n\r\n"
    ).encode()


def _open_deleted_files() -> int:
    """Files this process holds open that are no longer in any directory."""
    fds = Path("/proc/self/fd")
    return sum(1 for fd in fds.iterdir() if os.path.exists(fd) and "(deleted)" in os.readlink(fd))


def test_the_app_parses_forms_with_the_closing_parser():
    import starlette.requests

    assert starlette.requests.MultiPartParser is ClosingMultiPartParser
    # The private list it closes: a Starlette upgrade that renames it fails here.
    assert "_files_to_close_on_error" in MultiPartParser.__init__.__code__.co_names


@pytest.mark.asyncio
async def test_a_dropped_upload_closes_its_temporary_file():
    async def stream():
        yield _head()
        for _ in range(SENT // 65536):
            yield b"\0" * 65536
        raise ClientDisconnect()

    headers = {"Content-Type": f"multipart/form-data; boundary={BOUNDARY}"}
    parser = ClosingMultiPartParser(headers, stream())
    with pytest.raises(ClientDisconnect):
        await parser.parse()
    assert parser._files_to_close_on_error, "the file part should have been spooled"
    assert all(f.closed for f in parser._files_to_close_on_error)


@pytest.mark.asyncio
async def test_cancelling_an_upload_frees_the_partial_file_at_once(auth_headers):
    """
    Through the whole app, as a browser's Cancel arrives: part of the body,
    then the client goes away. Nothing is left open, with no garbage
    collection in between.
    """
    import gc

    body = [_head()] + [b"\0" * 65536] * (SENT // 65536)
    messages = [{"type": "http.request", "body": chunk, "more_body": True} for chunk in body]
    messages.append({"type": "http.disconnect"})

    async def receive():
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    async def send(message):
        pass

    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
        "scheme": "http", "path": "/api/videos", "raw_path": b"/api/videos", "query_string": b"",
        "root_path": "", "client": ("127.0.0.1", 50000), "server": ("localhost", 80),
        "headers": [
            (b"host", b"localhost"),
            (b"content-type", f"multipart/form-data; boundary={BOUNDARY}".encode()),
            (b"content-length", str(sum(map(len, body)) + 1024).encode()),
            *[(k.lower().encode(), v.encode()) for k, v in auth_headers.items()],
        ],
    }
    gc.disable()
    try:
        before = _open_deleted_files()
        try:
            await app(scope, receive, send)
        except ClientDisconnect:
            pass
        assert _open_deleted_files() == before
    finally:
        gc.enable()
