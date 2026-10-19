import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractHtml, assessFidelity} from '../scripts/lib/html-extract.mjs';
const fixture=n=>readFileSync(new URL(`./fixtures/documentation/${n}.html`,import.meta.url),'utf8');

test('linked API heading names survive and icon-only permalink anchors do not',async()=>{
 const data=await extractHtml(fixture('three-buffer'),'https://threejs.org/docs/pages/BufferAttribute.html');
 assert.match(data.contentMarkdown,/### .*needsUpdate.*number/);
 assert.match(data.contentMarkdown,/This class stores data/);
 assert.doesNotMatch(data.contentMarkdown,/Fixture navigation|Fixture footer/);
 assert.deepEqual(data.fidelityWarnings,[]);
});
test('API introduction and supported-extension list survive before Import',async()=>{
 const data=await extractHtml(fixture('three-gltf'),'https://threejs.org/docs/pages/GLTFLoader.html');
 assert.match(data.contentMarkdown,/A loader for the glTF/);
 assert.match(data.contentMarkdown.replaceAll(String.fromCharCode(92),''),/KHR_draco/);
 assert.ok(data.contentMarkdown.indexOf('KHR')<data.contentMarkdown.indexOf('## Import'));
});
test('GitHub availability and public-site warning retain text, label, ordering and links',async()=>{
 const data=await extractHtml(fixture('github-pages'),'https://docs.github.com/en/pages/site');
 assert.match(data.contentMarkdown,/Who can use this feature/);
 assert.match(data.contentMarkdown,/publicly available/);
 assert.match(data.contentMarkdown,/Warning/);
 assert.match(data.contentMarkdown,/GitHub Pro/);
 assert.ok(data.contentMarkdown.indexOf('Who can')<data.contentMarkdown.indexOf('Creating your site'));
 assert.doesNotMatch(data.contentMarkdown,/Fixture navigation|Fixture footer/);
});
test('technical cautions retain optional dependencies and cross-platform lockfile warning',async()=>{
 const data=await extractHtml(fixture('sharp-install'),'https://sharp.pixelplumbing.com/install/');
 assert.match(data.contentMarkdown,/optional dependencies/);
 assert.match(data.contentMarkdown,/package-lock\.json/);
 assert.match(data.contentMarkdown,/Caution/);
 assert.match(data.contentMarkdown,/https:\/\/github.com\/npm\/cli\/issues\/4828/);
 assert.doesNotMatch(data.contentMarkdown,/Fixture navigation|Fixture footer/);
});
test('coverage audit reports missing heading, introduction and callout evidence even in long output',()=>{
 const result=assessFidelity(fixture('github-pages'),'Ordinary text survives. '.repeat(200));
 assert.ok(result.some(w=>w.kind==='callout'));
 assert.ok(result.some(w=>w.kind==='availability'));
 assert.ok(assessFidelity(fixture('three-buffer'),'Normal text. '.repeat(200)).some(w=>w.kind==='heading'));
});

test('audit flags a retained heading with a dropped caution and a truncated caution tail',async()=>{
 const html=fixture('sharp-install');
 const data=await extractHtml(html,'https://example.org/',{extractImpl:async()=>({title:'Install',contentMarkdown:'# Install\n\n'+ 'Ordinary text. '.repeat(150)})});
 assert.ok(data.fidelityWarnings.some(w=>w.kind==='callout'));
 const long='First words remain in a long caution about optional dependency installation with several extra words before its crucial final restriction';
 assert.equal(assessFidelity(`<main><aside class="admonition">${long}</aside></main>`,long.split(' ').slice(0,18).join(' ')).length,1);
});

test('API introduction selection retains sibling method sections',async()=>{
 const html='<html><body><nav>Fixture navigation</nav><main><section><div class="class-description"><p>An API introduction.</p></div></section><section><h2>Methods</h2><h3><a href="#run">run</a></h3><p>Runs the task.</p></section></main></body></html>';
 const data=await extractHtml(html,'https://example.org/');
 assert.match(data.contentMarkdown,/Methods/);
 assert.match(data.contentMarkdown,/run/);
 assert.match(data.contentMarkdown,/Runs the task/);
 assert.deepEqual(data.fidelityWarnings,[]);
});

test('line breaks do not create false warnings and aria-only severity is preserved',async()=>{
 const html='<html><body><main><aside class="admonition" aria-label="Danger">First line<br>Second line</aside></main></body></html>';
 assert.deepEqual(assessFidelity(html,'Danger\nFirst line\nSecond line'),[]);
 const data=await extractHtml(html,'https://example.org/');
 assert.match(data.contentMarkdown,/Danger/);
 assert.match(data.contentMarkdown,/First line/);
 assert.deepEqual(data.fidelityWarnings,[]);
});
