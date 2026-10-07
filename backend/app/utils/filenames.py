"""
Naming the file a browser saves.

A download's filename is chosen by the *server* — it travels in the
`Content-Disposition` header — so a user who wants to name their own file has
to send that name here. Which means this module's only real job is deciding
what a caller is allowed to name a file.
"""

import re
from pathlib import Path

# Everything a filesystem or a header objects to.
#
# The control-character range is the one that matters for safety rather than
# tidiness: a carriage return inside a filename becomes a carriage return
# inside the Content-Disposition header, and a header that can be split is a
# header into which anything can be inserted. Starlette will happily encode a
# name containing \r\n because it is still valid ASCII.
#
# The rest — separators, and the characters Windows reserves — are here so the
# saved file actually lands where the user expects with the name they typed.
_UNSAFE = re.compile(r'[\x00-\x1f\x7f/\\:*?"<>|]')

# Filesystems cap a name near 255 bytes. Well under that, because the name is
# also read by a human in a downloads folder, and because a multi-byte script
# costs several bytes per character.
MAX_STEM = 120


def safe_stem(raw: str, *, extension: str | None = None) -> str:
    """
    The usable part of a name a user typed, or "" if nothing survives.

    Returning empty rather than raising or substituting: the caller already has
    a good default name, and the question here is only whether the user's
    choice can be used instead of it.

    `extension` is stripped when the user typed it themselves — someone naming
    a file "holiday.mp4" means the same thing as naming it "holiday", and
    "holiday.mp4.mp4" is nobody's intention.
    """
    # `.name` drops any directory the user typed, so "../../etc/passwd" becomes
    # "passwd" before anything else looks at it.
    stem = Path(raw.strip()).name

    if extension and stem.lower().endswith(f".{extension.lower()}"):
        stem = stem[: -(len(extension) + 1)]

    stem = _UNSAFE.sub("", stem)
    stem = re.sub(r"\s+", " ", stem)

    # Leading and trailing dots and spaces: a name ending in either is invalid
    # on Windows, and a leading dot hides the file on Unix. Trimmed again after
    # truncation, in case the cut landed on one.
    return stem.strip(" .")[:MAX_STEM].strip(" .")
