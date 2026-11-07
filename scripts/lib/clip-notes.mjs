// The `note:` lines clip.mjs prints beside a result. They are not outcomes, so they live apart from the result lines; the
// wording is shared with the references that tell an agent how to read them (test/skill-contracts.test.mjs).

// The served HTML shows tabs with no panel, which only a browser read can open.
export const unopenedTabsNote = (tabs) => `note: page has ${tabs} tab controls this clip did not open; use --recapture --expand`;

// The first read lost most of the page and a changed copy of the markup gave it back.
export const retryKeptNote = (retry, extracted, visible) => `note: extraction retry kept (${retry}): ${extracted} of about ${visible} visible words`;

// The first read kept under a fifth of the page and no retry helped.
export const shortfallNote = (extracted, visible) => `note: extracted ${extracted} of about ${visible} visible words`;
