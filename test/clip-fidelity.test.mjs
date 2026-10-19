import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { main } from '../scripts/clip.mjs';
import { recordIssue, openIssues, loadIssueLog } from '../scripts/lib/triage.mjs';

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
