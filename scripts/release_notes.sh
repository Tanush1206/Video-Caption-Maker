#!/usr/bin/env bash
# The CHANGELOG section of one version, for its GitHub Release (v1.4.1).
#
#   bash scripts/release_notes.sh 1.4.0
#
# Prints everything under "## [1.4.0] ..." up to the next version's heading,
# and nothing when the version has no section. The CHANGELOG is wrapped at
# 76 columns and a Release shows line breaks as written, so each paragraph
# and each bullet is joined into one line.
set -euo pipefail

version="${1:?usage: release_notes.sh <version>}"
changelog="$(dirname "$0")/../CHANGELOG.md"

tr -d '\r' < "$changelog" | awk -v heading="## [$version]" '
    function flush() { if (block != "") print block; block = "" }
    index($0, heading) == 1 { found = 1; next }
    found && /^## \[/ { exit }
    !found { next }
    /^[[:space:]]*$/ { flush(); print ""; next }
    /^[[:space:]]*(- |#)/ { flush(); block = $0; next }
    { line = $0; sub(/^[[:space:]]+/, "", line); block = (block == "" ? line : block " " line) }
    END { flush() }
' | sed -e '/./,$!d'
