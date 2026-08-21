import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isGitRepo, commitPaths } from './lib/git.mjs';
import { dirtySet, deltaPaths } from './lib/op.mjs';
import { planAutoRefresh } from './lib/auto-refresh.mjs';
import { refreshIndex, readManifestFile } from './index-embed.mjs';
import { embed as ollamaEmbed, isAvailable, modelPresent, EMBED_MODEL } from './lib/embed.mjs';
import { isContent } from './lib/graph.mjs';
import { findWrappedLinks } from './lib/dewrap-links.mjs';

// See op-begin.mjs for why --untracked-files=all is load-bearing, not cosmetic.
function statusPorcelain(cwd) {
  return execFileSync('git', ['-c', 'core.quotePath=false', '--literal-pathspecs', 'status', '--porcelain', '--untracked-files=all'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

// How many local commits have not reached the upstream, so the gap between
// "committed" and "durable on other machines" stays visible without this
// script acting on it. Never pushes — same rule as purge: pushing is
// outward-facing and belongs to an explicit confirmation step, not a script
// that could run unattended. No upstream configured is tolerated, not an
// error: a freshly cloned or local-only vault has none.
function unpushedCount(cwd) {
  try {
    const out = execFileSync('git', ['rev-list', '--count', '@{u}..HEAD'], { cwd, encoding: 'utf8' }).trim();
    return Number(out);
  } catch {
    return null;
  }
}

// A hard-wrapped wikilink ([[Title\ncontinued]]) freshly introduced by the files THIS
// operation just committed, scanned from their current on-disk content -- scoped to
// exactly the paths that changed, not a full-vault rescan. This is visibility at the
// moment of commit, not a gate: op-commit has no existing "fail the commit" contract
// to extend safely, so nothing here blocks anything -- a found wrap is reported for
// scripts/repair-wrapped-links.mjs to fix afterward, the same reporting-not-blocking
// convention health.mjs already uses for defects it cannot repair automatically
// inline. See scripts/lib/dewrap-links.mjs.
function scanForWrappedLinks(vaultPath, paths) {
  const found = [];
  for (const p of paths) {
    if (!p.endsWith('.md') || !isContent(p)) continue;
    const abs = join(vaultPath, p);
    if (!existsSync(abs)) continue; // deleted as part of this operation — nothing to scan
    const text = readFileSync(abs, 'utf8');
    for (const w of findWrappedLinks(text)) found.push({ page: p, target: w.raw });
  }
  return found;
}

// Reads the token op-begin wrote, computes what THIS operation touched (dirty
// now minus dirty then), commits exactly that, and deletes the token whether
// or not there was anything to commit — an op that ran and found nothing to
// do, or ran against a vault that isn't a git repo, still finished; it should
// not leave scratch state behind for the next run to trip over.
export function commitOp(vaultPath, { op, title, token }) {
  // The token is joined straight into a path, and `unlinkSync` runs on it at the
  // end — so a token carrying `../` would both read and DELETE a file outside
  // .wiki-master/ops/. op-begin only ever emits hex, but this is invoked from
  // skill markdown where an agent assembles the command line, so the shape is
  // checked rather than assumed.
  if (!/^[0-9a-f]{8,64}$/.test(String(token))) {
    return { ok: false, reason: `malformed operation token "${token}" — expected the hex string op-begin printed` };
  }
  const tokenPath = join(vaultPath, '.wiki-master', 'ops', `${token}.json`);
  let record;
  try {
    record = JSON.parse(readFileSync(tokenPath, 'utf8'));
  } catch {
    // Covers both a missing token (readFileSync throws) and a corrupt one
    // (JSON.parse throws) — an unbracketed op must not look successful, so
    // both end up here rather than one silently producing an empty commit.
    return { ok: false, reason: `no such operation token "${token}" — was op-begin run first?` };
  }
  const before = new Set(record.dirty ?? []);

  let outcome;
  if (!isGitRepo(vaultPath)) {
    outcome = {
      ok: true, committed: false, reason: 'not a git repository',
      paths: [], before: [...before].sort(), unpushed: null,
    };
  } else {
    const after = dirtySet(statusPorcelain(vaultPath));
    const paths = deltaPaths(before, after);
    // No `if (paths.length)` guard here, deliberately: commitPaths already
    // returns { committed: false, reason: 'nothing to commit' } on an empty
    // array before it runs a single git command (lib/git.mjs), so a local
    // copy of that check would be untested dead weight, not a second layer
    // of defense — confirmed by mutation testing, not assumed.
    const result = commitPaths(vaultPath, paths, `${op}: ${title}`);
    outcome = {
      ok: true,
      committed: result.committed,
      sha: result.sha,
      reason: result.reason,
      paths,
      before: [...before].sort(),
      unpushed: result.committed ? unpushedCount(vaultPath) : null,
    };
  }
  outcome.wrappedLinks = scanForWrappedLinks(vaultPath, outcome.paths);
  unlinkSync(tokenPath);
  return outcome;
}

// Brings the semantic index back in line with the vault after an operation
// has changed it. This lives in op-commit rather than in each skill's
// markdown because op-commit is already the single choke point every mutating
// operation passes through -- one call here covers ingest, relink, purge and
// a filed query, instead of four places that can each be forgotten.
//
// Three properties hold it together:
//   - It runs AFTER the commit, so a refresh failure cannot reach it.
//   - Nothing it writes can pollute a commit: the index lives under the
//     vault's `.wiki-master/`, which every wiki-master vault gitignores
//     (scripts/init.mjs writes that line).
//   - It never throws and never sets an exit code, but it is never silent
//     either -- a silently stale index is precisely the failure mode the
//     0.11.0 search-health work exists to prevent.
export async function refreshAfterOp(vaultPath, {
  readManifestImpl = readManifestFile,
  isAvailableImpl = isAvailable,
  modelPresentImpl = modelPresent,
  refreshImpl = refreshIndex,
} = {}) {
  const dir = join(vaultPath, '.wiki-master');
  try {
    const indexPresent = Object.keys(readManifestImpl(dir)).length > 0;
    // Ollama is probed only when there is an index worth refreshing. These
    // are network round-trips and planAutoRefresh short-circuits on a
    // missing index before it ever consults them, so a vault that has never
    // built one pays nothing on every commit.
    const reachable = indexPresent ? await isAvailableImpl() : false;
    const present = reachable ? await modelPresentImpl() : false;
    const plan = planAutoRefresh({
      ollama: { reachable, modelPresent: present, model: EMBED_MODEL },
      indexPresent,
    });
    if (!plan.run) return { refreshed: false, notice: plan.notice };

    const r = await refreshImpl({ vaultPath, dir, embedFn: (text) => ollamaEmbed(text) });
    // Never silent about a PARTIAL build either. The index persisted and is
    // usable, but chunks are missing from it, and this notice is the only place
    // that surfaces -- reporting it as a clean build is the same silent-staleness
    // failure this function exists to prevent (#70).
    const failed = r.chunksFailed
      ? `, ${r.chunksFailed} chunk(s) FAILED to embed (retried next run)`
      : '';
    return {
      refreshed: true,
      notice: `semantic index: ${r.filesChanged} file(s) changed, ${r.chunksEmbedded} chunk(s) embedded, `
        + `${r.chunksTotal} total (${(r.elapsedMs / 1000).toFixed(1)}s)${failed}`,
    };
  } catch (err) {
    return { refreshed: false, notice: `semantic index not refreshed — ${err.message}` };
  }
}

export async function main(argv, refreshDeps) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const op = get('--op');
  const title = get('--title');
  const token = get('--since');
  if (!op || !title || !token) {
    console.error('usage: node scripts/op-commit.mjs --op <op> --title "<title>" --since <token>');
    process.exitCode = 1;
    return;
  }
  const { path: vaultPath } = resolveVault();
  const r = commitOp(vaultPath, { op, title, token });

  if (!r.ok) {
    console.error(`op-commit: ${r.reason}`);
    process.exitCode = 1;
    return;
  }
  // A chain rather than early returns: a vault that is not a git repo still
  // has an index that goes stale, so every branch has to reach the refresh
  // at the end of this function.
  if (r.reason === 'not a git repository') {
    console.log('op-commit: this vault is not a git repository — nothing to commit.');
  } else if (r.committed) {
    console.log(`committed ${r.sha.slice(0, 7)}: ${r.paths.length} file(s)`);
    for (const p of r.paths) console.log(`  ${p}`);
  } else {
    console.log(`op-commit: "${op}" made no changes — nothing to commit.`);
  }
  if (r.before.length) {
    console.log(`left alone (already dirty before this operation, not part of it): ${r.before.length} file(s)`);
    for (const p of r.before) console.log(`  ${p}`);
  }
  if (typeof r.unpushed === 'number' && r.unpushed > 0) {
    console.log(`${r.unpushed} commit(s) unpushed. Run \`git push\` from the vault to sync.`);
  }
  if (r.wrappedLinks.length) {
    console.log(`⚠ ${r.wrappedLinks.length} hard-wrapped wikilink(s) in the files just committed — run \`node scripts/repair-wrapped-links.mjs --apply\`:`);
    for (const w of r.wrappedLinks) console.log(`  ${w.page}`);
  }

  const { notice } = await refreshAfterOp(vaultPath, refreshDeps);
  if (notice) console.log(notice);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
