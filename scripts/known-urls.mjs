import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { normalizeUrl } from './lib/url.mjs';
import { readClippings, knownUrlIndex, newestCapture, urlKey } from './lib/known-urls.mjs';
import { loadDeclines, isDeclined } from './lib/decline.mjs';
import { loadIssueLog, openIssues, ISSUE_KINDS } from './lib/triage.mjs';
import { buildTopicIndex, attributeItem, topicKey, normalizeTopic } from './lib/topic.mjs';
import { CLI_SPECS } from './lib/cli-specs.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

// What discovery asks before it clips anything: is this page already in the vault, and what does a topic hold. The
// answers come from the same reading the clippers use (lib/known-urls.mjs: the first source: line of each file directly
// under raw/clippings, compared after normalizing the URL), so a URL this command calls new is one the clipper would
// not call a duplicate. Every mode only reads: no file, folder or log row is created.
//
//   (no option)               the known source URLs, normalized, one per line
//   --count                   how many there are
//   --check <url>...          one line per URL, in the order given: new | clipped raw/clippings/<name>.md [(+N recapture)] | declined: <reason>
//   --summary --topic <T>     what the topic holds: pages, quality tiers, open triage rows by kind

const USAGE = CLI_SPECS['known-urls'].usage.join('\n');
const TIERS = ['high', 'medium', 'low'];
const flat = (text) => String(text).replace(/\s+/g, ' ').trim();

// The known source URLs as the clipper writes them down, once each, in order.
export function listKnownUrls(vaultPath) {
  const seen = new Map();
  for (const { url } of readClippings(vaultPath)) {
    const key = urlKey(url);
    if (!seen.has(key)) seen.set(key, normalizeUrl(url));
  }
  return [...seen.values()].sort();
}

// The clippings of one URL that are recaptures: they name, in `recapture-of`, another clipping that holds the same URL.
// A name that is missing, or belongs to a clipping of another page, does not make a recapture.
function recapturesOf(entries) {
  const files = new Set(entries.map((e) => `raw/clippings/${e.file}`));
  return entries.filter((e) => e.recaptureOf && e.recaptureOf !== `raw/clippings/${e.file}` && files.has(e.recaptureOf));
}

// The capture to name for a URL: the first one, which is a clipping that is not itself a recapture; the earliest by
// `created`, then by name.
function firstCapture(entries, recaptures) {
  const later = new Set(recaptures);
  const originals = entries.filter((e) => !later.has(e));
  const pool = originals.length ? originals : entries;
  return [...pool].sort((a, b) => (a.created ?? '').localeCompare(b.created ?? '') || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))[0];
}

export function checkUrl(vaultPath, url, { index = knownUrlIndex(vaultPath), declines = loadDeclines(vaultPath) } = {}) {
  const entries = index.get(urlKey(url));
  if (entries?.length) {
    const recaptures = recapturesOf(entries);
    const first = firstCapture(entries, recaptures);
    return `clipped raw/clippings/${first.file}${recaptures.length ? ` (+${recaptures.length} recapture)` : ''}`;
  }
  const declined = declines.find((d) => isDeclined(url, [d]));
  return declined ? `declined: ${flat(declined.reason ?? '')}` : 'new';
}

function frontmatterValue(vaultPath, file, name) {
  const text = readFileSync(join(vaultPath, 'raw', 'clippings', file), 'utf8');
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const m = block.match(new RegExp(`^${name}:[ \\t]*(.*)$`, 'm'));
  if (!m) return null;
  let value = m[1].trim();
  if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { value = value.replace(/^"|"$/g, ''); } }
  else value = value.replace(/^'|'$/g, '');
  return value === '' ? null : String(value);
}

// A page counts once, under the topic and the quality of its newest capture. Triage rows are the open ones of the
// issue log; a row that carries no topic takes the topic of the clipping holding its URL.
export function summarizeTopic(vaultPath, topic) {
  const wanted = topicKey(topic);
  const pages = [];
  for (const entries of knownUrlIndex(vaultPath).values()) {
    const newest = newestCapture(entries);
    pages.push({ url: newest.url, topic: normalizeTopic(frontmatterValue(vaultPath, newest.file, 'topic')), quality: frontmatterValue(vaultPath, newest.file, 'quality') });
  }
  const held = pages.filter((p) => p.topic && topicKey(p.topic) === wanted);
  const tiers = new Map(TIERS.map((t) => [t, 0]));
  for (const p of held) {
    const tier = p.quality ? p.quality.toLowerCase() : 'unrated';
    tiers.set(tier, (tiers.get(tier) ?? 0) + 1);
  }
  const index = buildTopicIndex(pages);
  const rows = openIssues(loadIssueLog(vaultPath)).filter((row) => {
    const own = attributeItem(row, index);
    return own && topicKey(own) === wanted;
  });
  const kinds = new Map();
  for (const row of rows) kinds.set(row.kind, (kinds.get(row.kind) ?? 0) + 1);
  const kindOrder = [...ISSUE_KINDS, ...[...kinds.keys()].filter((k) => !ISSUE_KINDS.includes(k))];
  return { clipped: held.length, tiers, open: rows.length, kinds: kindOrder.filter((k) => kinds.has(k)).map((k) => [k, kinds.get(k)]) };
}

function parse(argv) {
  const o = { count: false, summary: false, check: null, topic: undefined, stray: [] };
  let collecting = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--count') { o.count = true; collecting = false; }
    else if (a === '--summary') { o.summary = true; collecting = false; }
    else if (a === '--check') { o.check ??= []; collecting = true; }
    else if (a.startsWith('--check=')) { (o.check ??= []).push(a.slice('--check='.length)); collecting = true; }
    else if (a === '--topic') {
      collecting = false;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { o.topic = next; i++; } else o.topic = '';
    } else if (a.startsWith('--topic=')) { o.topic = a.slice('--topic='.length); collecting = false; }
    else if (a.startsWith('--') || a === '-h') { /* the guard has accepted or answered it */ }
    else if (collecting) o.check.push(a);
    else o.stray.push(a);
  }
  return o;
}

export function main(argv, { vaultPath, out = console.log, err = console.error } = {}) {
  const o = parse(argv);
  const fail = (message) => { err(`known-urls: ${message}`); return 2; };
  const modes = [o.count, o.check !== null, o.summary].filter(Boolean).length;
  if (modes > 1) return fail('use one of --count, --check and --summary');
  if (o.stray.length) { err(`known-urls: unexpected ${o.stray[0]}`); err(USAGE); return 2; }
  if (o.check !== null && !o.check.length) return fail('--check needs at least one URL: known-urls.mjs --check <url>...');
  if (o.topic !== undefined && !normalizeTopic(o.topic)) return fail('--topic needs a topic: --summary --topic "<topic>"');
  if (o.summary && o.topic === undefined) return fail('--summary needs --topic "<topic>"');
  if (o.topic !== undefined && !o.summary) return fail('--topic is for --summary');
  const vault = vaultPath ?? resolveVault().path;

  if (o.check !== null) {
    const index = knownUrlIndex(vault);
    const declines = loadDeclines(vault);
    for (const url of o.check) out(checkUrl(vault, url, { index, declines }));
    return 0;
  }
  if (o.summary) {
    const topic = normalizeTopic(o.topic);
    const s = summarizeTopic(vault, topic);
    out(`topic: ${topic}`);
    out(`clipped: ${s.clipped}`);
    for (const [tier, n] of s.tiers) out(`quality ${tier}: ${n}`);
    out(`open triage rows: ${s.open}`);
    for (const [kind, n] of s.kinds) out(`  ${kind}: ${n}`);
    out('Declines are not recorded per topic.');
    return 0;
  }
  const urls = listKnownUrls(vault);
  if (o.count) out(String(urls.length));
  else for (const url of urls) out(url);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
