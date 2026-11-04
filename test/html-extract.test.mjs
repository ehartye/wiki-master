import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractHtml, assessFidelity} from '../scripts/lib/html-extract.mjs';
const fixture=n=>readFileSync(new URL(`./fixtures/documentation/${n}.html`,import.meta.url),'utf8');

test('image equation alternatives survive real extraction in their original prose order',async()=>{
 const data=await extractHtml(fixture('image-equations'),'https://example.org/path');
 const md=data.contentMarkdown;
 assert.ok(md.includes(String.raw`$ {\cal C}_{free}$`),md);
 assert.equal(md.split(String.raw`$ {\cal C}_{free}$`).length-1,2);
 assert.ok(md.indexOf(String.raw`$ \tau: [0,1] \rightarrow {\cal C}$`)<md.indexOf(String.raw`$ \Delta q > 0$`),md);
 assert.deepEqual(data.fidelityWarnings,[]);
});

test('image equation loss is detected without punctuation or case folding',()=>{
 const html=fixture('image-equations');
 const dropped='# Path segment equations\n\nA configuration lies in, and a path maps into. Check the path before choosing.';
 const warnings=assessFidelity(html,dropped);
 assert.equal(warnings.filter(w=>w.kind==='image-equation').length,4);
 assert.ok(warnings.some(w=>w.label.includes(String.raw`\cal C`)));
 const changed=String.raw`$ {\cal c}_{free}$ $ {\cal c}_{free}$ $ \tau: [0,1] \rightarrow {\cal C}$ $ \Delta q < 0$`;
 assert.equal(assessFidelity(html,changed).filter(w=>w.kind==='image-equation').length,3);
});

test('unusable or source-truncated image math warns even if extraction retains its label',async()=>{
 for(const alt of ['', 'equation', String.raw`$x + ... ... + y$`]){
  const html=`<html><body><main><h1>Equation detail</h1><p>Read this expression: <span class="MATH"><img src="formula.gif" alt="${alt}"></span>. Its details matter.</p></main></body></html>`;
  const data=await extractHtml(html,'https://example.org/');
  assert.ok(data.fidelityWarnings.some(w=>w.kind==='image-equation'&&/alternative/i.test(w.label)),JSON.stringify(data));
 }
});

test('ordinary images, prices and decorative math controls do not add equation warnings',()=>{
 const html='<main><img alt="next" src="next.gif"><img alt="Map showing a route"><img alt="$5 each"><img alt="Price $5 and $10"><button><img class="math" alt="$+$"></button><span aria-hidden="true"><img class="MATH" alt="$x$"></span><img role="presentation" class="math" alt="$q$"></main>';
 assert.deepEqual(assessFidelity(html,''),[]);
 assert.deepEqual(assessFidelity('<main><span ARIA-HIDDEN="true"><IMG CLASS="MATH" ALT="$X$"></span><IMG ROLE="presentation" CLASS="MATH" ALT="$Y$"></main>',''),[]);
});

test('bare marked variables and delimited unmarked math preserve literal alternatives without HTML execution',async()=>{
 const html=String.raw`<html><body><main><h1>Expressions</h1><p>Use <img class="math" alt="q"> with <img alt="\(x &lt; y\)"> and <img class="math" alt="&lt;script&gt;literal&lt;/script&gt;"> in this expression.</p></main></body></html>`;
 const data=await extractHtml(html,'https://example.org/');
 assert.ok(data.contentMarkdown.includes('`q`'));
 assert.ok(data.contentMarkdown.includes(String.raw`\(x < y\)`));
 assert.ok(data.contentMarkdown.includes('<script>literal</script>'));
 assert.deepEqual(data.fidelityWarnings,[]);
 assert.equal(assessFidelity('<main><img class="math" alt="q"></main>','A q appears elsewhere in prose.').length,1);
 const duplicate=String.raw`<main><img alt="$q$"><img alt="$q$"></main>`;
 assert.equal(assessFidelity(duplicate,'`$q$`').length,1);
 assert.equal(assessFidelity('<main><img alt="$x$"><img alt="$$x$$"></main>','$$x$$').length,1);
 for(const alt of ['`x','x`','`x`']){
  const data=await extractHtml(`<main><p>Use <img class="math" alt="${alt}"> here.</p></main>`,'https://example.org/');
  assert.deepEqual(data.fidelityWarnings,[],data.contentMarkdown);
 }
});

test('obviously incomplete mathematical alternatives warn without guessing the missing expression',async()=>{
 for(const alt of [String.raw`$x + y`,String.raw`\(x + y`,String.raw`\[x`,'$$x$','$ $']){
  const data=await extractHtml(`<main><p>Use <img class="math" alt="${alt}"> here.</p></main>`,'https://example.org/');
  assert.ok(data.fidelityWarnings.some(w=>/incomplete alternative/.test(w.label)),JSON.stringify(data));
 }
});

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

test('visible labels are not counted twice and nested severity labels survive',async()=>{
 const html='<html><body><main><aside class="admonition" aria-label="Note"><p>Note</p><p>Outer content.</p><aside class="admonition" aria-label="Danger"><p>Inner restriction.</p></aside></aside></main></body></html>';
 const data=await extractHtml(html,'https://example.org/');
 assert.match(data.contentMarkdown,/Danger/);
 assert.match(data.contentMarkdown,/Inner restriction/);
 assert.deepEqual(data.fidelityWarnings,[]);
});

test('callout cleanup preserves ordered-list starting numbers',async()=>{
 const html='<html><body><main><aside class="admonition"><p>Continue the procedure:</p><ol start="5"><li>Install dependencies.</li><li>Restart the application.</li></ol></aside></main></body></html>';
 const data=await extractHtml(html,'https://example.org/');
 assert.match(data.contentMarkdown,/5\.\s+Install dependencies/);
 assert.match(data.contentMarkdown,/6\.\s+Restart the application/);
});
