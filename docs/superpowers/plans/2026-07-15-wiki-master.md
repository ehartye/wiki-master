# wiki-master Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use h-superpowers:subagent-driven-development, h-superpowers:team-driven-development, or h-superpowers:executing-plans to implement this plan (ask user which approach). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `wiki-master`, a Claude Code plugin that maintains a Karpathy-style LLM wiki on Obsidian, using the native `obsidian` CLI as the substrate, Claude as the synthesis engine, a unit-tested Node helper layer for deterministic checks, and one Ollama-backed script for semantic drift.

**Architecture:** A thin, testable Node helper library (`scripts/lib/*` + `health/stale/drift.mjs`) wraps the native `obsidian` CLI and does zero-LLM structural computation via dependency injection (so it is testable without a running Obsidian). On top sit two skills (`wiki-maintainer` = the discipline, `obsidian-cli` = the CLI reference) and seven slash commands that orchestrate Claude + the scripts. `/wiki-init` scaffolds the vault contract (folders, typed frontmatter, Web Clipper template, native Bases dashboard).

**Tech Stack:** Node.js ≥18 (ESM `.mjs`, built-in `node:test`, `node:assert`, `node:child_process`, `node:fs`, global `fetch`, `node:crypto`) — **zero runtime dependencies**. Obsidian 1.12+ official CLI. Ollama (optional) for embeddings. Markdown for skills/commands/templates.

**Reference:** Design spec at `docs/superpowers/specs/2026-07-15-wiki-master-design.md`. Read it before starting.

**Testing note:** The Node scripts are built test-first with `node:test`. The markdown deliverables (skills, commands, templates) are not unit-testable prose; each has a **verification step** (a concrete smoke check against the committed fixture vault or a structural assertion) instead of a unit test. That is intentional, not a placeholder.

**Conventions used throughout:**
- All CLI access goes through `scripts/lib/vault.mjs`. Never call `obsidian` directly elsewhere.
- Pure computation functions take injected data/deps and are tested in isolation; a `main()` wires them to real CLI calls.
- Commit after every green test or completed file.

---

## File Structure

**Created:**
- `.claude-plugin/plugin.json` — plugin manifest
- `package.json` — `type: module`, test script, zero deps
- `scripts/lib/vault.mjs` — resolve vault path+name, spawn CLI, JSON parse, running-guard
- `scripts/lib/embed.mjs` — Ollama embedding client (single choke-point) + availability ping
- `scripts/health.mjs` — deterministic structural health + 0–100 score
- `scripts/stale.mjs` — freshness buckets from `reviewed`/`updated`
- `scripts/drift.mjs` — semantic drift (page vs. its sources) via embeddings
- `test/fixtures/vault/**` — committed fixture vault with known structure
- `test/health.test.mjs`, `test/stale.test.mjs`, `test/drift.test.mjs`, `test/vault.test.mjs`, `test/embed.test.mjs`
- `skills/wiki-maintainer/SKILL.md` — the maintenance discipline
- `skills/obsidian-cli/SKILL.md` — native-CLI reference
- `commands/wiki-init.md`, `commands/wiki-ingest.md`, `commands/wiki-query.md`, `commands/wiki-health.md`, `commands/wiki-lint.md`, `commands/wiki-stale.md`, `commands/wiki-relink.md`
- `templates/vault-schema.md` — the vault's own schema doc
- `templates/webclipper-template.json` — Obsidian Web Clipper template
- `templates/stale.base` — native Obsidian Base for the staleness dashboard
- `templates/_templates/source-note.md` — Obsidian template for a source summary page
- `hooks/hooks.json` — optional SessionStart nudge (shipped disabled)

**Modified:**
- `README.md` — usage/install (already scaffolded; expanded in final task)
- `../hartye-claude-plugins/` marketplace manifest (final task)

---

## Phase 0 — Repo & test harness

### Task 0.1: Plugin manifest + package.json

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `package.json`

- [ ] **Step 1: Write `.claude-plugin/plugin.json`**

```json
{
  "name": "wiki-master",
  "description": "Maintain a Karpathy-style LLM wiki on Obsidian using the native obsidian CLI.",
  "version": "0.1.0",
  "author": "hartye"
}
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "wiki-master",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 3: Verify Node runs the test runner (no tests yet)**

Run: `cd C:/Users/ehart/repos/wiki-master && node --test`
Expected: exits 0 with "tests 0" (no test files yet) — confirms the runner works.

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/plugin.json package.json
git commit -m "chore: plugin manifest and node test harness"
```

### Task 0.2: Fixture vault

A committed mini-vault with a **known** structure so deterministic scripts can be tested without a running Obsidian.

**Files:**
- Create: `test/fixtures/vault/index.md`
- Create: `test/fixtures/vault/wiki/concepts/alpha.md`
- Create: `test/fixtures/vault/wiki/concepts/beta.md`
- Create: `test/fixtures/vault/wiki/entities/orphan-entity.md`
- Create: `test/fixtures/vault/wiki/syntheses/hub-stub.md`
- Create: `test/fixtures/vault/raw/sources/source-a.md`

- [ ] **Step 1: Create the fixture files with a known link/stale structure**

`test/fixtures/vault/index.md`:
```markdown
---
type: synthesis
---
# Index
- [[alpha]]
- [[beta]]
- [[hub-stub]]
```

`test/fixtures/vault/wiki/concepts/alpha.md` (links beta; reviewed recently):
```markdown
---
type: concept
created: 2026-07-01
updated: 2026-07-10
reviewed: 2026-07-10
status: maintained
sources: ["[[source-a]]"]
ai-generated: true
---
Alpha is a concept that relates to [[beta]] and cites [[source-a]].
It has enough words to not be a stub: lorem ipsum dolor sit amet consectetur.
```

`test/fixtures/vault/wiki/concepts/beta.md` (dead-end: no outgoing links; stale reviewed):
```markdown
---
type: concept
created: 2026-01-01
updated: 2026-01-05
reviewed: 2026-01-05
status: draft
sources: ["[[source-a]]"]
ai-generated: true
---
Beta stands alone with no outgoing links. It is old and unreviewed since January.
```

`test/fixtures/vault/wiki/entities/orphan-entity.md` (orphan: nothing links to it, and it links nothing → also dead-end):
```markdown
---
type: entity
created: 2026-06-01
updated: 2026-06-01
reviewed: 2026-06-01
status: stub
ai-generated: true
---
Orphan entity. No inbound or outbound links.
```

`test/fixtures/vault/wiki/syntheses/hub-stub.md` (many inbound refs but tiny body → hub-stub):
```markdown
---
type: synthesis
created: 2026-07-01
updated: 2026-07-01
reviewed: 2026-07-01
status: stub
ai-generated: true
---
Hub.
```

`test/fixtures/vault/raw/sources/source-a.md` (immutable raw source):
```markdown
---
title: Source A
source: https://example.com/a
created: 2026-07-01
tags: [clippings]
---
Source A body about alpha and beta and neural scaling laws.
```

- [ ] **Step 2: Commit**

```bash
git add test/fixtures/vault
git commit -m "test: committed fixture vault with known link/stale structure"
```

---

## Phase 1 — Deterministic Node engine (TDD)

### Task 1.1: `scripts/lib/vault.mjs` — path/name resolution

**Files:**
- Create: `scripts/lib/vault.mjs`
- Test: `test/vault.test.mjs`

- [ ] **Step 1: Write the failing test**

`test/vault.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { resolveVault } from '../scripts/lib/vault.mjs';

test('resolveVault defaults to ~/.wiki-master-vault', () => {
  const prev = process.env.WIKI_MASTER_VAULT;
  const prevName = process.env.WIKI_MASTER_VAULT_NAME;
  delete process.env.WIKI_MASTER_VAULT;
  delete process.env.WIKI_MASTER_VAULT_NAME;
  const v = resolveVault();
  assert.equal(v.path, join(homedir(), '.wiki-master-vault'));
  assert.equal(v.name, '.wiki-master-vault');
  if (prev !== undefined) process.env.WIKI_MASTER_VAULT = prev;
  if (prevName !== undefined) process.env.WIKI_MASTER_VAULT_NAME = prevName;
});

test('resolveVault honors WIKI_MASTER_VAULT override', () => {
  process.env.WIKI_MASTER_VAULT = '/tmp/my vault';
  delete process.env.WIKI_MASTER_VAULT_NAME;
  const v = resolveVault();
  assert.equal(v.path, '/tmp/my vault');
  assert.equal(v.name, basename('/tmp/my vault'));
  delete process.env.WIKI_MASTER_VAULT;
});

test('resolveVault honors WIKI_MASTER_VAULT_NAME override', () => {
  process.env.WIKI_MASTER_VAULT = '/tmp/whatever';
  process.env.WIKI_MASTER_VAULT_NAME = 'MyWiki';
  const v = resolveVault();
  assert.equal(v.name, 'MyWiki');
  delete process.env.WIKI_MASTER_VAULT;
  delete process.env.WIKI_MASTER_VAULT_NAME;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/vault.test.mjs`
Expected: FAIL — cannot find `resolveVault`.

- [ ] **Step 3: Write minimal implementation**

`scripts/lib/vault.mjs`:
```javascript
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

export function resolveVault() {
  const path = process.env.WIKI_MASTER_VAULT || join(homedir(), '.wiki-master-vault');
  const name = process.env.WIKI_MASTER_VAULT_NAME || basename(path);
  return { path, name };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/vault.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/vault.mjs test/vault.test.mjs
git commit -m "feat(vault): resolve vault path and name with env overrides"
```

### Task 1.2: `scripts/lib/vault.mjs` — CLI spawn wrapper

**Files:**
- Modify: `scripts/lib/vault.mjs`
- Test: `test/vault.test.mjs` (append)

- [ ] **Step 1: Append failing tests for `buildArgs`**

We test the pure argument builder (not the actual spawn). Append to `test/vault.test.mjs`:
```javascript
import { buildArgs } from '../scripts/lib/vault.mjs';

test('buildArgs prepends vault= and passes through args', () => {
  const args = buildArgs('MyWiki', ['orphans', 'format=json']);
  assert.deepEqual(args, ['vault=MyWiki', 'orphans', 'format=json']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/vault.test.mjs`
Expected: FAIL — `buildArgs` not exported.

- [ ] **Step 3: Implement `buildArgs`, `obsidian`, `obsidianJson`, `assertRunning`**

Append to `scripts/lib/vault.mjs`:
```javascript
export function buildArgs(name, args) {
  return [`vault=${name}`, ...args];
}

export function obsidian(args, { name = resolveVault().name } = {}) {
  try {
    return execFileSync('obsidian', buildArgs(name, args), {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString();
    throw new Error(`obsidian ${args.join(' ')} failed: ${msg}`);
  }
}

export function obsidianJson(args, opts) {
  const out = obsidian([...args, 'format=json'], opts);
  return out ? JSON.parse(out) : null;
}

export function assertRunning() {
  const { name } = resolveVault();
  let vaults;
  try {
    vaults = obsidian(['vaults'], { name });
  } catch {
    throw new Error(
      'Obsidian CLI unavailable. Ensure Obsidian 1.12+ is running and the CLI is enabled (Settings → General → Command line interface).'
    );
  }
  if (!vaults.split(/\r?\n/).some((l) => l.includes(name))) {
    throw new Error(
      `Vault "${name}" is not registered. Open the vault folder in Obsidian once (see /wiki-init).`
    );
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/vault.test.mjs`
Expected: PASS (4 tests). The spawn functions aren't invoked by tests (they need a running Obsidian); only `buildArgs` is unit-tested.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/vault.mjs test/vault.test.mjs
git commit -m "feat(vault): obsidian CLI spawn wrapper, json helper, running-guard"
```

### Task 1.3: `scripts/health.mjs` — structural health score

**Files:**
- Create: `scripts/health.mjs`
- Test: `test/health.test.mjs`

- [ ] **Step 1: Write the failing test**

`test/health.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHealth } from '../scripts/health.mjs';

// Injected raw CLI data mirroring the fixture vault.
const deps = {
  orphans: ['wiki/entities/orphan-entity.md'],
  deadEnds: ['wiki/concepts/beta.md', 'wiki/entities/orphan-entity.md'],
  brokenLinks: [],
  backlinkCounts: {
    'wiki/concepts/alpha.md': 1,
    'wiki/concepts/beta.md': 1,
    'wiki/syntheses/hub-stub.md': 8,
    'wiki/entities/orphan-entity.md': 0,
  },
  wordCounts: {
    'wiki/concepts/alpha.md': 20,
    'wiki/concepts/beta.md': 18,
    'wiki/syntheses/hub-stub.md': 1,
    'wiki/entities/orphan-entity.md': 6,
  },
};

test('computeHealth flags the seeded orphan, dead-ends, and hub-stub', () => {
  const r = computeHealth(deps);
  assert.deepEqual(r.orphans, ['wiki/entities/orphan-entity.md']);
  assert.equal(r.deadEnds.length, 2);
  assert.deepEqual(r.hubStubs, ['wiki/syntheses/hub-stub.md']);
  assert.equal(r.brokenLinks.length, 0);
});

test('computeHealth returns a bounded 0-100 score below 100 when issues exist', () => {
  const r = computeHealth(deps);
  assert.ok(r.score < 100 && r.score >= 0);
});

test('computeHealth returns 100 for a clean vault', () => {
  const r = computeHealth({
    orphans: [], deadEnds: [], brokenLinks: [],
    backlinkCounts: { 'a.md': 1, 'b.md': 1 },
    wordCounts: { 'a.md': 50, 'b.md': 50 },
  });
  assert.equal(r.score, 100);
  assert.deepEqual(r.hubStubs, []);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/health.test.mjs`
Expected: FAIL — `computeHealth` undefined.

- [ ] **Step 3: Implement `computeHealth` + `main`**

`scripts/health.mjs`:
```javascript
import { obsidian, assertRunning } from './lib/vault.mjs';
import { pathToFileURL } from 'node:url';

const STUB_WORD_FLOOR = 10;

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function stddev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function computeHealth({ orphans, deadEnds, brokenLinks, backlinkCounts, wordCounts }) {
  const counts = Object.values(backlinkCounts);
  const threshold = mean(counts) + 2 * stddev(counts);
  const hubStubs = Object.keys(backlinkCounts).filter(
    (p) => backlinkCounts[p] > threshold && (wordCounts[p] ?? 0) < STUB_WORD_FLOOR
  );
  // Independent, individually-capped penalties, then summed (avoids saturation).
  const penalty =
    Math.min(30, brokenLinks.length * 3) +
    Math.min(25, orphans.length * 2) +
    Math.min(20, deadEnds.length * 2) +
    Math.min(15, hubStubs.length * 5);
  const score = Math.max(0, 100 - penalty);
  const report =
    `Wiki health: ${score}/100\n` +
    `  broken links: ${brokenLinks.length}\n` +
    `  orphans:      ${orphans.length}\n` +
    `  dead-ends:    ${deadEnds.length}\n` +
    `  hub-stubs:    ${hubStubs.length}` +
    (hubStubs.length ? `\n    ${hubStubs.join('\n    ')}` : '');
  return { score, orphans, deadEnds, brokenLinks, hubStubs, report };
}

function lines(out) { return out ? out.split(/\r?\n/).filter(Boolean) : []; }

export function main() {
  assertRunning();
  const orphans = lines(obsidian(['orphans']));
  const deadEnds = lines(obsidian(['deadends']));
  const brokenLinks = lines(obsidian(['unresolved']));
  const files = lines(obsidian(['files', 'ext=md'])).filter((p) => p.startsWith('wiki/'));
  const backlinkCounts = {};
  const wordCounts = {};
  for (const p of files) {
    try { backlinkCounts[p] = Number(obsidian(['backlinks', `path=${p}`, 'total'])) || 0; }
    catch { backlinkCounts[p] = 0; }
    try { wordCounts[p] = Number(obsidian(['wordcount', `path=${p}`, 'words'])) || 0; }
    catch { wordCounts[p] = 0; }
  }
  const r = computeHealth({ orphans, deadEnds, brokenLinks, backlinkCounts, wordCounts });
  console.log(r.report);
  return r;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

> Note: the `main()` CLI-shape (`backlinks … total`, `wordcount … words`, `files ext=md`) is verified against the live CLI in the Phase 5 smoke task; the unit tests cover `computeHealth`.

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/health.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/health.mjs test/health.test.mjs
git commit -m "feat(health): deterministic structural health score"
```

### Task 1.4: `scripts/stale.mjs` — freshness buckets

**Files:**
- Create: `scripts/stale.mjs`
- Test: `test/stale.test.mjs`

- [ ] **Step 1: Write the failing test**

`test/stale.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStale } from '../scripts/stale.mjs';

const today = new Date('2026-07-15');
const pages = [
  { path: 'alpha.md', reviewed: '2026-07-10', updated: '2026-07-10' }, // 5d fresh
  { path: 'beta.md', reviewed: '2026-01-05', updated: '2026-01-05' },  // ~191d rotten
  { path: 'gamma.md', reviewed: '2026-06-01', updated: '2026-06-20' }, // uses max -> 25d fresh
  { path: 'delta.md', reviewed: '2026-05-01', updated: '2026-05-01' }, // ~75d aging
  { path: 'eps.md', reviewed: '2026-03-01', updated: '2026-03-01' },   // ~136d stale
];

test('computeStale buckets by days since max(reviewed, updated)', () => {
  const r = computeStale(pages, { today });
  assert.deepEqual(r.buckets.fresh.map((p) => p.path).sort(), ['alpha.md', 'gamma.md']);
  assert.deepEqual(r.buckets.aging.map((p) => p.path), ['delta.md']);
  assert.deepEqual(r.buckets.stale.map((p) => p.path), ['eps.md']);
  assert.deepEqual(r.buckets.rotten.map((p) => p.path), ['beta.md']);
});

test('computeStale treats missing dates as rotten', () => {
  const r = computeStale([{ path: 'x.md' }], { today });
  assert.deepEqual(r.buckets.rotten.map((p) => p.path), ['x.md']);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/stale.test.mjs`
Expected: FAIL — `computeStale` undefined.

- [ ] **Step 3: Implement `computeStale` + `main`**

`scripts/stale.mjs`:
```javascript
import { obsidianJson, assertRunning } from './lib/vault.mjs';
import { pathToFileURL } from 'node:url';

const DAY = 86_400_000;
const THRESHOLDS = { fresh: 30, aging: 90, stale: 180 }; // days; beyond stale => rotten

function ageDays(page, today) {
  const ds = [page.reviewed, page.updated].filter(Boolean).map((d) => new Date(d).getTime());
  if (!ds.length) return Infinity;
  return (today.getTime() - Math.max(...ds)) / DAY;
}

export function computeStale(pages, { today = new Date() } = {}) {
  const buckets = { fresh: [], aging: [], stale: [], rotten: [] };
  for (const p of pages) {
    const age = ageDays(p, today);
    const withAge = { ...p, ageDays: age };
    if (age < THRESHOLDS.fresh) buckets.fresh.push(withAge);
    else if (age < THRESHOLDS.aging) buckets.aging.push(withAge);
    else if (age < THRESHOLDS.stale) buckets.stale.push(withAge);
    else buckets.rotten.push(withAge);
  }
  const report =
    `Freshness: fresh ${buckets.fresh.length} · aging ${buckets.aging.length} · ` +
    `stale ${buckets.stale.length} · rotten ${buckets.rotten.length}`;
  return { buckets, report };
}

// Reads pages via the native Bases dashboard (stale.base view "all").
export function main() {
  assertRunning();
  const rows = obsidianJson(['base:query', 'file=stale.base', 'view=all']) || [];
  const pages = rows.map((r) => ({
    path: r['file.path'] ?? r.path ?? r.file,
    reviewed: r.reviewed,
    updated: r.updated,
    type: r.type,
  }));
  const r = computeStale(pages, {});
  console.log(r.report);
  for (const p of [...r.buckets.stale, ...r.buckets.rotten]) {
    console.log(`  ${Math.round(p.ageDays)}d  ${p.path}`);
  }
  return r;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/stale.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/stale.mjs test/stale.test.mjs
git commit -m "feat(stale): freshness buckets from reviewed/updated dates"
```

### Task 1.5: `scripts/lib/embed.mjs` — Ollama client

**Files:**
- Create: `scripts/lib/embed.mjs`
- Test: `test/embed.test.mjs`

- [ ] **Step 1: Write the failing test (inject a fake fetch)**

`test/embed.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embed, isAvailable, cosine } from '../scripts/lib/embed.mjs';

test('cosine of identical vectors is 1', () => {
  assert.ok(Math.abs(cosine([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
});
test('cosine of orthogonal vectors is 0', () => {
  assert.equal(cosine([1, 0], [0, 1]), 0);
});

test('embed posts to Ollama and returns the vector', async () => {
  const fakeFetch = async (url, opts) => {
    assert.match(url, /\/api\/embeddings$/);
    const body = JSON.parse(opts.body);
    assert.equal(body.prompt, 'hello');
    return { ok: true, json: async () => ({ embedding: [0.1, 0.2] }) };
  };
  const v = await embed('hello', { fetchImpl: fakeFetch });
  assert.deepEqual(v, [0.1, 0.2]);
});

test('isAvailable returns false when Ollama is unreachable', async () => {
  const failFetch = async () => { throw new Error('ECONNREFUSED'); };
  assert.equal(await isAvailable({ fetchImpl: failFetch }), false);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/embed.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scripts/lib/embed.mjs`**

```javascript
const HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.WIKI_MASTER_EMBED_MODEL || 'nomic-embed-text';

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function embed(text, { fetchImpl = fetch, model = MODEL } = {}) {
  const res = await fetchImpl(`${HOST}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt: text }),
  });
  if (!res.ok) throw new Error(`Ollama embeddings HTTP ${res.status}`);
  const data = await res.json();
  return data.embedding;
}

export async function isAvailable({ fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${HOST}/api/tags`);
    return !!res && res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/embed.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/embed.mjs test/embed.test.mjs
git commit -m "feat(embed): ollama embedding client with cosine + availability ping"
```

### Task 1.6: `scripts/drift.mjs` — semantic drift

**Files:**
- Create: `scripts/drift.mjs`
- Test: `test/drift.test.mjs`

- [ ] **Step 1: Write the failing test (inject a deterministic embedder)**

`test/drift.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDrift } from '../scripts/drift.mjs';

// Fake embedder: map known strings to vectors so cosine is predictable.
const vectors = {
  'alpha body about neural scaling': [1, 0, 0],
  'source about neural scaling': [1, 0.05, 0],     // aligned -> not drifted
  'beta body about cooking recipes': [0, 1, 0],
  'source about neural scaling networks': [1, 0, 0], // orthogonal -> drifted
};
const fakeEmbed = async (t) => vectors[t] ?? [0, 0, 1];

test('computeDrift flags pages whose body diverges from their sources', async () => {
  const pages = [
    { path: 'alpha.md', body: 'alpha body about neural scaling',
      sources: [{ path: 'source-a.md', content: 'source about neural scaling' }] },
    { path: 'beta.md', body: 'beta body about cooking recipes',
      sources: [{ path: 'source-a.md', content: 'source about neural scaling networks' }] },
  ];
  const r = await computeDrift(pages, { embedFn: fakeEmbed, threshold: 0.5 });
  assert.deepEqual(r.drifted.map((d) => d.path), ['beta.md']);
  assert.equal(r.skipped, false);
});

test('computeDrift skips pages with no sources', async () => {
  const r = await computeDrift([{ path: 'x.md', body: 'x', sources: [] }], { embedFn: fakeEmbed });
  assert.deepEqual(r.drifted, []);
  assert.deepEqual(r.evaluated, []);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/drift.test.mjs`
Expected: FAIL — `computeDrift` undefined.

- [ ] **Step 3: Implement `computeDrift` + `main`**

`scripts/drift.mjs`:
```javascript
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolveVault, obsidian, assertRunning } from './lib/vault.mjs';
import { embed as ollamaEmbed, isAvailable, cosine } from './lib/embed.mjs';

const DEFAULT_THRESHOLD = 0.5;

function centroid(vecs) {
  const n = vecs.length;
  const out = new Array(vecs[0].length).fill(0);
  for (const v of vecs) for (let i = 0; i < v.length; i++) out[i] += v[i] / n;
  return out;
}

export async function computeDrift(pages, { embedFn, threshold = DEFAULT_THRESHOLD } = {}) {
  const drifted = [], evaluated = [];
  for (const page of pages) {
    if (!page.sources || page.sources.length === 0) continue;
    const pageVec = await embedFn(page.body);
    const srcVecs = [];
    for (const s of page.sources) srcVecs.push(await embedFn(s.content));
    const sim = cosine(pageVec, centroid(srcVecs));
    evaluated.push({ path: page.path, sim });
    if (sim < threshold) drifted.push({ path: page.path, sim });
  }
  return { drifted, evaluated, skipped: false };
}

// Hash-keyed embedding cache so unchanged text is not re-embedded.
function loadCache(dir) {
  const f = join(dir, 'embeddings.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
}
function saveCache(dir, cache) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'embeddings.json'), JSON.stringify(cache));
}
function hash(text) { return createHash('sha256').update(text).digest('hex'); }

export async function main() {
  if (!(await isAvailable())) {
    console.log('drift skipped (embedder unavailable)');
    return { drifted: [], evaluated: [], skipped: true };
  }
  assertRunning();
  const { path: vaultPath } = resolveVault();
  const cacheDir = join(vaultPath, '.wiki-master');
  const cache = loadCache(cacheDir);
  const cachedEmbed = async (text) => {
    const k = hash(text);
    if (cache[k]) return cache[k];
    const v = await ollamaEmbed(text);
    cache[k] = v;
    return v;
  };
  // Gather synthesis/concept pages and their linked raw sources.
  const files = obsidian(['files', 'ext=md']).split(/\r?\n/).filter(Boolean);
  const pages = [];
  for (const rel of files) {
    if (!/^wiki\/(concepts|syntheses)\//.test(rel)) continue;
    const full = join(vaultPath, rel);
    const body = readFileSync(full, 'utf8');
    const sourceRels = [...body.matchAll(/sources:\s*\[(.*?)\]/gs)]
      .flatMap((m) => [...m[1].matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1]));
    const sources = [];
    for (const srcName of sourceRels) {
      try {
        const p = obsidian(['file', `file=${srcName}`, 'path']).trim();
        sources.push({ path: p, content: readFileSync(join(vaultPath, p), 'utf8') });
      } catch { /* unresolved source link; skip */ }
    }
    pages.push({ path: rel, body, sources });
  }
  const r = await computeDrift(pages, { embedFn: cachedEmbed });
  saveCache(cacheDir, cache);
  if (r.drifted.length === 0) console.log('drift: no pages diverged from their sources');
  for (const d of r.drifted) console.log(`  drift ${d.sim.toFixed(2)}  ${d.path}`);
  return r;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/drift.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite**

Run: `node --test`
Expected: PASS — all suites green (vault, health, stale, embed, drift).

- [ ] **Step 6: Commit**

```bash
git add scripts/drift.mjs test/drift.test.mjs
git commit -m "feat(drift): semantic drift of wiki pages vs their sources"
```

---

## Phase 2 — Skills (the discipline)

### Task 2.1: `skills/obsidian-cli/SKILL.md` — CLI reference

**Files:**
- Create: `skills/obsidian-cli/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: obsidian-cli
description: Reference for driving the native Obsidian command-line interface (v1.12+). Use whenever a wiki-master operation needs to read, search, link, tag, or edit notes in the vault via the `obsidian` CLI.
---

# Driving the Obsidian CLI

The vault is targeted by name: `obsidian vault=<name> <command> ...`. wiki-master
resolves `<name>` from `WIKI_MASTER_VAULT_NAME` or the vault folder's basename.
`file=` resolves by name (like wikilinks); `path=` is an exact vault-relative path.
Prefer the `scripts/lib/vault.mjs` wrapper from Node; use raw commands when acting
directly.

## Read / search
- `obsidian read path=wiki/concepts/alpha.md`
- `obsidian search query="tag:clippings neural" format=json`
- `obsidian search:context query="scaling laws" format=json` — grep-style with lines

## Links & graph (Obsidian's resolved index — do not re-parse)
- `obsidian backlinks file=alpha counts` — who links here
- `obsidian links file=alpha` — outgoing links
- `obsidian orphans` · `obsidian deadends` · `obsidian unresolved` — health signals

## Typed properties (frontmatter)
- `obsidian property:set name=reviewed value=2026-07-15 type=date path=wiki/concepts/alpha.md`
- `obsidian property:read name=reviewed path=...`
- `obsidian properties path=...` — list a note's properties

## Create / edit / move
- `obsidian create path=wiki/sources/foo.md content="..."`
- `obsidian append path=... content="..."`
- `obsidian move file=foo to=wiki/entities`

## Tags, tasks, templates, bases
- `obsidian tags counts` · `obsidian tag name=neural verbose`
- `obsidian base:query file=stale.base view=all format=json`
- `obsidian template:insert name=source-note`

## Escape hatches
- `obsidian command id=<id>` — run any Obsidian command (`obsidian commands` to list)
- `obsidian eval code="<js>"` — arbitrary JS in app context (last resort)

Always assume Obsidian is running. If a command fails, surface the running-guard
message from `scripts/lib/vault.mjs` (`assertRunning`).
```

- [ ] **Step 2: Verify frontmatter parses (structural check)**

Run: `node -e "const s=require('node:fs').readFileSync('skills/obsidian-cli/SKILL.md','utf8'); if(!/^---[\s\S]*?name:\s*obsidian-cli[\s\S]*?description:[\s\S]*?---/.test(s)) throw new Error('bad frontmatter'); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add skills/obsidian-cli/SKILL.md
git commit -m "feat(skill): obsidian-cli native reference"
```

### Task 2.2: `skills/wiki-maintainer/SKILL.md` — the discipline

**Files:**
- Create: `skills/wiki-maintainer/SKILL.md`

- [ ] **Step 1: Write the skill**

````markdown
---
name: wiki-maintainer
description: The discipline for maintaining a Karpathy-style LLM wiki on Obsidian. Use for any wiki-master operation (ingest, query, lint, relink) — it defines the vault contract, workflows, and guardrails that keep the wiki trustworthy.
---

# Maintaining the wiki

You are the disciplined maintainer of an Obsidian LLM-wiki. **Obsidian is the IDE;
you are the programmer; the wiki is the codebase.** The human curates sources and
asks questions; you do all summarizing, cross-referencing, filing, and consistency
bookkeeping. Use the `obsidian-cli` skill for all vault access.

## Non-negotiable guardrails
1. **`raw/` is immutable.** Read raw sources; never edit them. They are the source of truth.
2. **Provenance on every claim.** Each wiki page you write carries `sources: [[...]]`
   linking back to the `raw/` notes it derives from, plus `ai-generated: true`.
3. **Cite when you answer.** Query answers reference the pages/sources they rest on.
4. **Flag, don't invent.** If sources contradict or are silent, say so — never
   paper over a gap with plausible text.

## Vault contract
- `raw/` (+ `raw/clippings/`): immutable sources. `wiki/{sources,entities,concepts,syntheses}`:
  pages you own. `moc/`: navigational hubs. `index.md`: catalog. `log.md`: append-only history.
- Wiki page frontmatter (set via `property:set`, typed):
  `type` (source|entity|concept|synthesis), `created`, `updated`, `reviewed`,
  `status` (stub|draft|maintained), `sources: [[...]]`, `ai-generated: true`.
- Links are `[[wikilinks]]`. `![[embeds]]` are transclusion only — not relationship edges.

## The log
Every operation appends one line to `log.md`:
`## [YYYY-MM-DD] <op> | <title>` — grep-parseable. Ops: ingest, query, lint, relink.

## Workflows
- **Ingest** (`/wiki-ingest`): read the source → write/update `wiki/sources/<slug>.md`
  (summary + `sources: [[raw link]]`) → update the entities/concepts it touches
  (create stubs where missing) → add `[[links]]` both directions → update `index.md`
  → append to `log.md`. One source typically touches 10–15 pages. Stamp `reviewed`.
- **Query** (`/wiki-query`): search relevant pages → synthesize with citations →
  offer to file the answer back as a new `wiki/syntheses/` page so it compounds.
- **Lint** (`/wiki-lint`): run `/wiki-health` first (cheap); then read the flagged
  pages and look for contradictions, stale claims, missing concept pages, and
  missing cross-references; run drift. Report; apply only safe fixes or propose the rest.
- **Relink** (`/wiki-relink`): add inferred `[[links]]`; materialize entities
  referenced ≥3× but unwritten; build/refresh MOCs. Prefer real wikilinks so they
  become part of Obsidian's index.

## Cost discipline
Cheap structural checks (`/wiki-health`) run every session and gate the expensive
semantic passes. Do not run a full lint on an empty or unchanged wiki.
````

- [ ] **Step 2: Verify frontmatter parses**

Run: `node -e "const s=require('node:fs').readFileSync('skills/wiki-maintainer/SKILL.md','utf8'); if(!/^---[\s\S]*?name:\s*wiki-maintainer[\s\S]*?---/.test(s)) throw new Error('bad frontmatter'); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add skills/wiki-maintainer/SKILL.md
git commit -m "feat(skill): wiki-maintainer discipline"
```

---

## Phase 3 — Commands

Each command file follows the same shape: frontmatter (`description`), a one-line
statement of intent, an instruction to load `wiki-maintainer`, and the concrete
steps (which native CLI calls / which script to run). Verification for each is a
structural frontmatter check (the behavioral smoke test is Phase 5).

### Task 3.1: `/wiki-health` and `/wiki-stale` (script-backed, simplest)

**Files:**
- Create: `commands/wiki-health.md`
- Create: `commands/wiki-stale.md`

- [ ] **Step 1: Write `commands/wiki-health.md`**

```markdown
---
description: Fast, zero-LLM structural health report for the wiki (orphans, dead-ends, broken links, hub-stubs, 0–100 score).
---

Run the deterministic health check and report the result to the user.

Steps:
1. Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/health.mjs`
2. Present the score and each category. If broken links or orphans exist, offer to
   run `/wiki-relink` to fix them. Do not modify any files in this command.
```

- [ ] **Step 2: Write `commands/wiki-stale.md`**

```markdown
---
description: Freshness report — buckets wiki pages by how long since they were reviewed/updated, plus semantic drift.
---

Report which wiki pages are going stale.

Steps:
1. Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/stale.mjs`
2. Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/drift.mjs`
3. Summarize the stale/rotten pages and any drifted pages. Offer to re-review the
   worst offenders (which would run an ingest-style refresh and stamp `reviewed`).
```

- [ ] **Step 3: Verify both have frontmatter**

Run: `node -e "for(const f of ['commands/wiki-health.md','commands/wiki-stale.md']){const s=require('node:fs').readFileSync(f,'utf8'); if(!/^---[\s\S]*?description:[\s\S]*?---/.test(s)) throw new Error('bad: '+f)} console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add commands/wiki-health.md commands/wiki-stale.md
git commit -m "feat(cmd): wiki-health and wiki-stale"
```

### Task 3.2: `/wiki-ingest`, `/wiki-query`, `/wiki-lint`, `/wiki-relink`

**Files:**
- Create: `commands/wiki-ingest.md`, `commands/wiki-query.md`, `commands/wiki-lint.md`, `commands/wiki-relink.md`

- [ ] **Step 1: Write `commands/wiki-ingest.md`**

```markdown
---
description: Ingest a source (file path, clipping, or URL already clipped to raw/) into the wiki — summarize, cross-reference, index, log.
argument-hint: [path-or-name of a raw source, or blank to process new clippings]
---

Load the `wiki-maintainer` skill and follow its **Ingest** workflow for: $ARGUMENTS

If $ARGUMENTS is empty, find unprocessed clippings:
`obsidian search query="tag:clippings" format=json` and process any not yet
summarized in `wiki/sources/`.

For each source:
1. Read it (`obsidian read path=...`). Discuss the key takeaways with the user.
2. Write/update `wiki/sources/<slug>.md`: a summary with `sources: [[<raw link>]]`,
   `type: source`, `ai-generated: true`, and typed `created`/`updated`/`reviewed`.
3. Update the entities and concepts it touches; create stubs (`status: stub`) where
   a `[[link]]` has no page yet. Add links in both directions.
4. Update `index.md` and append `## [YYYY-MM-DD] ingest | <title>` to `log.md`.
5. Never edit anything under `raw/`.
```

- [ ] **Step 2: Write `commands/wiki-query.md`**

```markdown
---
description: Answer a question against the wiki with citations, and optionally file the answer back so knowledge compounds.
argument-hint: <your question>
---

Load the `wiki-maintainer` skill and follow its **Query** workflow.

Question: $ARGUMENTS

1. Search the wiki: `obsidian search:context query="..." format=json` (derive good
   query terms from the question). Read the most relevant pages.
2. Synthesize an answer that **cites** the pages/sources it rests on.
3. If the answer is substantive and not already captured, offer to file it as a new
   `wiki/syntheses/<slug>.md` page (with provenance) and update `index.md`/`log.md`.
```

- [ ] **Step 3: Write `commands/wiki-lint.md`**

```markdown
---
description: Periodic deep maintenance pass — structural health, contradictions, stale claims, missing concepts/links, and semantic drift.
---

Load the `wiki-maintainer` skill and follow its **Lint** workflow.

1. Run `/wiki-health` first: `node ${CLAUDE_PLUGIN_ROOT}/scripts/health.mjs`. If the
   wiki is empty or clean, stop early — do not burn tokens.
2. Run drift: `node ${CLAUDE_PLUGIN_ROOT}/scripts/drift.mjs`.
3. Read the flagged pages (orphans, hub-stubs, drifted). Look for: contradictions
   between pages, claims superseded by newer sources, concepts referenced but
   unwritten, and missing cross-references.
4. Apply only safe, unambiguous fixes; present the rest as a proposed change list
   for the user to approve. Stamp `reviewed` on pages you touch. Append a
   `## [YYYY-MM-DD] lint | ...` line to `log.md`.
```

- [ ] **Step 4: Write `commands/wiki-relink.md`**

```markdown
---
description: Deepen relationships — add inferred links, materialize frequently-referenced entities, build/refresh MOCs.
---

Load the `wiki-maintainer` skill and follow its **Relink** workflow.

1. Find unresolved links and orphans: `obsidian unresolved verbose` · `obsidian orphans`.
2. For entities referenced ≥3× (via `obsidian search`) but having no page, create a
   stub page and link it from the mentioning pages.
3. Propose inferred `[[links]]` between related concepts/syntheses; apply the ones
   the user approves so they enter Obsidian's index.
4. Build or refresh MOC hubs in `moc/` for dense clusters. Append a
   `## [YYYY-MM-DD] relink | ...` line to `log.md`.
```

- [ ] **Step 5: Verify all four have frontmatter**

Run: `node -e "for(const f of ['ingest','query','lint','relink'].map(n=>'commands/wiki-'+n+'.md')){const s=require('node:fs').readFileSync(f,'utf8'); if(!/^---[\s\S]*?description:[\s\S]*?---/.test(s)) throw new Error('bad: '+f)} console.log('ok')"`
Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add commands/wiki-ingest.md commands/wiki-query.md commands/wiki-lint.md commands/wiki-relink.md
git commit -m "feat(cmd): ingest, query, lint, relink"
```

---

## Phase 4 — Vault scaffold templates + `/wiki-init`

### Task 4.1: Vault templates

**Files:**
- Create: `templates/vault-schema.md`
- Create: `templates/webclipper-template.json`
- Create: `templates/stale.base`
- Create: `templates/_templates/source-note.md`

- [ ] **Step 1: Write `templates/vault-schema.md`**

```markdown
# Vault schema (wiki-master)

This vault is an LLM-maintained wiki (Karpathy pattern). Maintained by the
`wiki-master` Claude Code plugin.

## Layout
- `raw/` — immutable sources (never edited). `raw/clippings/` — Web Clipper output.
- `wiki/sources|entities|concepts|syntheses` — LLM-owned pages.
- `moc/` — Maps of Content. `index.md` — catalog. `log.md` — append-only history.

## Frontmatter contract
- Raw/clippings: `title, source, author, published, created, tags:[clippings]`.
- Wiki pages: `type, created, updated, reviewed, status, sources:[[...]], ai-generated`.

## Rules
- Raw is the source of truth. Every wiki page cites its `raw/` provenance.
- Links are `[[wikilinks]]`; embeds `![[...]]` are transclusion only.
```

- [ ] **Step 2: Write `templates/webclipper-template.json`**

This matches the Obsidian Web Clipper default schema but targets `raw/clippings/`
and adds a `clipped` marker. Import via Web Clipper → Settings → Templates → Import.

```json
{
  "schemaVersion": "0.1.0",
  "name": "wiki-master clipping",
  "behavior": "create",
  "noteContentFormat": "{{content}}",
  "noteNameFormat": "{{title}}",
  "path": "raw/clippings",
  "properties": [
    { "name": "title", "value": "{{title}}", "type": "text" },
    { "name": "source", "value": "{{url}}", "type": "text" },
    { "name": "author", "value": "{{author}}", "type": "multitext" },
    { "name": "published", "value": "{{published}}", "type": "date" },
    { "name": "created", "value": "{{date}}", "type": "date" },
    { "name": "description", "value": "{{description}}", "type": "text" },
    { "name": "tags", "value": "clippings", "type": "multitext" }
  ]
}
```

- [ ] **Step 3: Write `templates/stale.base`**

Obsidian Bases file (YAML). View `all` exposes the fields `stale.mjs` reads.

```yaml
filters:
  and:
    - file.inFolder("wiki")
views:
  - type: table
    name: all
    order:
      - file.path
      - type
      - reviewed
      - updated
      - status
  - type: table
    name: stale
    filters:
      and:
        - 'reviewed < date(today) - dur("90d")'
    order:
      - reviewed
      - file.path
```

- [ ] **Step 4: Write `templates/_templates/source-note.md`**

```markdown
---
type: source
created:
updated:
reviewed:
status: draft
sources:
ai-generated: true
---
# {{title}}

## Summary

## Key claims

## Links
```

- [ ] **Step 5: Verify JSON is valid + base is valid YAML-ish**

Run: `node -e "JSON.parse(require('node:fs').readFileSync('templates/webclipper-template.json','utf8')); console.log('json ok')"`
Expected: `json ok`.

- [ ] **Step 6: Commit**

```bash
git add templates
git commit -m "feat(templates): vault schema, web clipper template, bases dashboard, source template"
```

### Task 4.2: `/wiki-init` command + scaffold script

`/wiki-init` scaffolds the vault deterministically (folders + starter files copied
from `templates/`), then prints the one-time manual "open as vault" step.

**Files:**
- Create: `scripts/init.mjs`
- Create: `commands/wiki-init.md`
- Test: `test/init.test.mjs`

- [ ] **Step 1: Write the failing test**

`test/init.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffold } from '../scripts/init.mjs';

test('scaffold creates the vault contract folders and starter files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-'));
  scaffold(dir, join(process.cwd(), 'templates'));
  for (const d of ['raw/clippings', 'wiki/sources', 'wiki/entities', 'wiki/concepts',
                    'wiki/syntheses', 'moc', '_templates', '.wiki-master']) {
    assert.ok(existsSync(join(dir, d)), `missing ${d}`);
  }
  assert.ok(existsSync(join(dir, 'index.md')));
  assert.ok(existsSync(join(dir, 'log.md')));
  assert.ok(existsSync(join(dir, 'vault-schema.md')));
  assert.ok(existsSync(join(dir, 'stale.base')));
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /\.wiki-master\//);
});

test('scaffold is idempotent (does not clobber existing index.md)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-'));
  scaffold(dir, join(process.cwd(), 'templates'));
  const { writeFileSync } = require('node:fs');
  writeFileSync(join(dir, 'index.md'), '# Custom');
  scaffold(dir, join(process.cwd(), 'templates'));
  assert.equal(readFileSync(join(dir, 'index.md'), 'utf8'), '# Custom');
});
```

> Note: the second test uses `require` inside ESM via `createRequire` — adjust to
> `import { writeFileSync } from 'node:fs'` at top if your runner disallows it.

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/init.test.mjs`
Expected: FAIL — `scaffold` undefined.

- [ ] **Step 3: Implement `scripts/init.mjs`**

```javascript
import { mkdirSync, existsSync, copyFileSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { resolveVault } from './lib/vault.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIRS = ['raw/clippings', 'wiki/sources', 'wiki/entities', 'wiki/concepts',
              'wiki/syntheses', 'moc', '_templates', '.wiki-master'];

function writeIfAbsent(path, content) {
  if (!existsSync(path)) writeFileSync(path, content);
}

export function scaffold(vaultPath, templatesDir) {
  for (const d of DIRS) mkdirSync(join(vaultPath, d), { recursive: true });
  writeIfAbsent(join(vaultPath, 'index.md'),
    '---\ntype: synthesis\n---\n# Index\n\n_Catalog of wiki pages. Maintained by wiki-master._\n');
  writeIfAbsent(join(vaultPath, 'log.md'), '# Log\n\n');
  writeIfAbsent(join(vaultPath, '.gitignore'), '.wiki-master/\n');
  if (!existsSync(join(vaultPath, 'vault-schema.md')))
    copyFileSync(join(templatesDir, 'vault-schema.md'), join(vaultPath, 'vault-schema.md'));
  if (!existsSync(join(vaultPath, 'stale.base')))
    copyFileSync(join(templatesDir, 'stale.base'), join(vaultPath, 'stale.base'));
  cpSync(join(templatesDir, '_templates'), join(vaultPath, '_templates'), { recursive: true });
}

export function main() {
  const { path, name } = resolveVault();
  const templatesDir = fileURLToPath(new URL('../templates', import.meta.url));
  scaffold(path, templatesDir);
  console.log(`Scaffolded vault at: ${path}`);
  console.log(`\nOne-time setup:`);
  console.log(`  1. In Obsidian: Open folder as vault → ${path}`);
  console.log(`  2. Verify: obsidian vaults   (should list "${name}")`);
  console.log(`  3. Import templates/webclipper-template.json into the Web Clipper.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4: Fix the ESM test detail and run to verify pass**

Replace the `require('node:fs')` line in `test/init.test.mjs` with a top-level
`import { writeFileSync } from 'node:fs';`.
Run: `node --test test/init.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Write `commands/wiki-init.md`**

```markdown
---
description: Scaffold a fresh wiki-master vault (folders, index/log, schema, Bases dashboard, templates) and print the one-time setup steps.
---

Initialize the wiki vault.

1. Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs`
2. Relay the printed one-time setup steps to the user (open as vault, verify with
   `obsidian vaults`, import the Web Clipper template).
3. Once the user confirms the vault is open in Obsidian, run `/wiki-health` to
   confirm the CLI can reach it.
```

- [ ] **Step 6: Run the full suite**

Run: `node --test`
Expected: PASS — all suites green.

- [ ] **Step 7: Commit**

```bash
git add scripts/init.mjs commands/wiki-init.md test/init.test.mjs
git commit -m "feat(init): vault scaffold script + /wiki-init command"
```

---

## Phase 5 — Hooks, live smoke, packaging

### Task 5.1: Disabled SessionStart hook

**Files:**
- Create: `hooks/hooks.json`

- [ ] **Step 1: Write a disabled hook config**

```json
{
  "comment": "Optional SessionStart health nudge. Disabled by default. To enable, move the entry from `disabled` into `hooks`.",
  "hooks": {},
  "disabled": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/health.mjs || true" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Verify valid JSON**

Run: `node -e "JSON.parse(require('node:fs').readFileSync('hooks/hooks.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add hooks/hooks.json
git commit -m "feat(hooks): disabled SessionStart health nudge"
```

### Task 5.2: Live smoke test against a real vault

This is the end-to-end verification that the `main()` CLI shapes match the live CLI.
**Requires Obsidian running.** Uses a throwaway vault so it never touches real data.

- [ ] **Step 1: Scaffold a throwaway vault**

Run:
```bash
WIKI_MASTER_VAULT="$HOME/.wiki-master-smoke" node scripts/init.mjs
```
Expected: prints "Scaffolded vault at …/.wiki-master-smoke" and setup steps.

- [ ] **Step 2: Open it as a vault in Obsidian, then verify registration**

In Obsidian: Open folder as vault → `~/.wiki-master-smoke`.
Run: `obsidian vaults`
Expected: the list includes `.wiki-master-smoke`.

- [ ] **Step 3: Seed one raw source and one linked concept, then run health**

Create `~/.wiki-master-smoke/raw/sources/s.md` and
`~/.wiki-master-smoke/wiki/concepts/c.md` (with `sources: ["[[s]]"]`), then:
Run: `WIKI_MASTER_VAULT="$HOME/.wiki-master-smoke" node scripts/health.mjs`
Expected: prints a health report with a numeric score. If the JSON keys from
`backlinks counts` differ from `path`/`count`, fix `health.mjs`'s `main()` mapping
now and re-run.

- [ ] **Step 4: Run stale and drift**

Run: `WIKI_MASTER_VAULT="$HOME/.wiki-master-smoke" node scripts/stale.mjs`
Expected: a freshness line. If `base:query` returns different key names, fix the
mapping in `stale.mjs`'s `main()`.
Run: `WIKI_MASTER_VAULT="$HOME/.wiki-master-smoke" node scripts/drift.mjs`
Expected: either "drift skipped (embedder unavailable)" (no Ollama) or a drift line.

- [ ] **Step 5: Record results and commit any CLI-shape fixes**

```bash
git add -A
git commit -m "fix: align script CLI mappings with live Obsidian output"
```
(If no fixes were needed, note that in the task and skip the commit.)

### Task 5.3: README + marketplace registration

**Files:**
- Modify: `README.md`
- Modify: `../hartye-claude-plugins/` marketplace manifest

- [ ] **Step 1: Expand `README.md`** with a Commands table (init/ingest/query/health/lint/stale/relink), the env vars (`WIKI_MASTER_VAULT`, `WIKI_MASTER_VAULT_NAME`, `WIKI_MASTER_EMBED_MODEL`, `OLLAMA_HOST`), and the quick-start (install → `/wiki-init` → open as vault → import clipper template → `/wiki-ingest`).

- [ ] **Step 2: Register in the marketplace.** Inspect `../hartye-claude-plugins/` for its marketplace manifest format (e.g. `.claude-plugin/marketplace.json`); add a `wiki-master` entry pointing at this repo, following the existing entries' shape. If the marketplace repo has no manifest yet, create one following Claude Code's marketplace schema.

- [ ] **Step 3: Verify the plugin loads.** In a Claude Code session with the plugin installed, run `/help` (or the plugin list) and confirm the seven `wiki-*` commands appear.

- [ ] **Step 4: Commit (both repos)**

```bash
git add README.md && git commit -m "docs: README usage and quick-start"
# in ../hartye-claude-plugins:
# git add -A && git commit -m "feat: register wiki-master plugin"
```

---

## Definition of done
- `node --test` is green (vault, health, stale, embed, drift, init suites).
- Live smoke (Task 5.2) ran against a real vault; `main()` CLI mappings confirmed/fixed.
- All seven commands + two skills present with valid frontmatter.
- `/wiki-init` scaffolds the vault contract idempotently.
- Plugin registered in the marketplace and its commands appear in Claude Code.
- Guardrails intact: `raw/` never written by any script; every wiki page template
  carries `sources` + `ai-generated`.
