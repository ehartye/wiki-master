// A landing page is a short page whose substance is one link to a PDF: the page announces the document and the document is
// what a reader wants. Clipping it as an ordinary page would pass a blurb off as the source, so it is labeled instead, and the
// document it points to is left for clip-pdf.mjs (clip.mjs never follows the link by itself, so a wrong file is never fetched
// unasked).
export const LANDING_MAX_WORDS = 300;

// The one PDF a landing page points to, or null. A page with no words is not a landing page: it has nothing to label.
export function landingDocument(pageSignals, words) {
  if (!(words > 0 && words < LANDING_MAX_WORDS)) return null;
  const links = new Set(pageSignals?.pdfLinks ?? []);
  return links.size === 1 ? [...links][0] : null;
}

export function landingLine(documentUrl) {
  return `landing page: the document is at ${documentUrl}; run clip-pdf.mjs "${documentUrl}"`;
}

export function landingReason(pageUrl, documentUrl) {
  return `${pageUrl} is a landing page for this document; clip it with: clip-pdf.mjs "${documentUrl}"`;
}
