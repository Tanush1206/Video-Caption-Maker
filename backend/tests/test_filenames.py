"""
Naming a download.

The filename travels in a response header, so the interesting cases here are
not "does it look nice" but "what happens when someone types something that is
not a filename at all".
"""

import pytest

from app.utils.filenames import MAX_STEM, safe_stem


def test_an_ordinary_name_survives_intact():
    assert safe_stem("Holiday in Rome") == "Holiday in Rome"


def test_the_extension_is_not_doubled():
    """
    Someone naming a file "holiday.mp4" means the same as "holiday". The
    caller appends the real extension, so leaving theirs on produces
    "holiday.mp4.mp4".
    """
    assert safe_stem("holiday.mp4", extension="mp4") == "holiday"
    assert safe_stem("holiday.MP4", extension="mp4") == "holiday"
    # A different extension is part of the name, not a duplicate of ours.
    assert safe_stem("holiday.mp4", extension="srt") == "holiday.mp4"


def test_a_newline_cannot_reach_the_header():
    """
    The one case here that is a security bug rather than a tidiness one.

    Content-Disposition is a header, and a name containing CRLF splits it —
    after which anything can be inserted. Starlette will not catch this: the
    name is still valid ASCII, so it takes the plain `filename="..."` path and
    writes the bytes out as given.
    """
    # The colon goes too — it is reserved on Windows — so the expected value is
    # not simply the input with its newline removed.
    assert safe_stem("song\r\nX-Injected: yes") == "songX-Injected yes"
    assert "\r" not in safe_stem("a\rb")
    assert "\n" not in safe_stem("a\nb")
    assert safe_stem("nul\x00byte") == "nulbyte"


@pytest.mark.parametrize(
    "raw,expected",
    [
        pytest.param("../../etc/passwd", "passwd", id="traversal"),
        pytest.param("/absolute/path/clip", "clip", id="absolute"),
        # Backslashes and the drive colon are both stripped, since Path on
        # a POSIX host does not treat either as a separator.
        pytest.param(r"C:\Windows\clip", "CWindowsclip", id="backslashes"),
    ],
)
def test_a_path_is_reduced_to_a_name(raw, expected):
    """
    A download name is not a location. Anything that looks like a directory is
    dropped before the rest of the sanitising runs.
    """
    assert safe_stem(raw) == expected


def test_names_a_filesystem_would_reject_are_trimmed():
    """
    Trailing dots and spaces are invalid on Windows and a leading dot hides the
    file on Unix — in both cases the download silently misbehaves rather than
    failing, which is worse.
    """
    assert safe_stem("  spaced out  ") == "spaced out"
    assert safe_stem("trailing...") == "trailing"
    assert safe_stem(".hidden") == "hidden"
    assert safe_stem("two   spaces") == "two spaces"


def test_a_name_is_capped():
    assert len(safe_stem("x" * 500)) == MAX_STEM


def test_a_name_that_is_only_punctuation_returns_empty():
    """
    Empty is the signal to fall back to the default name. Substituting one here
    would hide from the caller that the user's choice was unusable.
    """
    assert safe_stem("...") == ""
    assert safe_stem("///") == ""
    assert safe_stem("   ") == ""
