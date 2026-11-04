import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { main } from '../scripts/clip.mjs';
import { recordIssue, openIssues, loadIssueLog } from '../scripts/lib/triage.mjs';
import { extractHtml } from '../scripts/lib/html-extract.mjs';

test('image equation warning reaches partial metadata and triage without changing an existing capture', async t => {
  const vault = mkdtempSync(join(tmpdir(), 'wiki-equation-clip-'));
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = vault;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(vault, {recursive:true,force:true}); });
  mkdirSync(join(vault, 'raw', 'clippings'), { recursive: true });
  const url='https://example.org/equation', prose='The path segment discussion gives useful context for evaluating these mathematical conditions. '.repeat(30);
  const extracted=await extractHtml(`<html><head><title>Equation fidelity</title></head><body><main><h1>Equation fidelity</h1><p>${prose}<span class="MATH"><img src="equation.gif" alt="equation"></span></p></main></body></html>`,url);
  const result=main([url],{extract:()=>extracted});
  assert.equal(result.status,'clipped');
  const original=readFileSync(result.file,'utf8');
  assert.match(original,/^fidelity: partial$/m);
  assert.ok(original.includes(createHash('sha256').update(extracted.contentMarkdown).digest('hex')));
  const issues=openIssues(loadIssueLog(vault));
  assert.ok(issues.some(issue=>issue.kind==='fidelity'&&/image-equation.*alternative text/.test(issue.reason)));
  const second=main([url],{extract:()=>{throw Error('Existing capture must not be silently re-extracted');}});
  assert.equal(second.status,'duplicate');
  assert.equal(readFileSync(result.file,'utf8'),original);
});

test('headings ignored as page chrome are disclosed in the clip, open no triage, and leave the clip unmarked', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wiki-fidelity-ignored-'));
  const prior = process.env.WIKI_MASTER_VAULT;
  const errors = [];
  const realError = console.error;
  try {
    process.env.WIKI_MASTER_VAULT = vault;
    mkdirSync(join(vault, 'raw', 'clippings'), { recursive: true });
    console.error = (...a) => errors.push(a.join(' '));
    const markdown = 'Useful reference content with preserved identifiers. '.repeat(30);
    const result = main(['https://learn.example.com/page'], { extract: () => ({
      title: 'Learn page', contentMarkdown: markdown, fidelityWarnings: [],
      fidelityAssessment: { checked: 5, missing: 0, ignored: [{ kind: 'heading', label: 'Feedback', why: 'known page chrome' }, { kind: 'heading', label: 'Share', why: 'known page chrome' }] },
    }) });
    assert.equal(result.status, 'clipped');
    const saved = readFileSync(result.file, 'utf8');
    assert.match(saved, /^fidelity-checks: 5$/m);
    assert.match(saved, /^fidelity-ignored: 2$/m);
    assert.doesNotMatch(saved, /^fidelity: partial$/m);
    assert.equal(openIssues(loadIssueLog(vault)).length, 0);
    assert.ok(errors.some((e) => /ignored 2 page-chrome heading/.test(e) && e.includes('Feedback') && e.includes('Share')), errors.join('\n'));
  } finally {
    console.error = realError;
    if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior;
    rmSync(vault, { recursive: true, force: true });
  }
});

test('a clip with nothing ignored carries no fidelity-ignored line', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wiki-fidelity-none-'));
  const prior = process.env.WIKI_MASTER_VAULT;
  try {
    process.env.WIKI_MASTER_VAULT = vault;
    mkdirSync(join(vault, 'raw', 'clippings'), { recursive: true });
    const markdown = 'Useful reference content with preserved identifiers. '.repeat(30);
    const result = main(['https://learn.example.com/other'], { extract: () => ({
      title: 'Other page', contentMarkdown: markdown, fidelityWarnings: [],
      fidelityAssessment: { checked: 5, missing: 0, ignored: [] },
    }) });
    assert.doesNotMatch(readFileSync(result.file, 'utf8'), /fidelity-ignored/);
  } finally {
    if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior;
    rmSync(vault, { recursive: true, force: true });
  }
});

test('a saved partial clip keeps its hash and opens actionable fidelity triage after closing fetch failure', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wiki-fidelity-'));
  const prior = process.env.WIKI_MASTER_VAULT;
  try {
    process.env.WIKI_MASTER_VAULT = vault;
    mkdirSync(join(vault, 'raw', 'clippings'), { recursive: true });
    const url = 'https://example.org/api';
    recordIssue(vault, { url, kind: 'failed', reason: 'old fetch failure' });
    const markdown = 'Useful reference content with preserved identifiers. '.repeat(30);
    const result = main([url, '--topic=API documentation'], { extract: () => ({
      title: 'API example', contentMarkdown: markdown, fidelityWarnings: [{kind:'heading',label:'needsUpdate'}],
      fidelityAssessment: { checked: 4, missing: 1 },
    }) });
    assert.equal(result.status, 'clipped');
    const saved = readFileSync(result.file, 'utf8');
    assert.match(saved, /^fidelity: partial$/m);
    assert.match(saved, /^fidelity-checks: 4$/m);
    assert.ok(saved.includes(createHash('sha256').update(markdown).digest('hex')));
    assert.ok(saved.endsWith(`${markdown}\n`));
    const issues = openIssues(loadIssueLog(vault));
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, 'fidelity');
    assert.match(issues[0].reason, /needsUpdate/);
    assert.equal(issues[0].topic, 'API documentation');
    assert.equal(issues[0].source, `raw/clippings/${result.slug}.md`);
  } finally {
    if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior;
    rmSync(vault, { recursive: true, force: true });
  }
});
