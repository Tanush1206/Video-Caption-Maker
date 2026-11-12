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
elif cmd == "compose":
    with open(os.environ["FAKE_CALLS"], "a", encoding="utf-8") as calls:
        calls.write(" ".join(args) + "\n")
    if args[-1] == "pull" and os.environ.get("FAKE_PULL_FAIL") == "1":
        print('Get "https://ghcr.io/v2/": dial tcp: lookup ghcr.io: no such host', file=sys.stderr)
        sys.exit(1)
sys.exit(0)
