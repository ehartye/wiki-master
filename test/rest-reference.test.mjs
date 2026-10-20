import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractHtml, assessFidelity, extractionRuntime } from '../scripts/lib/html-extract.mjs';
const fixture = name => readFileSync(new URL(`./fixtures/documentation/github-rest-${name}.html`, import.meta.url), 'utf8');

for (const [name, heading, parameter, responseKey] of [
  ['artifacts', 'Get an artifact', 'artifact_id', 'archive_download_url'],
  ['workflow-runs', 'List workflow runs for a repository', 'per_page', 'workflow_runs'],
]) {
  test(`${name}: endpoint parameters, status tables and exact multiline examples survive`, async () => {
    const html = fixture(name);
    const result = await extractHtml(html, `https://docs.github.com/en/rest/actions/${name}`);
    assert.ok(result.contentMarkdown.includes(heading));
    assert.ok(result.contentMarkdown.includes(parameter));
    assert.match(result.contentMarkdown, /Path parameters/);
    assert.match(result.contentMarkdown, /Status code.*Description/);
    assert.ok(result.contentMarkdown.includes(responseKey));
    const { document } = extractionRuntime().parseHTML(html);
    for (const code of document.querySelectorAll('code[class*="language-"]')) {
      assert.ok(result.contentMarkdown.includes(code.textContent.trim()), `missing exact example: ${code.textContent.slice(0,60)}`);
    }
    assert.match(result.contentMarkdown, /```curl\n/);
    assert.match(result.contentMarkdown, /```json\n/);
    assert.doesNotMatch(result.contentMarkdown, /Fixture navigation|Fixture footer|Copy to clipboard/);
    assert.deepEqual(result.fidelityWarnings, []);
  });
}

test('retaining endpoint headings cannot hide a lost parameter row or response example', () => {
  const html = fixture('artifacts');
  const { document } = extractionRuntime().parseHTML(html);
  const headings = [...document.querySelectorAll('h1,h2,h3,h4')].map(x=>x.textContent).join('\n');
  const warnings = assessFidelity(html, headings);
  assert.ok(warnings.some(x=>x.kind==='parameter-row' && x.label.includes('artifact_id')));
  assert.ok(warnings.some(x=>x.kind==='code-block'));
  assert.ok(warnings.some(x=>x.kind==='endpoint'));
});

test('code diagnostics detect flattened lines and destroyed JSON punctuation', async () => {
  const html = fixture('artifacts');
  const result = await extractHtml(html, 'https://docs.github.com/en/rest/actions/artifacts');
  for (const damage of [body=>body.replace(/\n/g,' '), body=>body.replace(/["{}]/g,'')]) {
    const damaged = result.contentMarkdown.replace(/```[^\n]*\n([\s\S]*?)\n```/g, (_all, body)=>damage(body));
    assert.ok(assessFidelity(html, damaged, result.title).some(w=>w.kind==='code-block'));
  }
});
