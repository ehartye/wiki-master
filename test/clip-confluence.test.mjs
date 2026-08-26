import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseConfluencePage,
  confluenceClipContent,
  findConfluencerScripts,
} from '../scripts/clip-confluence.mjs';

test('parseConfluencePage extracts title/space/pageId/version/updated/url/body from the confluence skill\'s provenance header', () => {
  const raw = [
    '# TrackWise AI Summer 26 Release Notes',
    'Space: HCLSPMH · Page ID: 1297100277 · Version: 10 · Updated: 2026-06-16T20:22:46.380Z',
    'URL: https://honeywell.atlassian.net/wiki/spaces/HCLSPMH/pages/1297100277/TrackWise+AI+Summer+26+Release+Notes',
    '',
    '---',
    '',
    '# New Features and Improvements',
    '',
    'Some body prose about the release.',
  ].join('\n');

  const parsed = parseConfluencePage(raw);
  assert.equal(parsed.title, 'TrackWise AI Summer 26 Release Notes');
  assert.equal(parsed.space, 'HCLSPMH');
  assert.equal(parsed.pageId, '1297100277');
  assert.equal(parsed.version, '10');
  assert.equal(parsed.updated, '2026-06-16T20:22:46.380Z');
  assert.equal(parsed.url, 'https://honeywell.atlassian.net/wiki/spaces/HCLSPMH/pages/1297100277/TrackWise+AI+Summer+26+Release+Notes');
  assert.equal(parsed.body, '# New Features and Improvements\n\nSome body prose about the release.');
});

test('parseConfluencePage handles the "no readable content" placeholder as an ordinary (thin) body', () => {
  const raw = [
    '# TrackWise AI Summer 26',
    'Space: TWDVAL · Page ID: 1441722226 · Version: 1 · Updated: 2026-07-21T19:57:10.834Z',
    'URL: https://honeywell.atlassian.net/wiki/spaces/TWDVAL/pages/1441722226/TrackWise+AI+Summer+26',
    '',
    '---',
    '',
    '_(This page has no readable content.)_',
  ].join('\n');

  const parsed = parseConfluencePage(raw);
  assert.equal(parsed.pageId, '1441722226');
  assert.match(parsed.body, /no readable content/i);
});

test('parseConfluencePage returns a null url when the expected header is absent (malformed/unexpected output)', () => {
  const parsed = parseConfluencePage('Some unrelated error text with no header at all');
  assert.equal(parsed.url, null);
  assert.equal(parsed.body, '');
});

test('confluenceClipContent stores the fetched markdown as the note, with provenance frontmatter', () => {
  const body = 'Intro\r\n\r\n\r\nThis page documents the AI feature set.\n\n\n\nSection 1.';
  const { md, body: written, wordCount } = confluenceClipContent({
    title: 'AI Models Inventory',
    source: 'https://honeywell.atlassian.net/wiki/spaces/HCLSPMH/pages/1297097652/AI+Models+Inventory',
    body,
    quality: 'high',
    created: '2026-08-26',
  });
  // CRLF normalized, 3+ blank lines collapsed, trimmed -- same contract as docxClipContent.
  assert.equal(md, 'Intro\n\nThis page documents the AI feature set.\n\nSection 1.');
  assert.ok(wordCount >= 7);
  assert.match(written, /^---\n/);
  assert.match(written, /title: "AI Models Inventory"/);
  assert.match(written, /source: "https:\/\/honeywell\.atlassian\.net\/wiki\/spaces\/HCLSPMH\/pages\/1297097652\/AI\+Models\+Inventory"/);
  assert.match(written, /tags: \[clippings\]/);
  assert.match(written, /quality: high/);
  assert.match(written, /source-hash: [0-9a-f]{64}/);
  assert.ok(written.trimEnd().endsWith('Section 1.'));
});

test('confluenceClipContent omits fidelity/extraction fields — confluencer yields clean text, same as clip-docx', () => {
  const { body } = confluenceClipContent({
    title: 'T', source: 's', body: 'Clean prose, several plain words here for the floor.',
  });
  assert.doesNotMatch(body, /fidelity:/);
  assert.doesNotMatch(body, /extraction:/);
});

test('confluenceClipContent exposes the content hash (for slug disambiguation)', () => {
  const { hash } = confluenceClipContent({ title: 'T', source: 's', body: 'Some real words here for hashing purposes today.' });
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('findConfluencerScripts: an explicit env override always wins, unchecked', () => {
  const found = findConfluencerScripts({
    env: { WIKI_MASTER_CONFLUENCER_SCRIPTS: '/somewhere/not/real/scripts' },
    home: '/also/not/real',
  });
  assert.equal(found, '/somewhere/not/real/scripts');
});

test('findConfluencerScripts: returns null when no ~/.copilot/installed-plugins root exists', () => {
  const home = mkdtempSync(join(tmpdir(), 'wiki-master-test-'));
  try {
    const found = findConfluencerScripts({ env: {}, home });
    assert.equal(found, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('findConfluencerScripts: returns null when installed-plugins exists but no plugin ships confluencer', () => {
  const home = mkdtempSync(join(tmpdir(), 'wiki-master-test-'));
  try {
    mkdirSync(join(home, '.copilot', 'installed-plugins', 'some-marketplace', 'unrelated-plugin', 'scripts'), { recursive: true });
    const found = findConfluencerScripts({ env: {}, home });
    assert.equal(found, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('findConfluencerScripts: finds confluencer under whichever marketplace folder installed it', () => {
  const home = mkdtempSync(join(tmpdir(), 'wiki-master-test-'));
  try {
    const scriptsDir = join(home, '.copilot', 'installed-plugins', 'confluencer-marketplace', 'confluencer', 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, 'page.mjs'), '// stub');
    const found = findConfluencerScripts({ env: {}, home });
    assert.equal(found, scriptsDir);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
