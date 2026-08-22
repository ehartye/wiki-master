import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph, computeGraphMetrics } from './lib/graph.mjs';
import { loadIssueLog, openIssues, declinesNearingExpiry, settledKeys, issueKey } from './lib/triage.mjs';
import { buildTopicIndex, attributeItems, groupByTopic, topicKey, UNATTRIBUTED } from './lib/topic.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ========== Collection ==========

// Clipped, but degraded. The content is in the vault and will be cited, so a
// fidelity flag is a claim about how far you can trust the text — not a request
// to re-clip. buildFrontmatter writes `fidelity` and `extraction`.
// A clipping is healthy at these grades; anything else is a real quality problem.
const HEALTHY_FIDELITY = new Set(['high', 'ok', 'clean']);

// One pass over raw/clippings/, yielding both things the queue needs from
// frontmatter: the fidelity flags, and the research topic each clipping was
// gathered for. They are read together because the directory is large (1,800+
// files on the reference vault) and scanning it twice to answer two questions
// about the same 1,200 bytes is waste the queue pays on every render.
export function scanClippings(vaultPath) {
  const dir = join(vaultPath, 'raw', 'clippings');
  if (!existsSync(dir)) return { flagged: [], topics: [] };
  const flagged = [];
  const topics = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    let head;
    try {
      head = readFileSync(join(dir, f), 'utf8').slice(0, 1200);
    } catch {
      continue;
    }
    const fm = head.startsWith('---') ? head.slice(3, head.indexOf('\n---', 3)) : '';
    if (!fm) continue;

    const srcLine = /^source:\s*(.+)$/m.exec(fm);
    const url = srcLine ? srcLine[1].trim().replace(/^["']|["']$/g, '') : null;
    const topic = /^topic:\s*(.+)$/m.exec(fm)?.[1].trim().replace(/^["']|["']$/g, '');
    if (topic) {
      // Keyed by BOTH identities because triage rows arrive as both: an issue
      // carries a URL, while a backlog row is the clipping's own vault path.
      topics.push({ path: `raw/clippings/${f}`, url, topic });
    }
    // Read `fidelity` specifically. `extraction:` records HOW the text was read
    // (e.g. ocr) — a method, not a defect — so it must never become a triage
    // item; matching either key also let an earlier `extraction:` line win the
    // regex and mask a real fidelity grade below it.
    const fid = /^fidelity:\s*"?([\w-]+)"?/m.exec(fm)?.[1];
    if (!fid || HEALTHY_FIDELITY.has(fid)) continue;
    flagged.push({
      url: url ?? `file://${f}`,
      kind: 'fidelity',
      reason: `fidelity: ${fid}`,
      title: f.replace(/\.md$/, ''),
      topic: topic ?? null,
      occurrences: 1,
    });
  }
  return { flagged, topics };
}

// Kept as its own export: it is the unit under test in triage-fidelity.test.mjs
// and the narrower contract is the one worth pinning.
export function fidelityFlagged(vaultPath) {
  return scanClippings(vaultPath).flagged;
}

export function collectTriage(
  vaultPath,
  { expiringWithinDays = 30, backlogLimit = 25, hubStubLimit = 25 } = {}
) {
  const log = loadIssueLog(vaultPath);
  const issues = openIssues(log);
  const { flagged: fidelity, topics } = scanClippings(vaultPath);
  const topicIndex = buildTopicIndex(topics);

  // De-dupe against the log, and honour dispositions. Two hazards:
  //  - the same item reaches here by two routes with differently-escaped paths
  //    (a log entry stores the path as passed, frontmatter stores it YAML-escaped),
  //    so keys are normalized before comparison or the row appears twice;
  //  - a DERIVED flag must stay suppressed once dispositioned. openIssues drops a
  //    dispositioned issue, so matching only against OPEN issues let the frontmatter
  //    scan resurrect it — "acceptable" never stuck, and the row returned every run.
  const queued = new Set(issues.map((i) => issueKey(i.url, i.kind)));
  const settled = settledKeys(log);
  const fidelityOnly = fidelity.filter(
    (f) => !queued.has(issueKey(f.url, f.kind)) && !settled.has(issueKey(f.url, f.kind))
  );

  const expiring = declinesNearingExpiry(vaultPath, { withinDays: expiringWithinDays });

  // The backlog is `unsummarizedSources`, not `unparsedSources`. A source cited
  // only by a concept's provenance frontmatter is parsed but has no summary
  // page — it still owes an ingest, and the looser metric would hide it.
  // hubStubs rides along on the same graph pass. It is no longer scored by
  // health.mjs (see the note there): "5+ pages route through an empty page" is a
  // real signal but a bad grade, because its cheapest fix — deleting links or
  // padding with unsourced prose — makes the wiki worse. As a worklist it is
  // exactly right: each row is a page the vault leans on that someone must write.
  let unsummarized = [];
  let hubStubs = [];
  try {
    const m = computeGraphMetrics(buildGraph(vaultPath), { now: new Date() });
    unsummarized = m.unsummarizedSources || [];
    hubStubs = m.hubStubs || [];
  } catch {
    unsummarized = [];
    hubStubs = [];
  }

  // Every row is attributed once, here, against one index — so the topic a
  // chip displays and the topic a row filters by can never diverge. Rows
  // reaching the screen as bare strings (backlog paths, hub-stub paths) are
  // lifted to objects first so they can carry one.
  const attr = (items) => attributeItems(items, topicIndex);
  const paths = (list) => attr(list.map((p) => ({ url: p })));

  const data = {
    clipFailures: attr(issues.filter((i) => i.kind !== 'fidelity' && i.kind !== 'attention')),
    attention: attr(issues.filter((i) => i.kind === 'attention')),
    fidelity: attr([...issues.filter((i) => i.kind === 'fidelity'), ...fidelityOnly]),
    expiring: attr(expiring),
    backlog: paths(unsummarized.slice(0, backlogLimit)),
    backlogTotal: unsummarized.length,
    // Hub-stubs are wiki pages, not clippings — they have no research origin
    // and land in Unattributed by construction. That is correct, not a gap.
    hubStubs: paths(hubStubs.slice(0, hubStubLimit)),
    hubStubTotal: hubStubs.length,
  };

  // Counted over the rows actually rendered, not the untruncated totals: a
  // topic chip claiming 40 items that filters down to 25 is the same
  // silent-truncation lie the bulk buttons are careful to avoid.
  data.topics = groupByTopic([
    ...data.clipFailures, ...data.attention, ...data.fidelity,
    ...data.expiring, ...data.backlog, ...data.hubStubs,
  ]);
  return data;
}

// ========== Rendering ==========

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const isHttp = (u) => /^https?:\/\//i.test(u || '');

// Data attributes rather than inline onclick: a clipped URL is untrusted input,
// and threading it through a JS string literal nested inside an HTML attribute
// needs two correct escapings at once. Attribute-escaping alone is sufficient
// here, and the client reads values via dataset.
function actions(url, kind, acts) {
  return `<div class="actions">${acts
    .map((a) =>
      // A browse action is a file input, not a button: the browser will not
      // disclose a picked file's path, so the bytes go to the local server, which
      // records where it saved them. Same disposition, plus an exact source.
      a.browse
        ? `<label class="act browse"><input type="file" hidden data-url="${esc(url)}" data-kind="${esc(
            kind
          )}">${esc(a.label)}</label>`
        : `<button class="act${a.danger ? ' danger' : ''}" data-url="${esc(url)}" data-kind="${esc(
            kind
          )}" data-act="${esc(a.id)}">${esc(a.label)}</button>`
    )
    .join('')}</div>`;
}

function issueRow(item, acts) {
  const link = isHttp(item.url)
    ? `<a class="url" href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.url)}</a>`
    : `<span class="url">${esc(item.url)}</span>`;
  const seen =
    item.occurrences > 1
      ? `<div class="seen">seen ${item.occurrences}× · first ${esc((item.firstSeen || '').slice(0, 10))}</div>`
      : '';
  // The key goes on every row, including unattributed ones (as ""), so the
  // client filters on an attribute that is always present rather than
  // distinguishing "no topic" from "attribute missing" at read time.
  const tKey = topicKey(item.topic) ?? '';
  const chip = item.topic ? `<span class="topic">${esc(item.topic)}</span>` : '';
  return `<div class="issue" data-topic-key="${esc(tKey)}">
  <span class="badge ${esc(item.kind)}">${esc(item.kind)}</span>
  <div class="body">
    ${item.title ? `<div class="title">${esc(item.title)}</div>` : ''}
    ${link}
    ${item.reason ? `<div class="reason">${esc(item.reason)}</div>` : ''}
    ${chip}
    ${seen}
  </div>
  ${actions(item.url, item.kind, acts)}
</div>`;
}

// Rows that reach the screen as bare paths (backlog, hub-stubs) may arrive as
// strings from a hand-built fixture or as attributed objects from
// collectTriage. Both are lifted to the same shape here so the renderer has
// one contract to reason about.
const pathRow = (p) => (typeof p === 'string' ? { url: p, topic: null } : p);

// The topic bar. Rendered only when at least one item is actually attributed:
// a bar offering "All" and "Unattributed" is two controls that do the same
// thing, and every vault predating topic recording is in exactly that state.
function topicBar(topics = []) {
  const real = topics.filter((t) => t.key);
  if (!real.length) return '';
  const total = topics.reduce((n, t) => n + t.count, 0);
  const chip = (key, label, count, extra = '') =>
    `<button class="topic-chip${extra}" data-topic-filter="${esc(key)}">${esc(label)}<span class="count">${count}</span></button>`;
  const unattributed = topics.find((t) => !t.key);
  return `<div class="topic-bar" role="group" aria-label="Filter by research topic">
  ${chip('*', 'All', total, ' is-on')}
  ${real.map((t) => chip(t.key, t.topic, t.count)).join('\n  ')}
  ${unattributed ? chip('', UNATTRIBUTED, unattributed.count) : ''}
</div>`;
}

let groupSeq = 0;

// Bulk buttons name the count they will actually act on — the rows present in
// the DOM, which for a truncated group is NOT the group total. "Apply to all"
// over a capped list is the same silent-truncation lie the report avoids.
function group(title, why, rows, acts = []) {
  if (!rows.length) return '';
  const id = `g${++groupSeq}`;
  const bulk = acts.length
    ? `<span class="bulk">${acts
        .map(
          (a) =>
            `<button class="act bulk-act${a.danger ? ' danger' : ''}" data-bulk-group="${id}" data-bulk-act="${esc(
              a.id
            )}" data-bulk-count="${rows.length}" data-bulk-label="${esc(a.label)}">${esc(a.label)} all ${rows.length}</button>`
        )
        .join('')}</span>`
    : '';
  return `<div class="group" data-group="${id}">
  <h3>${esc(title)} <span class="count">${rows.length}</span><span class="why">${esc(why)}</span></h3>
  ${bulk ? `<div class="bulk-bar">${bulk}</div>` : ''}
  ${rows.join('\n')}
</div>`;
}

export function renderScreen(data) {
  // Reset per render so a screen's group ids are deterministic — otherwise two
  // renders of identical data produce different markup, which makes diffing
  // screens and asserting on them needlessly awkward.
  groupSeq = 0;

  // `downloaded` is the answer to a paywall: you fetched the source by hand, and
  // the disposition itself is the work order — `apply-reclips --from=<dir>` picks
  // it up and clips it. Distinct from `clipped-by-hand`, which asserts a clipping
  // already exists and asks only for confirmation.
  const CLIP_ACTS = [
    { id: 'downloaded', label: 'browse — clip this file', browse: true },
    { id: 'clipped-manually', label: 'clipped by hand' },
    { id: 'retry', label: 'retry' },
    { id: 'declined', label: 'decline', danger: true },
    { id: 'ignore', label: 'ignore' },
  ];
  const FIDELITY_ACTS = [
    { id: 'acceptable', label: 'acceptable' },
    { id: 'reclip', label: 're-clip' },
    { id: 'downloaded', label: 'browse — clip this file', browse: true },
    { id: 'quarantine', label: 'do not cite', danger: true },
  ];
  const EXPIRY_ACTS = [
    { id: 'keep-declined', label: 'keep declined' },
    { id: 'reconsider', label: 'reconsider' },
  ];
  const BACKLOG_ACTS = [
    { id: 'ingest', label: 'ingest next' },
    { id: 'ignore', label: 'skip' },
  ];

  const HUB_STUB_ACTS = [
    { id: 'ingest', label: 'find sources' },
    { id: 'ignore', label: 'leave stub' },
  ];

  const stats = [
    ['clip failures', data.clipFailures.length],
    ['fidelity', data.fidelity.length],
    ['expiring', data.expiring.length],
    ['backlog', data.backlogTotal],
    ['hub-stubs', data.hubStubTotal ?? 0],
    ['attention', data.attention.length],
  ];

  const total =
    data.clipFailures.length + data.fidelity.length + data.expiring.length + data.attention.length;

  const summary = `<div class="summary">${stats
    .map(
      ([k, n]) =>
        `<div class="stat${n === 0 ? ' is-zero' : ''}"><div class="n">${n}</div><div class="k">${esc(k)}</div></div>`
    )
    .join('')}</div>`;

  if (total === 0 && data.backlogTotal === 0 && !(data.hubStubTotal ?? 0)) {
    return `<h2>Nothing needs you</h2>
<p class="subtitle">No unresolved clip failures, fidelity flags, expiring declines, ingest backlog, or hub-stubs.</p>
${summary}
<div class="empty"><div class="big">Queue is clear.</div><div>New issues appear here as they are recorded.</div></div>`;
  }

  const groups = [
    group(
      'Clip failures',
      'wanted, not captured — only a human can resolve',
      data.clipFailures.map((i) => issueRow(i, CLIP_ACTS)),
      CLIP_ACTS
    ),
    group(
      'Needs a decision',
      'queued explicitly by the agent',
      data.attention.map((i) => issueRow(i, CLIP_ACTS)),
      CLIP_ACTS
    ),
    group(
      'Fidelity flags',
      'in the vault, but degraded — affects what you may quote',
      data.fidelity.map((i) => issueRow(i, FIDELITY_ACTS)),
      FIDELITY_ACTS
    ),
    group(
      'Declines nearing expiry',
      'TTL lapses soon; it will be re-litigated unless you confirm',
      data.expiring.map((e) =>
        issueRow(
          {
            url: e.url,
            kind: 'expiring',
            reason: `${e.reason} — declined ${e.date}, ${e.daysRemaining}d remaining`,
            topic: e.topic ?? null,
          },
          EXPIRY_ACTS
        )
      ),
      EXPIRY_ACTS
    ),
    group(
      `Ingest backlog${data.backlogTotal > data.backlog.length ? ` (showing ${data.backlog.length} of ${data.backlogTotal})` : ''}`,
      'in raw/, but no wiki/sources page summarizes them',
      data.backlog.map((p) =>
        issueRow({ ...pathRow(p), kind: 'backlog', reason: null, title: null }, BACKLOG_ACTS)
      ),
      BACKLOG_ACTS
    ),
    group(
      `Hub-stubs${(data.hubStubTotal ?? 0) > (data.hubStubs?.length ?? 0) ? ` (showing ${data.hubStubs.length} of ${data.hubStubTotal})` : ''}`,
      '5+ pages link here, but the page is empty — needs sources, not padding',
      (data.hubStubs ?? []).map((p) =>
        issueRow({ ...pathRow(p), kind: 'hub-stub', reason: null, title: null }, HUB_STUB_ACTS)
      ),
      HUB_STUB_ACTS
    ),
  ].filter(Boolean);

  return `<h2>Triage</h2>
<p class="subtitle">${total} item${total === 1 ? '' : 's'} needing a decision${
    data.backlogTotal ? ` · ${data.backlogTotal} in ingest backlog` : ''
  }${data.hubStubTotal ? ` · ${data.hubStubTotal} hub-stub${data.hubStubTotal === 1 ? '' : 's'}` : ''}. Dispositions are recorded immediately.</p>
${summary}
${topicBar(data.topics)}
${groups.join('\n')}`;
}

// ========== Server plumbing ==========

function sessionDir(vaultPath) {
  return join(vaultPath, '.wiki-master', 'triage-ui');
}

async function serverAlive(info) {
  if (!info) return false;
  try {
    // /healthz, not '/'. The queue itself is behind the session cookie, so
    // probing it would read 401 as "no server" and start a duplicate every run.
    const res = await fetch(`${info.url}/healthz`, {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function readInfo(dir) {
  const f = join(dir, 'state', 'server-info');
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

function startServer(vaultPath, dir, { remote = false } = {}) {
  const args = [join(HERE, 'triage-ui', 'server.cjs')];
  if (remote) args.push('--remote');
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      WM_TRIAGE_DIR: dir,
      WM_TRIAGE_VAULT: vaultPath,
      WM_TRIAGE_OWNER_PID: '',
    },
  });
  child.unref();
}

export async function main() {
  const { path: vaultPath } = resolveVault();
  const dir = sessionDir(vaultPath);
  mkdirSync(join(dir, 'content'), { recursive: true });
  mkdirSync(join(dir, 'state'), { recursive: true });

  const data = collectTriage(vaultPath);
  writeFileSync(join(dir, 'content', `triage-${Date.now()}.html`), renderScreen(data));

  const remote = process.argv.includes('--remote');
  let info = readInfo(dir);
  if (!(await serverAlive(info))) {
    startServer(vaultPath, dir, { remote });
    for (let i = 0; i < 40 && !(await serverAlive((info = readInfo(dir)))); i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  const counts = {
    clipFailures: data.clipFailures.length,
    attention: data.attention.length,
    fidelity: data.fidelity.length,
    expiring: data.expiring.length,
    backlog: data.backlogTotal,
    hubStubs: data.hubStubTotal,
  };

  if (info) {
    // `link` is what the user needs — it carries the session token, so opening
    // it is the whole login. `url` stays clean for logs and liveness checks.
    console.log(
      JSON.stringify({ type: 'triage-ready', url: info.url, link: info.link, remote: !!info.remote, ...counts })
    );
  } else {
    console.error(
      JSON.stringify({ type: 'triage-server-failed', hint: 'screen written; server did not start', ...counts })
    );
    process.exitCode = 1;
  }
  return { info, counts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
