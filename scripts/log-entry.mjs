import { vaultPath as checkedPath } from './lib/vault-path.mjs';
import { writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readStdin } from './lib/read-stdin.mjs';
import { resolveOperationVault } from './lib/vault.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

export function slugify(title) {
  const s = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s || 'entry';
}

export function stamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  const time = `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return { day, time };
}

export function writeLogEntry({ vaultPath, op, title, body = '', now = new Date() }) {
  if (typeof op !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(op)) {
    throw Object.assign(new Error('--op must be a name using letters, digits, hyphens or underscores, starting with a letter or digit'), { exitCode: 2 });
  }
  const { day, time } = stamp(now);
  const slug = slugify(title);
  const oneLineTitle = String(title).replace(/\s*\n\s*/g, ' ').trim();
  const logDir = checkedPath(vaultPath, 'log');
  const base = `${day}-${time}-${op}-${slug}`;
  const content =
    `---\ndate: ${day}\nop: ${op}\ntitle: ${JSON.stringify(oneLineTitle)}\n---\n` +
    `## [${day}] ${op} | ${oneLineTitle}\n\n${body.trim()}\n`;
  for (let i = 1; ; i++) {
    const file = `${base}${i === 1 ? '' : `-${i}`}.md`;
    // Check the final leaf too: an existing or dangling alias can escape log/.
    const target = checkedPath(vaultPath, 'log', file);
    // On Windows, wx alone can create through a dangling file alias. Count the
    // directory entry itself as occupied, then retain wx for concurrent creators.
    if (lstatSync(target, { throwIfNoEntry: false })) continue;
    mkdirSync(logDir, { recursive: true });
    try { writeFileSync(target, content, { flag: 'wx' }); }
    catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    // The public result is vault-relative, with forward slashes on every platform.
    return `log/${file}`;
  }
}

export async function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const op = get('--op');
  const title = get('--title');
  if (!op || !title) {
    console.error('usage: node scripts/log-entry.mjs --op <op> --title "<title>"   (entry body on stdin)');
    process.exit(1);
  }
  const body = process.stdin.isTTY ? '' : await readStdin();
  const { path: vaultPath } = resolveOperationVault('maintenance');
  console.log(writeLogEntry({ vaultPath, op, title, body }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? 1; }
}
