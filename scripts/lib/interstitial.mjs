// A page that is the gate and not the page: a login form, a cookie-consent wall, an age check. It has words enough to clear the
// thin floor, so the clipper filed it as the source it stood in for, and two different URLs could even share one body.
//
// The signal is the gate's own vocabulary, dense, with none of the page's title in the text. The title is what the page
// claims to be (Defuddle reads it from the document head, which the gate does not replace), and the body is what was
// served, so a body that talks about logging in and says nothing of its title is not that page.
//
// Measured on the 5,886 HTML clippings of one vault, with a title word counted at four letters or more: the three known shells
// (two sound-library pages sharing one body, and a store age gate) were the only pages with at least 3 gate phrases per 100
// words (5.4 to 6.4 against 0.2 at the 99th percentile), and all three had none of their title words in the body. The next
// highest pages were a template guide at 2.86, a long article at 2.61 and an authentication guide at 2.47, each with its
// title in full. Pages with at least 5 gate phrases and 3 per 100 words but a title found in the text are not flagged; a
// page whose title has no word of five letters or more is not judged. The replay over the same clippings with this function
// is recorded in the changelog.
const GATE = [
  /\blog ?in\b/gi, /\bsign ?in\b/gi, /\bsign ?up\b/gi, /\bjoin (now|steam|for free)\b/gi, /\bforgot (your )?password\b/gi,
  /\bcreate (an |your )?account\b/gi, /\bproblems logging in\b/gi, /\bverification (link|email|code)\b/gi,
  /\baccept (all )?cookies\b/gi, /\bcookie(s)? (policy|settings|preferences)\b/gi, /\btechnical cookies\b/gi,
  /\bmanage (cookie|privacy) ?(preferences|settings)?\b/gi, /\b(date of birth|birth ?date|enter your birth)\b/gi,
  /\bage verification\b/gi, /\bmature content\b/gi, /\bnot appropriate for (all ages|viewing at work)\b/gi, /\bcaptcha\b/gi,
  /\benable javascript\b/gi, /\bsubscribe to (read|continue)\b/gi, /\bplease verify\b/gi, /\bchecking your browser\b/gi,
  /\baccess denied\b/gi, /\bjust a moment\b/gi,
];
export const MIN_GATE_HITS = 5;
export const MIN_GATE_PER_100 = 3;
export const MAX_TITLE_SHARE = 0.5;
const TITLE_WORD_MIN = 5;

const wordsOf = (text) => String(text ?? '').match(/\p{L}[\p{L}\p{N}'-]*/gu) ?? [];

// null when the text is not a gate, or cannot be judged; otherwise what was measured and a reason a person can read.
export function classifyInterstitial({ markdown, title }) {
  const text = String(markdown ?? '');
  const words = wordsOf(text).length;
  if (!words) return null;
  let hits = 0;
  for (const re of GATE) hits += text.match(re)?.length ?? 0;
  const per100 = (100 * hits) / words;
  if (hits < MIN_GATE_HITS || per100 < MIN_GATE_PER_100) return null;
  const titleWords = [...new Set(wordsOf(title).map((w) => w.toLowerCase()).filter((w) => w.length >= TITLE_WORD_MIN))];
  if (!titleWords.length) return null;
  const lower = text.toLowerCase();
  const titleShare = titleWords.filter((w) => lower.includes(w)).length / titleWords.length;
  if (titleShare >= MAX_TITLE_SHARE) return null;
  return {
    hits, per100: +per100.toFixed(2), titleShare: +titleShare.toFixed(2),
    reason: `looks like a login, consent or age-gate page, not the page asked for (${hits} gate phrases, ${per100.toFixed(1)} per 100 words, ${titleShare === 0 ? 'none' : 'little'} of the title in the text); save the page from a signed-in browser and record it with clip.mjs <url> --from-file <path>`,
  };
}
