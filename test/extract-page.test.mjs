import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSource } from '../scripts/extract-page.mjs';
import { extractHtml } from '../scripts/lib/html-extract.mjs';

test('rendered local HTML resolves relative links against its original URL', async () => {
  const data = await extractSource({source:new URL('./fixtures/documentation/github-pages.html',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),sourceUrl:'https://docs.github.com/en/pages/site'});
  assert.match(data.contentMarkdown, /https:\/\/docs.github.com\/en\//);
  assert.doesNotMatch(data.contentMarkdown, /about:blank/);
});

test('ordinary articles keep readable content and exclude page navigation', async () => {
  const body = 'An ordinary article describes a useful subject in enough detail for extraction. '.repeat(40);
  const data = await extractHtml(`<html><head><title>Example</title></head><body><nav>Unrelated navigation</nav><article><h1>Example</h1><p>${body}</p></article><footer>Unrelated footer</footer></body></html>`, 'https://example.org/');
  assert.ok(data.contentMarkdown.includes('ordinary article'));
  assert.doesNotMatch(data.contentMarkdown, /Unrelated navigation|Unrelated footer/);
  assert.deepEqual(data.fidelityWarnings, []);
});

test('bare request retains bot retry and raw Markdown, explicit user agent suppresses retry', async () => {
  const calls = [];
  const runtime = {fetch:{getInitialUA:()=> 'default', BOT_UA:'bot', fetchPage:async (_url,ua,lang)=>{calls.push([ua,lang]);return ua;}, extractRawMarkdown:html=>html==='bot'?'# Reference\n\nUseful text':null, cleanMarkdownContent:x=>x}};
  const extract = async ()=>({wordCount:0,content:'',contentMarkdown:''});
  const data = await extractSource({source:'https://example.org/'},undefined,{runtime,extract});
  assert.equal(data.contentMarkdown, '# Reference\n\nUseful text');
  assert.equal(data.fidelityAssessment.checked, 0);
  assert.deepEqual(calls,[['default','en'],['bot','en']]);
  calls.length=0;
  await assert.rejects(extractSource({source:'https://example.org/'},'explicit',{runtime,extract}),/No content/);
  assert.deepEqual(calls,[['explicit','en']]);
});
