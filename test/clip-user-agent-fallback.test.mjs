// A browser-shaped User-Agent is what makes some sites serve real content (NCBI
// PMC's bot-check) and what makes others unreachable: ai.google.dev offers auto
// sign-in only to clients it reads as browsers, and a cookieless client can never
// finish `prompt=none`, so it bounces
//   docs -> /oauth2authorize -> accounts.google.com -> /oauth2callback
//   (error=interaction_required) -> docs -> ...
// until undici gives up with "redirect count exceeded", surfacing as the opaque
// `Error: fetch failed`. The two needs are opposite, so neither UA can be the
// only one tried.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defuddleAttempts, runDefuddleJson } from '../scripts/clip.mjs';

test('the browser user-agent is attempted before any bare request', () => {
  const attempts = defuddleAttempts('https://example.test/a');
  const firstBare = attempts.findIndex((a) => !a.includes('--user-agent'));
  const firstUa = attempts.findIndex((a) => a.includes('--user-agent'));
  assert.notEqual(firstUa, -1, 'the browser UA must still be tried');
  assert.notEqual(firstBare, -1, 'a bare attempt must exist as a fallback');
  assert.ok(firstUa < firstBare,
    'dropping the UA first would re-break NCBI PMC, which serves a bot-check shell without one');
});

test('every attempt quotes the url so a query string cannot split the command', () => {
  for (const cmd of defuddleAttempts('https://example.test/a?b=1&c=2')) {
    assert.match(cmd, /"https:\/\/example\.test\/a\?b=1&c=2"/);
  }
});

test('a url that fails only with the user-agent is still clipped', () => {
  const seen = [];
  const run = (cmd) => {
    seen.push(cmd);
    // Reproduces ai.google.dev: fine bare, a redirect loop with a browser UA.
    if (cmd.includes('--user-agent')) throw new Error('Command failed: Error: fetch failed');
    return JSON.stringify({ title: 'Image generation', wordCount: 12165 });
  };
  const out = runDefuddleJson('https://ai.google.dev/gemini-api/docs/image-generation', { run });
  assert.equal(out.wordCount, 12165);
  assert.ok(seen.some((c) => c.includes('--user-agent')), 'the UA attempt still comes first');
});

test('a url that needs the user-agent never reaches the bare attempt', () => {
  const seen = [];
  const run = (cmd) => {
    seen.push(cmd);
    if (!cmd.includes('--user-agent')) throw new Error('should not be reached');
    return JSON.stringify({ title: 'PMC article', wordCount: 14885 });
  };
  const out = runDefuddleJson('https://pmc.ncbi.nlm.nih.gov/articles/PMC123/', { run });
  assert.equal(out.wordCount, 14885);
  assert.equal(seen.length, 1, 'a working first attempt must not cost a second request');
});

test('when every attempt fails the original error survives', () => {
  const run = () => { throw new Error('Command failed: Error: fetch failed'); };
  assert.throws(
    () => runDefuddleJson('https://nope.test/x', { run }),
    /fetch failed/,
    'the caller classifies on this message; swallowing it would report a fetch error as thin content'
  );
});

// Defuddle defaults to `Accept-Language: *` — "any language at all". Google reads
// that as licence to machine-translate: measured over six cookieless fetches of the
// same ai.google.dev page, only two came back English and the rest arrived as
// zh-CN/ja/id/ar `-x-mtfrom-en`. A clipping is quoted verbatim later, so a silently
// machine-translated one is worse than a failed fetch: it is wrong content wearing
// the same frontmatter as right content. `--lang en` sends `Accept-Language: en`,
// which pinned it 6/6.
test('every attempt pins the language, so no source can be machine-translated', () => {
  for (const cmd of defuddleAttempts('https://ai.google.dev/gemini-api/docs/image-generation')) {
    assert.match(cmd, /--lang en\b/,
      'without this Defuddle sends Accept-Language: * and the clipping language is whatever the server felt like');
  }
});
