import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { normalizeUrl } from './lib/url.mjs';
import { DECLINE_TTL_DAYS, readDeclineLog, declineExpiry, loadDeclines, isDeclined, supersedeDecline } from './lib/decline.mjs';
import { CLI_SPECS } from './lib/cli-specs.mjs';
import { cliGuard, optionValues } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

// The decline log (.wiki-master/declined.json) as a command. A decline could only be lifted from inside a clip, and the
// clip answers "duplicate" before it reaches the decline gate when the page is already in the vault, so a decline on a
// clipped page could not be superseded at all. Nothing here clips, fetches or reads a clipping.
//
//   list [--json]                          every entry: URL, reason, date, expiry, whether superseded
//   show <url>                             the one entry for a URL (exit 1 when there is none)
//   supersede <url> --reason "<text>"      marks the active decline for a URL superseded, with the reason and the date
//                                          (exit 1, nothing written, when no decline is active)
//
// Only supersede writes, and it writes only the decline file.

const USAGE = CLI_SPECS.decline.usage.join('\n');
const key = (url) => normalizeUrl(url).toLowerCase();

function describe(entry) {
  const cutoff = Date.now() - DECLINE_TTL_DAYS * 86400_000;
  const stamp = new Date(entry.date).getTime();
  const expired = !(stamp >= cutoff);
  const superseded = entry.superseded ? { reason: entry.superseded.reason ?? '', date: entry.superseded.date ?? null } : null;
  return {
    url: entry.url,
    reason: entry.reason ?? '',
    date: entry.date ?? null,
    expires: Number.isNaN(stamp) ? null : declineExpiry(entry),
    expired,
    active: !expired && !superseded,
    superseded,
    ...(Array.isArray(entry.history) && entry.history.length ? { history: entry.history } : {}),
  };
}

const flat = (text) => String(text).replace(/\s+/g, ' ').trim();

function statusText(row) {
  if (row.superseded) return `superseded ${row.superseded.date}: ${flat(row.superseded.reason)}${row.expired ? ' (expired)' : ''}`;
  return row.expired ? 'expired' : 'active';
}

function line(row) {
  return [row.url, flat(row.reason), `declined ${row.date}`, `expires ${row.expires}`, statusText(row)].join('\t');
}

// The earlier decisions on a URL, kept in the entry's history when it was declined again after being superseded.
function historyLines(row) {
  return (row.history ?? []).map((h) => `  earlier: ${flat(h.reason ?? '')}\tdeclined ${h.date}${h.superseded ? `\tsuperseded ${h.superseded.date}: ${flat(h.superseded.reason ?? '')}` : ''}`);
}

const entriesOf = (vaultPath) => readDeclineLog(vaultPath).filter((e) => e && typeof e.url === 'string');

// The words that are not options (the subcommand, then the URLs), leaving out the value given to --reason.
function operands(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') { out.push(...args.slice(i + 1)); break; }
    if (args[i] === '--reason') { i++; continue; }
    if (!args[i].startsWith('--')) out.push(args[i]);
  }
  return out;
}

export function main(argv, { vaultPath, out = console.log, err = console.error } = {}) {
  const [sub, ...urls] = operands(argv);
  const args = argv;
  const fail = (message) => { err(`decline: ${message}`); return 2; };
  if (!['list', 'show', 'supersede'].includes(sub)) {
    err(sub === undefined ? 'decline: say what to do: list, show or supersede' : `decline: unknown command ${sub}`);
    err(USAGE);
    return 2;
  }
  const vault = vaultPath ?? resolveVault().path;

  if (sub === 'list') {
    if (urls.length) return fail('list takes no URL (use show <url>)');
    const rows = entriesOf(vault).map(describe);
    if (args.includes('--json')) out(JSON.stringify(rows, null, 2));
    else for (const row of rows) out(line(row));
    return 0;
  }

  if (urls.length !== 1) return fail(`${sub} needs exactly one URL (usage: decline.mjs ${sub} <url>${sub === 'supersede' ? ' --reason "<text>"' : ''})`);
  const [url] = urls;

  if (sub === 'show') {
    const entry = entriesOf(vault).find((e) => key(e.url) === key(url));
    if (!entry) { err(`decline: no decline recorded for ${url}`); return 1; }
    const row = describe(entry);
    out(line(row));
    for (const l of historyLines(row)) out(l);
    return 0;
  }

  const reasons = optionValues(args, 'reason');
  if (!reasons.length || !reasons[0].trim()) return fail('supersede needs a reason: decline.mjs supersede <url> --reason "why this decline no longer holds"');
  if (!loadDeclines(vault).some((d) => isDeclined(url, [d]))) {
    err(`decline: no active decline for ${url}; nothing written`);
    return 1;
  }
  const done = supersedeDecline(vault, url, reasons[0].trim());
  if (!done.done) { err(`decline: no active decline for ${url}; nothing written`); return 1; }
  out('superseded');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
