import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let cached = null;
function defaultList() {
  if (cached) return cached;
  const p = fileURLToPath(new URL('../../assets/unreliable-domains.txt', import.meta.url));
  cached = new Set(
    readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith('#'))
  );
  return cached;
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Blocked if the host, or any parent domain above the TLD, is on the list.
export function isBlocked(url, list = defaultList()) {
  const host = domainOf(url);
  if (!host) return false;
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (list.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}
