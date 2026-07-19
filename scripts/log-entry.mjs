import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';

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
  const { day, time } = stamp(now);
  const slug = slugify(title);
  const oneLineTitle = String(title).replace(/\s*\n\s*/g, ' ').trim();
  const logDir = join(vaultPath, 'log');
  mkdirSync(logDir, { recursive: true });
  const base = `${day}-${time}-${op}-${slug}`;
  let file = `${base}.md`;
  let i = 2;
  while (existsSync(join(logDir, file))) {
    file = `${base}-${i}.md`;
    i += 1;
  }
  const content =
    `---\ndate: ${day}\nop: ${op}\ntitle: ${JSON.stringify(oneLineTitle)}\n---\n` +
    `## [${day}] ${op} | ${oneLineTitle}\n\n${body.trim()}\n`;
  writeFileSync(join(logDir, file), content);
  return join('log', file);
}

export function main() {
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
  const body = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
  const { path: vaultPath } = resolveVault();
  console.log(writeLogEntry({ vaultPath, op, title, body }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
