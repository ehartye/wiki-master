#!/bin/sh
# Stands in for a browser while npm test runs in CI (WIKI_MASTER_BROWSER). It records each launch for the step that
# fails on any record, then exits nonzero, so the render that started it fails at once without a browser or a network.
printf '%s\n' "$*" >> "$WIKI_MASTER_BROWSER_RECORD"
exit 1
