import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync, realpathSync, mkdtempSync, openSync, closeSync, fsyncSync, linkSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { buildFrontmatter, slugify } from '../clip.mjs';

const SHA = /^[a-f0-9]{40}$/;
const MAX_FILE = 256 * 1024, MAX_TOTAL = 8 * 1024 * 1024;
const digest = value => createHash('sha256').update(value).digest('hex');
const absent = path => { try { return lstatSync(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const failure = (message, status = 'refused') => Object.assign(new Error(message), { selectionStatus: status });
const encode = value => encodeURIComponent(value);

export function validSelectedPath(path) {
  try { encodeURIComponent(path); } catch { return false; }
  return typeof path === 'string' && path.length > 0 && path.length <= 512 &&
    !/[\\:\x00-\x1f\x7f]/.test(path) && path.split('/').length <= 16 &&
    path.split('/').every(part => part && part !== '.' && part !== '..');
}

export function selectionOptions(argv) {
  const paths = argv.filter(a => a.startsWith('--path=')).map(a => a.slice(7));
  const readmeOnly = argv.includes('--readme-only');
  if (!paths.length && !readmeOnly) return null;
  if (!argv[0] || argv[0].startsWith('-')) throw failure('Selection requires a repository target');
  for (let i=1;i<argv.length;i++) {
    if (argv[i] === '--since') { i++; continue; }
    if (!argv[i].startsWith('--')) throw failure('Unexpected positional argument in selection');
  }
  if (readmeOnly && paths.length) throw failure('Use --readme-only or repeated --path=<exact-path>, not both');
  if (argv.some(a => a === '--force-full' || /^--(?:max-files|max-groups|decline)=/.test(a))) throw failure('Selection cannot be combined with full/digest controls or --decline');
  if (argv.filter(a => a.startsWith('--ref=')).length > 1) throw failure('Selection accepts one --ref');
  const ref = argv.find(a => a.startsWith('--ref='))?.slice(6) ?? 'HEAD';
  if (!ref || ref.length > 256 || /[\x00-\x20\x7f]/.test(ref)) throw failure('Invalid selected-capture ref');
  if (paths.length > 32 || paths.some(p => !validSelectedPath(p))) throw failure('Select at most 32 exact repo-relative paths (no empty/dot segments, backslashes, colons or controls; depth <=16, length <=512)');
  if (new Set(paths).size !== paths.length) throw failure('Duplicate selected path');
  const quality = argv.find(a => a.startsWith('--quality='))?.slice(10) ?? 'medium';
  if (!['high', 'medium', 'low'].includes(quality)) throw failure('Invalid capture quality');
  return { paths: paths.sort(), readmeOnly, ref };
}

// gh supplies existing GitHub authentication. Fixed host; no redirects to download URLs or shell commands.
export function githubObjectReader(owner, repo, { run = execFileSync, now = Date.now } = {}) {
  let requests = 0;
  const deadline = now() + 90000;
  return (route, jq) => {
    if (++requests > 128 || now() >= deadline) throw failure('GitHub selection request/time budget exhausted', 'failed');
    const args = ['api', '--hostname', 'github.com', '--method', 'GET', `repos/${encode(owner)}/${encode(repo)}/${route}`];
    if (jq) args.push('--jq', jq);
    try {
      return JSON.parse(run('gh', args, { encoding: 'utf8', timeout: Math.max(1, Math.min(30000, deadline - now())), maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GH_PROMPT_DISABLED: '1' } }));
    } catch (e) { throw failure(`GitHub object request failed for ${route.split('/')[0]} (${e.code || e.status || 'invalid response'}); check authentication/access and the requested ref`, 'failed'); }
  };
}

function prepare({ owner, repo, selection, read }) {
  if (![owner, repo].every(s => /^[a-z0-9][a-z0-9._-]*$/i.test(s))) throw failure('Invalid GitHub repository identity');
  if (!selection || !Array.isArray(selection.paths) || selection.paths.length > 32 || selection.paths.some(p=>!validSelectedPath(p)) || new Set(selection.paths).size !== selection.paths.length || (!selection.readmeOnly && !selection.paths.length) || (selection.readmeOnly && selection.paths.length) || typeof selection.ref !== 'string' || !selection.ref || selection.ref.length > 256 || /[\x00-\x20\x7f]/.test(selection.ref)) throw failure('Invalid bounded selection');
  const commit = read(`commits/${encode(selection.ref)}`, '{sha: .sha, tree: .commit.tree.sha}');
  if (!SHA.test(commit?.sha) || !SHA.test(commit?.tree) || (SHA.test(selection.ref) && commit.sha !== selection.ref)) throw failure('Invalid or mismatched resolved commit identity', 'failed');
  const cache = new Map();
  function tree(sha) {
    if (cache.has(sha)) return cache.get(sha);
    const data = read(`git/trees/${sha}`);
    if (data?.sha !== sha || data.truncated !== false || !Array.isArray(data.tree) || data.tree.length > 4096) throw failure('Truncated, oversized or invalid Git tree response', 'failed');
    const entries = new Map();
    for (const e of data.tree) {
      if (typeof e.path !== 'string' || !e.path || e.path === '.' || e.path === '..' || /[\x00/]/.test(e.path) || !SHA.test(e.sha) || entries.has(e.path) ||
          !((e.type === 'tree' && e.mode === '040000') || (e.type === 'blob' && ['100644', '100755', '120000'].includes(e.mode) && Number.isSafeInteger(e.size) && e.size >= 0) || (e.type === 'commit' && e.mode === '160000'))) throw failure('Malformed Git tree entry', 'failed');
      entries.set(e.path, e);
    }
    cache.set(sha, entries); return entries;
  }
  const root = tree(commit.tree);
  const legal = [...root.keys()].filter(p => /^(?:licen[cs]e|notice|copying)(?:[.-][^/]+)?$/i.test(p)).sort();
  if (legal.length > 8) throw failure('More than 8 root legal notices; refusing incomplete automatic coverage');
  let requested = selection.paths;
  if (selection.readmeOnly) {
    const order = ['readme.md', 'readme.markdown', 'readme.rst', 'readme.txt', 'readme'];
    const names = [...root.keys()].filter(p => order.includes(p.toLowerCase())).sort((a,b) => order.indexOf(a.toLowerCase()) - order.indexOf(b.toLowerCase()) || a.localeCompare(b));
    if (!names.length) return { commit: commit.sha, entries: [{ path: 'README preset', status: 'refused', reason: 'No supported root README found' }], files: [], requested: [] };
    requested = [names[0]];
  }
  const paths = [...new Set([...requested, ...legal])].sort(), entries = [], files = [];
  let bytes = 0;
  for (const path of paths) {
    const entry = { path, role: requested.includes(path) ? 'requested' : 'root-legal', status: 'selected' };
    entries.push(entry);
    try {
      if (!validSelectedPath(path)) throw failure('Unsafe selected or root-legal path');
      let current = root, item;
      const parts = path.split('/');
      for (let i = 0; i < parts.length; i++) {
        item = current.get(parts[i]);
        if (!item) throw failure('Requested file is absent at the resolved commit');
        if (i < parts.length - 1) {
          if (item.type !== 'tree') throw failure('Path traverses a symlink, submodule or non-directory');
          current = tree(item.sha);
        }
      }
      if (item.type !== 'blob' || !['100644','100755'].includes(item.mode)) throw failure('Not a regular Git blob (directory, symlink or submodule)');
      if (item.size > MAX_FILE || bytes + item.size > MAX_TOTAL) throw failure('Selected content exceeds 256 KiB/file or 8 MiB total');
      const blob = read(`git/blobs/${item.sha}`);
      const b64 = typeof blob?.content === 'string' ? blob.content.replace(/\n/g, '') : '';
      if (blob?.sha !== item.sha || blob.encoding !== 'base64' || blob.size !== item.size || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64)) throw failure('Invalid blob identity, encoding or size', 'failed');
      const buffer = Buffer.from(b64, 'base64');
      if (buffer.length !== item.size || buffer.toString('base64') !== b64 || createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex') !== item.sha) throw failure('Git blob hash/decoded-size mismatch', 'failed');
      let content;
      try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); } catch { throw failure('Not valid UTF-8 text'); }
      if (buffer.includes(0) || /[\x01-\x08\x0b\x0c\x0e-\x1f]/.test(content)) throw failure('Binary/control-byte content');
      bytes += buffer.length;
      Object.assign(entry, { blob: item.sha, bytes: buffer.length, sha256: digest(buffer), mode: item.mode });
      files.push({ ...entry, content });
    } catch (e) { entry.status = e.selectionStatus || 'failed'; entry.reason = e.message; }
  }
  return { commit: commit.sha, requested, entries, files, bytes };
}

function clipping(file, options) {
  const { owner, repo, commit, quality, topic } = options;
  const source = `https://github.com/${encode(owner)}/${encode(repo)}/blob/${commit}/${file.path.split('/').map(encode).join('/')}`;
  const text = file.content.replace(/\r\n/g, '\n');
  let fenceLength = 3;
  for (const m of text.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, m[0].length + 1);
  const fence = '`'.repeat(fenceLength);
  const md = /\.mdx?$/i.test(file.path) ? text.trim() : `${fence}\n${text.replace(/\n+$/, '')}\n${fence}`;
  const hash = digest(md), title = `${repo}/${file.path} at ${commit}`;
  const fm = buildFrontmatter({ title, source, quality, topic, hash, created: new Date().toISOString().slice(0,10), suppliedSha256: file.sha256 });
  const extra = `github-commit: "${commit}"\ngithub-blob: "${file.blob}"\nsource-bytes: ${file.bytes}\n`;
  const body = `${fm.slice(0, -3)}${extra}---\n\n${md}\n`;
  // Body identity includes source commit/path/topic/provenance, but not the capture date.
  const identity = digest(body.replace(/^created: .*$/m, 'created:'));
  return { ...file, source, hash, name: `${slugify(file.path).slice(0,50) || 'file'}-${digest(file.path).slice(0,12)}-${identity.slice(0,20)}.md`, body };
}

function safeDirectory(vault, segments) {
  const root = realpathSync(vault); let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try { mkdirSync(current); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const st = lstatSync(current), rel = relative(root, realpathSync(current));
    if (st.isSymbolicLink() || !st.isDirectory() || isAbsolute(rel) || rel.startsWith('..')) throw failure('Unsafe selective output directory', 'failed');
  }
  return current;
}
function sameExisting(path, body) {
  const st = absent(path);
  if (!st) return false;
  if (!st.isFile() || st.isSymbolicLink() || st.size > 2 * 1024 * 1024) throw failure('Unsafe or conflicting immutable destination', 'failed');
  const stable = s => s.replace(/^created: .*$/m, 'created:');
  if (stable(readFileSync(path, 'utf8')) !== stable(body)) throw failure('Immutable destination differs; no overwrite permitted', 'failed');
  return true;
}

// A failed write must never expose a partial immutable destination. The hard link publishes
// a complete flushed file atomically without replacing any existing name, on the same volume.
export function publishImmutable(path, body, { write = writeFileSync, link = linkSync } = {}) {
  const stage = mkdtempSync(join(dirname(path), '.capture-stage-')), file = join(stage, 'body');
  let fd, error;
  const cleanupWarnings = [];
  try {
    fd = openSync(file, 'wx'); write(fd, body); fsyncSync(fd); closeSync(fd); fd = undefined;
    link(file, path);
  } catch (e) { error = e; }
  if (fd !== undefined) { try { closeSync(fd); } catch (e) { cleanupWarnings.push(e.message); } }
  try { unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') cleanupWarnings.push(e.message); }
  try { rmdirSync(stage); } catch (e) { cleanupWarnings.push(e.message); }
  if (error) { if (cleanupWarnings.length) error.staging = stage; throw error; }
  return { cleanupWarnings, ...(cleanupWarnings.length ? { staging: stage } : {}) };
}

export function captureSelection({ owner, repo, selection, vaultPath, quality = 'medium', topic, record = () => {}, read = githubObjectReader(owner, repo), publish = publishImmutable }) {
  let plan;
  try { plan = prepare({ owner, repo, selection, read }); }
  catch (e) { return { status: 'failed', mode: 'selected', error: e.message, refused: e.selectionStatus === 'refused' ? 1 : 0, failed: e.selectionStatus === 'refused' ? 0 : 1, selected: 0, clipped: 0, unchanged: 0, entries: [] }; }
  const summary = { mode: 'selected', commit: plan.commit, requested: plan.requested.length, selected: plan.files.length, refused: plan.entries.filter(e=>e.status==='refused').length, failed: plan.entries.filter(e=>e.status==='failed').length, bytes: plan.bytes || 0, clipped: 0, unchanged: 0, entries: plan.entries, cleanupWarnings: [] };
  if (summary.refused || summary.failed) return { ...summary, status: 'failed', error: 'Selection preflight failed; no clippings written' };
  const files = plan.files.map(f => clipping(f, { owner, repo, commit: plan.commit, quality, topic }));
  const manifestData = { schema: 'wiki-master/github-selection@1', repository: `${owner}/${repo}`, requestedRef: selection.ref, commit: plan.commit, preset: selection.readmeOnly ? 'readme' : null, requested: plan.requested, selected: files.length, bytes: plan.bytes, files: files.map(({path,role,blob,bytes,sha256,mode,name,source,hash})=>({path,role,blob,bytes,sha256,mode,clipping:name,source,renderedSha256:hash})) };
  const md = `# Selected GitHub source files\n\nOnly the listed files were captured; no repository inventory or complete license analysis is claimed.\n\n\`\`\`json\n${JSON.stringify(manifestData,null,2)}\n\`\`\``;
  const body = `${buildFrontmatter({title:`${owner}/${repo} selected files at ${plan.commit}`,source:`https://github.com/${encode(owner)}/${encode(repo)}/tree/${plan.commit}`,quality,topic,hash:digest(md),created:new Date().toISOString().slice(0,10)})}\n\n${md}\n`;
  const manifest = { name: `_selection-${digest(body.replace(/^created: .*$/m, 'created:')).slice(0,32)}.md`, body };
  let outDir;
  let writingEntry;
  try {
    // Separate from gh/<owner>/<repo>: legacy digest pruning must never see these files.
    outDir = safeDirectory(resolve(vaultPath), ['raw','clippings','gh-selected',owner,repo]);
    for (const file of [...files, manifest]) sameExisting(join(outDir,file.name),file.body);
    for (const file of files) {
      const path = join(outDir,file.name), entry = summary.entries.find(e=>e.path===file.path);
      writingEntry = entry;
      if (sameExisting(path,file.body)) { entry.status='unchanged'; summary.unchanged++; continue; }
      record(path); // strict planned-scope reservation; a failure must precede creation
      try { const result = publish(path,file.body); entry.status='clipped'; summary.clipped++; if (result?.cleanupWarnings?.length) summary.cleanupWarnings.push(result); }
      catch (e) { if (e.code==='EEXIST' && sameExisting(path,file.body)) {entry.status='unchanged';summary.unchanged++;} else throw e; }
    }
    const path = join(outDir,manifest.name);
    writingEntry = null;
    let manifestWritten = false;
    if (!sameExisting(path,manifest.body)) {
      record(path);
      try { const result = publish(path,manifest.body); manifestWritten=true; if (result?.cleanupWarnings?.length) summary.cleanupWarnings.push(result); }
      catch (e) { if (e.code!=='EEXIST' || !sameExisting(path,manifest.body)) throw e; }
    }
    return { ...summary, status:'clipped', outDir, manifest:manifest.name, manifestWritten };
  } catch (e) {
    if (writingEntry?.status === 'selected') { writingEntry.status='failed'; writingEntry.reason=e.message; summary.failed++; }
    return { ...summary, status:'failed', error:e.message, outDir, partial:summary.clipped>0, manifestWritten:false, ...(e.staging ? { staging:e.staging } : {}) };
  }
}
