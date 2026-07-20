import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph, computeGraphMetrics } from './lib/graph.mjs';
import { loadIssueLog, openIssues, declinesNearingExpiry } from './lib/triage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ========== Collection ==========

// Clipped, but degraded. The content is in the vault and will be cited, so a
// fidelity flag is a claim about how far you can trust the text — not a request
// to re-clip. buildFrontmatter writes `fidelity` and `extraction`.
function fidelityFlagged(vaultPath) {
  const dir = join(vaultPath, 'raw', 'clippings');
  if (!existsSync(dir)) return [];
  const out = [];
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
    const flag = /^(fidelity|extraction):\s*(.+)$/m.exec(fm);
    if (!flag) continue;
    const value = flag[2].trim().replace(/^["']|["']$/g, '');
    if (!value || value === 'ok' || value === 'clean') continue;
    const src = /^source:\s*(.+)$/m.exec(fm);
    out.push({
      url: src ? src[1].trim().replace(/^["']|["']$/g, '') : `file://${f}`,
      kind: 'fidelity',
      reason: `${flag[1]}: ${value}`,
      title: f.replace(/\.md$/, ''),
      occurrences: 1,
    });
  }
  return out;
}

export function collectTriage(vaultPath, { expiringWithinDays = 30, backlogLimit = 25 } = {}) {
  const issues = openIssues(loadIssueLog(vaultPath));
  const fidelity = fidelityFlagged(vaultPath);

  // De-dupe: a fidelity flag already queued explicitly wins over the scan.
  const queued = new Set(issues.map((i) => `${i.url} ${i.kind}`));
  const fidelityOnly = fidelity.filter((f) => !queued.has(`${f.url} ${f.kind}`));

  const expiring = declinesNearingExpiry(vaultPath, { withinDays: expiringWithinDays });

  let unparsed = [];
  try {
    unparsed = computeGraphMetrics(buildGraph(vaultPath), { now: new Date() }).unparsedSources || [];
  } catch {
    unparsed = [];
  }

  return {
    clipFailures: issues.filter((i) => i.kind !== 'fidelity' && i.kind !== 'attention'),
    attention: issues.filter((i) => i.kind === 'attention'),
    fidelity: [...issues.filter((i) => i.kind === 'fidelity'), ...fidelityOnly],
    expiring,
    backlog: unparsed.slice(0, backlogLimit),
    backlogTotal: unparsed.length,
  };
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
    .map(
      (a) =>
        `<button class="act${a.danger ? ' danger' : ''}" data-url="${esc(url)}" data-kind="${esc(
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
  return `<div class="issue">
  <span class="badge ${esc(item.kind)}">${esc(item.kind)}</span>
  <div class="body">
    ${item.title ? `<div class="title">${esc(item.title)}</div>` : ''}
    ${link}
    ${item.reason ? `<div class="reason">${esc(item.reason)}</div>` : ''}
    ${seen}
  </div>
  ${actions(item.url, item.kind, acts)}
</div>`;
}

function group(title, why, rows) {
  if (!rows.length) return '';
  return `<div class="group">
  <h3>${esc(title)} <span class="count">${rows.length}</span><span class="why">${esc(why)}</span></h3>
  ${rows.join('\n')}
</div>`;
}

export function renderScreen(data) {
  const CLIP_ACTS = [
    { id: 'clipped-manually', label: 'clipped by hand' },
    { id: 'retry', label: 'retry' },
    { id: 'declined', label: 'decline', danger: true },
    { id: 'ignore', label: 'ignore' },
  ];
  const FIDELITY_ACTS = [
    { id: 'acceptable', label: 'acceptable' },
    { id: 'reclip', label: 're-clip' },
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

  const stats = [
    ['clip failures', data.clipFailures.length],
    ['fidelity', data.fidelity.length],
    ['expiring', data.expiring.length],
    ['backlog', data.backlogTotal],
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

  if (total === 0 && data.backlogTotal === 0) {
    return `<h2>Nothing needs you</h2>
<p class="subtitle">No unresolved clip failures, fidelity flags, expiring declines, or ingest backlog.</p>
${summary}
<div class="empty"><div class="big">Queue is clear.</div><div>New issues appear here as they are recorded.</div></div>`;
  }

  const groups = [
    group(
      'Clip failures',
      'wanted, not captured — only a human can resolve',
      data.clipFailures.map((i) => issueRow(i, CLIP_ACTS))
    ),
    group(
      'Needs a decision',
      'queued explicitly by the agent',
      data.attention.map((i) => issueRow(i, CLIP_ACTS))
    ),
    group(
      'Fidelity flags',
      'in the vault, but degraded — affects what you may quote',
      data.fidelity.map((i) => issueRow(i, FIDELITY_ACTS))
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
          },
          EXPIRY_ACTS
        )
      )
    ),
    group(
      `Ingest backlog${data.backlogTotal > data.backlog.length ? ` (showing ${data.backlog.length} of ${data.backlogTotal})` : ''}`,
      'clipped but never turned into wiki pages',
      data.backlog.map((p) =>
        issueRow({ url: p, kind: 'backlog', reason: null, title: null }, BACKLOG_ACTS)
      )
    ),
  ].filter(Boolean);

  return `<h2>Triage</h2>
<p class="subtitle">${total} item${total === 1 ? '' : 's'} needing a decision${
    data.backlogTotal ? ` · ${data.backlogTotal} in ingest backlog` : ''
  }. Dispositions are recorded immediately.</p>
${summary}
${groups.join('\n')}`;
}

// ========== Server plumbing ==========

function sessionDir(vaultPath) {
  return join(vaultPath, '.wiki-master', 'triage-ui');
}

async function serverAlive(info) {
  if (!info) return false;
  try {
    const res = await fetch(info.url, { method: 'GET', signal: AbortSignal.timeout(1500) });
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

function startServer(vaultPath, dir) {
  const child = spawn(process.execPath, [join(HERE, 'triage-ui', 'server.cjs')], {
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

  let info = readInfo(dir);
  if (!(await serverAlive(info))) {
    startServer(vaultPath, dir);
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
  };

  if (info) {
    console.log(JSON.stringify({ type: 'triage-ready', url: info.url, ...counts }));
  } else {
    console.error(
      JSON.stringify({ type: 'triage-server-failed', hint: 'screen written; server did not start', ...counts })
    );
    process.exitCode = 1;
  }
  return { info, counts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
