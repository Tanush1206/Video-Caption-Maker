"""A stand-in for `docker` in the installer tests (v1.4.0), never the real one.

Put first on PATH (as `docker.cmd` on Windows, `docker` elsewhere) so every
process a test starts, the update's hand-over included, reaches it:
- `info` works; `version` answers FAKE_ARCH, `image inspect` FAKE_IMAGE_ARCH;
- `compose ... pull` fails with no network when FAKE_PULL_FAIL=1;
- every compose call is written to FAKE_CALLS.
"""
import os
import sys

args = sys.argv[1:]
cmd = args[0] if args else ""
if cmd == "version":
    print(os.environ.get("FAKE_ARCH", "amd64"))
elif cmd == "inspect":
    print("sha256:installed")
elif cmd == "image" and args[1:2] == ["inspect"]:
    print(os.environ.get("FAKE_IMAGE_ARCH", "amd64"))
elif cmd == "info":
    print("CPUs 8, memory 16000000000 bytes, Docker Desktop")
elif cmd == "compose" and "version" in args:
    print("Docker Compose version v5.6.1")
elif cmd == "compose" and "logs" in args:
    # For vcm doctor: a line for every kind of secret it must leave out.
    print("backend-1 | GET /api/exports/7/download?token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl HTTP/1.1 200")
    print("backend-1 | Authorization: Bearer abc.def.ghi")
    print('worker-1  | Video 12 uploaded by someone@example.com: "My Holiday In Goa.mp4"')
    print("worker-1  | burned TRIP.MOV, then clip.mp4.")
    print("worker-1  | Gemini key AIzaSyDUMMYDUMMYDUMMYDUMMYDUMMY1234567 rejected")
    print("worker-1  | password=hunter2 in a URL")
    print(f"worker-1  | read {os.environ.get('FAKE_HOME_PATH', '')}/Videos")
elif cmd == "compose" and "ps" in args:
    print("c1" if "-aq" in args else "vcm-backend-1  running (healthy)")
elif cmd == "compose":
    with open(os.environ["FAKE_CALLS"], "a", encoding="utf-8") as calls:
        calls.write(" ".join(args) + "\n")
    if args[-1] == "pull" and os.environ.get("FAKE_PULL_FAIL") == "1":
        print('Get "https://ghcr.io/v2/": dial tcp: lookup ghcr.io: no such host', file=sys.stderr)
        sys.exit(1)
sys.exit(0)
