"""
The token helpers in app.utils.security (v1.4.1: PyJWT, not python-jose).

python-jose is unmaintained and carries an advisory that will get no fix
(docs/FINAL_AUDIT.md D1). The tokens themselves did not change: HS256 with
the install's secret, so one issued before the update is still accepted.
"""

import base64
import hashlib
import hmac
import json
import subprocess
import sys
import time

import pytest

from app.config import get_settings
from app.utils.security import (
    TokenError,
    create_access_token,
    create_download_token,
    create_refresh_token,
    create_stream_token,
    decode_token,
)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _hs256(payload: dict, secret: str | None = None, header: dict | None = None) -> str:
    """A token signed by hand, as any HS256 library (python-jose too) makes it."""
    secret = get_settings().jwt_secret_key if secret is None else secret
    head = _b64(json.dumps(header or {"alg": "HS256", "typ": "JWT"}).encode())
    body = _b64(json.dumps(payload).encode())
    signature = hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()
    return f"{head}.{body}.{_b64(signature)}"


def _claims(**over) -> dict:
    now = int(time.time())
    return {"sub": "7", "type": "access", "iat": now, "exp": now + 60, "jti": "a" * 32, **over}


def test_python_jose_is_not_loaded():
    # In a fresh interpreter: another test's imports can't hide it.
    code = "import sys, app.utils.security; print('jose' in sys.modules, 'ecdsa' in sys.modules)"
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    assert out.stdout.split() == ["False", "False"]


def test_each_token_round_trips_with_its_claims():
    assert decode_token(create_access_token(7), "access")["sub"] == "7"
    assert decode_token(create_refresh_token(7), "refresh")["sub"] == "7"
    assert decode_token(create_stream_token(7, 42), "stream")["vid"] == 42
    assert decode_token(create_download_token(7, 43), "download")["eid"] == 43
    payload = decode_token(create_access_token(7), "access")
    assert set(payload) == {"sub", "type", "iat", "exp", "jti"}
    assert len(payload["jti"]) == 32


def test_a_token_issued_before_the_update_is_still_accepted():
    assert decode_token(_hs256(_claims()), "access")["sub"] == "7"


def test_a_token_is_a_three_part_hs256_string():
    token = create_access_token(7)
    assert isinstance(token, str) and token.count(".") == 2
    header = json.loads(base64.urlsafe_b64decode(token.split(".")[0] + "=="))
    assert header["alg"] == "HS256"


@pytest.mark.parametrize(
    "token",
    [
        "not-a-jwt",
        "",
        "a.b.c",
    ],
)
def test_garbage_is_a_token_error(token):
    with pytest.raises(TokenError):
        decode_token(token, "access")


def test_an_expired_token_is_refused():
    with pytest.raises(TokenError):
        decode_token(_hs256(_claims(exp=int(time.time()) - 5)), "access")


def test_another_secret_is_refused():
    with pytest.raises(TokenError):
        decode_token(_hs256(_claims(), secret="x" * 64), "access")


def test_a_changed_payload_is_refused():
    head, _, signature = _hs256(_claims()).split(".")
    body = _b64(json.dumps(_claims(sub="1")).encode())
    with pytest.raises(TokenError):
        decode_token(f"{head}.{body}.{signature}", "access")


def test_an_unsigned_token_is_refused():
    head = _b64(json.dumps({"alg": "none", "typ": "JWT"}).encode())
    body = _b64(json.dumps(_claims()).encode())
    for token in (f"{head}.{body}.", f"{head}.{body}"):
        with pytest.raises(TokenError):
            decode_token(token, "access")


def test_another_algorithm_is_refused():
    secret = get_settings().jwt_secret_key
    head = _b64(json.dumps({"alg": "HS512", "typ": "JWT"}).encode())
    body = _b64(json.dumps(_claims()).encode())
    signature = hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha512).digest()
    with pytest.raises(TokenError):
        decode_token(f"{head}.{body}.{_b64(signature)}", "access")


def test_the_wrong_type_or_no_subject_is_refused():
    with pytest.raises(TokenError):
        decode_token(create_refresh_token(7), "access")
    with pytest.raises(TokenError):
        decode_token(_hs256(_claims(sub="")), "access")
    claims = _claims()
    del claims["sub"]
    with pytest.raises(TokenError):
        decode_token(_hs256(claims), "access")
