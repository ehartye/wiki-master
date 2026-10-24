import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractHtml, assessFidelity, extractionRuntime } from '../scripts/lib/html-extract.mjs';
// Fixtures are CRLF in a working tree checked out with core.autocrlf=true, and the examples are compared as exact
// multiline text, so read them as LF; the extractor itself gives the same result for either (see the last test).
const fixture = name => readFileSync(new URL(`./fixtures/documentation/github-rest-${name}.html`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

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

test('the line endings of the served page do not change the extraction', async () => {
  for (const name of ['artifacts', 'workflow-runs']) {
    const lf = fixture(name).replace(/\r\n/g, '\n');
    const crlf = lf.replace(/\n/g, '\r\n');
    assert.ok(crlf.includes('\r\n') && !lf.includes('\r'));
    const url = `https://docs.github.com/en/rest/actions/${name}`;
    const [fromLf, fromCrlf] = [await extractHtml(lf, url), await extractHtml(crlf, url)];
    assert.equal(fromCrlf.contentMarkdown, fromLf.contentMarkdown, `${name}: markdown differs between LF and CRLF`);
    assert.equal(fromCrlf.title, fromLf.title);
    assert.deepEqual(fromCrlf.fidelityWarnings, fromLf.fidelityWarnings);
  }
});
