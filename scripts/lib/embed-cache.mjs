import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertVaultPath } from './vault-path.mjs';

// Shared by drift.mjs and search.mjs: both key their cache identically (full
// file content, including frontmatter -- see each caller's own read) so a page
// either one embeds first is free for the other to reuse. Extracted here so
// there is exactly one cache implementation, not two copies to keep in sync.
export function hash(text) { return createHash('sha256').update(text).digest('hex'); }

export function loadCache(dir, vaultPath = dir) {
  const f = assertVaultPath(vaultPath, join(dir, 'embeddings.json'));
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
}

export function saveCache(dir, cache, vaultPath = dir) {
  const file = assertVaultPath(vaultPath, join(dir, 'embeddings.json'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(cache));
}
