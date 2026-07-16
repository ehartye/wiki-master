# wiki-discover Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use h-superpowers:subagent-driven-development, h-superpowers:team-driven-development, or h-superpowers:executing-plans to implement this plan (ask user which approach). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/wiki-discover <topic>` to wiki-master — parallel "perspective" subagents discover web sources, credibility-rank them, clip survivors into `raw/clippings/` at Web-Clipper fidelity via the Defuddle CLI, show the user a ranked list, and on confirmation hand off to the existing `/wiki-ingest`.

**Architecture:** A deterministic clip helper (`scripts/clip.mjs`) shells `defuddle parse <url> --json`, injects the plugin's frontmatter fields, and writes one immutable clipping — the ONLY writer to `raw/`. A static domain blocklist (`scripts/lib/blocklist.mjs` + `assets/unreliable-domains.txt`) pre-filters spam for zero LLM cost. The discovery discipline (5 perspectives + credibility rubric + dedup rules) lives in a `wiki-discoverer` skill; the `/wiki-discover` command is Claude orchestrating read-only subagents through it. Discovery ends at `raw/clippings/`; everything downstream is the existing, tested pipeline.

**Tech Stack:** Node.js ≥18 (ESM `.mjs`, built-in `node:test`/`assert`/`child_process`/`fs`/`crypto`/`url`) — zero runtime deps in-repo. External tool: **Defuddle CLI** (`npm i -g defuddle`, or via `npx`). Markdown for command/skill.

**Reference:** Design spec at `docs/superpowers/specs/2026-07-15-wiki-discover-design.md`. Read it first. Built on branch `feat/wiki-discover` (off `feat/wiki-master-impl`).

**Conventions:** All CLI access via `scripts/lib/vault.mjs`. Pure functions take injected data and are unit-tested; `main()` wires them to the real Defuddle shell-out + file writes (verified live in Phase 5). Cross-platform main-guard: `if (import.meta.url === pathToFileURL(process.argv[1]).href) main(...)`. Commit after every green test.

---

## File Structure

**Created:**
- `assets/unreliable-domains.txt` — static blocklist (one domain per line, `#` comments)
- `scripts/lib/blocklist.mjs` — `domainOf`, `isBlocked`
- `scripts/clip.mjs` — `slugify`, `buildFrontmatter`, `normalizeUrl`, `isDuplicateUrl`, `main`
- `skills/wiki-discoverer/SKILL.md` — perspectives, credibility rubric, dedup/no-write rules
- `commands/wiki-discover.md` — the orchestrator command
- `test/blocklist.test.mjs`, `test/clip.test.mjs`

**Modified:**
- `scripts/init.mjs` — add a non-fatal Defuddle-availability check to `main()`
- `skills/wiki-maintainer/SKILL.md` — document the `quality` clipping field

---

## Phase 1 — Domain blocklist (TDD)

### Task 1.1: The blocklist asset

**Files:**
- Create: `assets/unreliable-domains.txt`

- [ ] **Step 1: Write the asset** (seed list derived from Wikipedia Perennial Sources "generally unreliable / deprecated / blacklisted" + common content farms; extensible)

```
# wiki-master unreliable-source blocklist. One domain per line; matches the
# domain and any subdomain. Seeded from Wikipedia's Perennial Sources list and
# common content farms/SEO chum. Extend as needed. Lines starting with # ignored.
answers.com
buzzfeed.com
dailymail.co.uk
examiner.com
facebook.com
forbes.com
geocities.com
medium.com
naturalnews.com
pinterest.com
quora.com
reddit.com
scribd.com
slideshare.net
thesun.co.uk
tiktok.com
twitter.com
x.com
wikihow.com
wordpress.com
blogspot.com
substack.com
ehow.com
infowars.com
breitbart.com
rt.com
sputniknews.com
zerohedge.com
```

> Note: `medium.com`/`substack.com`/`wordpress.com`/`blogspot.com`/`x.com` are blocked as *primary sources* because they are open-publishing platforms with no editorial control — the discovery agents should prefer primary/authoritative sources. This is a defensible default; the user can prune the list.

- [ ] **Step 2: Commit**

```bash
git add assets/unreliable-domains.txt
git commit -m "feat(discover): seed unreliable-domain blocklist asset"
```

### Task 1.2: `scripts/lib/blocklist.mjs`

**Files:**
- Create: `scripts/lib/blocklist.mjs`
- Test: `test/blocklist.test.mjs`

- [ ] **Step 1: Write the failing test**

`test/blocklist.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainOf, isBlocked } from '../scripts/lib/blocklist.mjs';

const list = new Set(['example.com', 'spam.net']);

test('domainOf strips www and lowercases', () => {
  assert.equal(domainOf('https://WWW.Example.com/path?q=1'), 'example.com');
  assert.equal(domainOf('http://sub.spam.net/'), 'sub.spam.net');
  assert.equal(domainOf('not a url'), null);
});

test('isBlocked matches domain and any subdomain', () => {
  assert.equal(isBlocked('https://example.com/a', list), true);
  assert.equal(isBlocked('https://news.example.com/a', list), true);
  assert.equal(isBlocked('https://good.org/a', list), false);
  assert.equal(isBlocked('garbage', list), false);
});

test('isBlocked does not match on a bare TLD', () => {
  assert.equal(isBlocked('https://com/', new Set(['com'])), false);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/blocklist.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scripts/lib/blocklist.mjs`**

```javascript
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
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/blocklist.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/blocklist.mjs test/blocklist.test.mjs
git commit -m "feat(discover): domain blocklist matcher"
```

---

## Phase 2 — Clip helper (TDD)

### Task 2.1: Pure helpers — `slugify`, `normalizeUrl`, `isDuplicateUrl`, `buildFrontmatter`

**Files:**
- Create: `scripts/clip.mjs`
- Test: `test/clip.test.mjs`

- [ ] **Step 1: Write the failing test**

`test/clip.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, normalizeUrl, isDuplicateUrl, buildFrontmatter } from '../scripts/clip.mjs';

test('slugify strips illegal chars, collapses, caps length, defaults', () => {
  assert.equal(slugify('Neural Scaling Laws'), 'Neural Scaling Laws');
  assert.equal(slugify('Foo/Bar'), 'Foo-Bar');
  assert.equal(slugify('Trailing: '), 'Trailing');
  assert.equal(slugify(''), 'untitled');
  assert.equal(slugify('a'.repeat(200)).length, 120);
});

test('normalizeUrl drops hash + trailing slash, lowercases host', () => {
  assert.equal(normalizeUrl('https://X.com/A/#frag'), 'https://x.com/A');
  assert.equal(normalizeUrl('https://x.com/a/'), 'https://x.com/a');
});

test('isDuplicateUrl matches ignoring trailing slash / fragment', () => {
  assert.equal(isDuplicateUrl('https://x.com/a/', ['https://x.com/a']), true);
  assert.equal(isDuplicateUrl('https://x.com/b', ['https://x.com/a']), false);
});

test('buildFrontmatter injects plugin fields and omits absent optionals', () => {
  const fm = buildFrontmatter({
    title: 'Scaling Laws', source: 'https://x.com/a', author: 'Jane',
    published: '2025-01-01', created: '2026-07-15', quality: 'high', hash: 'abc123',
  });
  assert.match(fm, /^---\n/);
  assert.match(fm, /title: "Scaling Laws"/);
  assert.match(fm, /source: "https:\/\/x\.com\/a"/);
  assert.match(fm, /author: "Jane"/);
  assert.match(fm, /published: 2025-01-01/);
  assert.match(fm, /created: 2026-07-15/);
  assert.match(fm, /tags: \[clippings\]/);
  assert.match(fm, /quality: high/);
  assert.match(fm, /source-hash: abc123/);
  assert.match(fm, /\n---$/);

  const fm2 = buildFrontmatter({ title: 'X', source: 'u', created: 'd', quality: 'low', hash: 'h' });
  assert.doesNotMatch(fm2, /author:/);
  assert.doesNotMatch(fm2, /published:/);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/clip.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure helpers in `scripts/clip.mjs`**

```javascript
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isBlocked } from './lib/blocklist.mjs';

const THIN_WORD_FLOOR = 100;

export function slugify(title) {
  const s = (title || '')
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim();
  return s.slice(0, 120).replace(/[-\s]+$/, '') || 'untitled';
}

export function normalizeUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    return (x.origin + x.pathname).replace(/\/$/, '');
  } catch {
    return (u || '');
  }
}

export function isDuplicateUrl(url, knownUrls) {
  const n = normalizeUrl(url).toLowerCase();
  return knownUrls.some((k) => normalizeUrl(k).toLowerCase() === n);
}

function yaml(v) { return JSON.stringify(String(v)); }

export function buildFrontmatter({ title, source, author, published, created, quality, hash }) {
  const lines = ['---'];
  lines.push(`title: ${yaml(title)}`);
  lines.push(`source: ${yaml(source)}`);
  if (author) lines.push(`author: ${yaml(author)}`);
  if (published) lines.push(`published: ${published}`);
  lines.push(`created: ${created}`);
  lines.push('tags: [clippings]');
  lines.push(`quality: ${quality}`);
  lines.push(`source-hash: ${hash}`);
  lines.push('---');
  return lines.join('\n');
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/clip.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/clip.mjs test/clip.test.mjs
git commit -m "feat(discover): clip pure helpers (slug, url-dedup, frontmatter)"
```

### Task 2.2: Clip `main()` — the Defuddle shell-out + write

**Files:**
- Modify: `scripts/clip.mjs` (append)

- [ ] **Step 1: Append the integration functions + `main`**

Append to `scripts/clip.mjs`:
```javascript
function wordCount(md) { return (md.match(/\S+/g) || []).length; }
function today() { return new Date().toISOString().slice(0, 10); }

// Existing clipping source: URLs, for dedup.
export function knownSourceUrls(vaultPath) {
  const dir = join(vaultPath, 'raw', 'clippings');
  if (!existsSync(dir)) return [];
  const urls = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const m = readFileSync(join(dir, f), 'utf8').match(/^source:\s*"?([^"\n]+)"?/m);
    if (m) urls.push(m[1].trim());
  }
  return urls;
}

function runDefuddleJson(url) {
  const attempt = (cmd, args) =>
    execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  let out;
  try {
    out = attempt('defuddle', ['parse', url, '--json']);
  } catch {
    out = attempt('npx', ['--yes', 'defuddle', 'parse', url, '--json']);
  }
  return JSON.parse(out);
}

export function main(argv) {
  const url = argv[0];
  if (!url) { console.error('usage: clip.mjs <url> [--quality=high|medium|low]'); process.exit(2); }
  const qArg = argv.find((a) => a.startsWith('--quality='));
  const quality = qArg ? qArg.split('=')[1] : 'medium';

  if (isBlocked(url)) { console.log(`blocked (unreliable domain): ${url}`); return { status: 'blocked' }; }

  const { path: vaultPath } = resolveVault();
  if (isDuplicateUrl(url, knownSourceUrls(vaultPath))) {
    console.log(`duplicate (already clipped): ${url}`); return { status: 'duplicate' };
  }

  let data;
  try { data = runDefuddleJson(url); }
  catch (e) {
    console.error(`defuddle failed for ${url}: ${e.message}\nInstall it: npm i -g defuddle`);
    process.exit(1);
  }

  const md = data.contentMarkdown || data.content || '';
  if (wordCount(md) < THIN_WORD_FLOOR) {
    console.log(`thin content (clip manually): ${url}`); return { status: 'thin' };
  }

  const created = today();
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({
    title: data.title, source: url, author: data.author,
    published: data.published, created, quality, hash,
  });
  const slug = slugify(data.title);
  const file = join(vaultPath, 'raw', 'clippings', `${slug}.md`);
  if (existsSync(file)) { console.log(`exists (slug clash): ${slug}`); return { status: 'duplicate' }; }

  writeFileSync(file, `${fm}\n\n${md}\n`);
  console.log(`clipped: raw/clippings/${slug}.md (quality=${quality})`);
  return { status: 'clipped', slug, file };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
```

- [ ] **Step 2: Run the full suite (nothing should break; main isn't unit-invoked)**

Run: `node --test`
Expected: PASS — all suites green (blocklist + clip pure helpers + existing).

- [ ] **Step 3: Commit**

```bash
git add scripts/clip.mjs
git commit -m "feat(discover): clip main — defuddle shell-out, dedup, thin-guard, write"
```

---

## Phase 3 — Skill + command

### Task 3.1: `skills/wiki-discoverer/SKILL.md`

**Files:**
- Create: `skills/wiki-discoverer/SKILL.md`

- [ ] **Step 1: Write the skill**

````markdown
---
name: wiki-discoverer
description: The discipline for autonomous source discovery in wiki-master (/wiki-discover). Defines the perspective agents, the credibility rubric, dedup rules, and the hand-off to clipping — so discovery finds good, non-duplicate, credible sources without writing the vault.
---

# Discovering sources for the wiki

Given a topic, find the best web sources, credibility-rank them, clip the
survivors, and hand off to `/wiki-ingest`. **Discovery agents are read-only
researchers: they RETURN candidates and NEVER write the vault.** The only writer
is `scripts/clip.mjs`.

## Phase 0 — dedup before searching
Gather what the wiki already has so agents hunt for *gaps*, not dupes:
- Known source URLs: `obsidian search query="tag:clippings" format=json`, then read
  each clipping's `source:` (or use `scripts/clip.mjs`'s `knownSourceUrls`).
- Coverage summary: read `index.md`.
Pass the known-URL set + a one-line "already covered" summary to every agent.

## Phase 1 — five perspective agents, in parallel (one message, Agent tool)
Each agent gets: the topic, the known-URL set, the coverage summary, and its lens.
Each runs 2–3 *varied* `WebSearch` queries, pre-skips any result whose domain is on
the blocklist, `WebFetch`es the promising hits, and **returns a ranked candidate
list** — it writes nothing. Lenses:
- **Academic** — papers, textbooks, primary research, .edu.
- **Technical** — official docs, specs, standards, source repos.
- **Applied** — case studies, real-world usage, tutorials from practitioners.
- **News/Trends** — recent developments, reputable reporting (last ~2 years).
- **Contrarian** — critiques, failure modes, dissenting analysis.

Each candidate: `{ title, url, quality_guess: high|medium|low, key_findings,
why_ingest }`.

## Phase 2 — independent select + credibility (do NOT let a finder grade itself)
As the orchestrator (or a separate reviewer), over the pooled candidates:
1. Dedup by URL (normalize: drop `#fragment`, trailing `/`); drop any already in the
   known-URL set; drop blocked domains.
2. Score each survivor with the rubric → `high | medium | low`:
   - +2 peer-reviewed / primary / official
   - +1 recent (≤3 yr) where recency matters
   - +1 known/credentialed author or authoritative org
   - +1 corroborated by another perspective's find (max +1)
   - −1 vendor-primary / promotional / single-blogger opinion
   Tiers: **high** ≥4, **medium** 2–3, **low** 0–1, **reject** <0 (don't clip).
3. Keep the top sources (favor `high`/`medium`; a few `low` are fine if on-topic).

## Phase 3 — clip the survivors (the only writes)
For each kept candidate:
`node ${CLAUDE_PLUGIN_ROOT}/scripts/clip.mjs "<url>" --quality=<tier>`
It blocks unreliable domains, skips dupes, extracts via Defuddle, and writes
`raw/clippings/<slug>.md` with `source`, `created`, `tags:[clippings]`, `quality`,
`source-hash`. A `thin content` result means the page was a SPA/paywall — report it
for manual clipping, don't retry blindly.

## Guardrails
- Agents never write the vault; `clip.mjs` is the sole writer to `raw/`.
- Never edit anything already under `raw/` — clippings are immutable sources.
- Prefer primary/authoritative sources over open-publishing platforms.
- The user confirms before anything is ingested (the command handles the gate).
````

- [ ] **Step 2: Verify frontmatter**

Run: `node --input-type=module -e "import {readFileSync} from 'node:fs'; const s=readFileSync('skills/wiki-discoverer/SKILL.md','utf8'); if(!(s.startsWith('---')&&s.includes('name: wiki-discoverer')&&s.includes('description:'))) throw new Error('bad'); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add skills/wiki-discoverer/SKILL.md
git commit -m "feat(discover): wiki-discoverer discipline skill"
```

### Task 3.2: `commands/wiki-discover.md`

**Files:**
- Create: `commands/wiki-discover.md`

- [ ] **Step 1: Write the command**

```markdown
---
description: Autonomously discover web sources on a topic — parallel perspective subagents find + credibility-rank sources, clip the best into raw/clippings/, then confirm before ingesting.
argument-hint: <topic>
---

Load the `wiki-discoverer` skill and run its flow for the topic: $ARGUMENTS

1. **Phase 0 — dedup check.** Gather existing clipping `source:` URLs
   (`obsidian search query="tag:clippings" format=json`) and a coverage summary
   from `index.md`.
2. **Phase 1 — fan out.** Launch the 5 perspective subagents IN PARALLEL (one
   message, multiple Agent calls), each read-only, each returning a ranked
   candidate list. Give each the topic, the known-URL set, and the coverage summary.
3. **Phase 2 — select.** Independently dedup + credibility-score the pooled
   candidates (high/medium/low), drop rejects and dupes, keep the top sources.
4. **Phase 3 — clip.** For each survivor:
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/clip.mjs "<url>" --quality=<tier>`
5. **Confirm gate.** Show the user the ranked list (title, url, quality, why) and
   which clips succeeded / were skipped (blocked, duplicate, thin). Ask whether to
   ingest.
6. **On confirm:** run `/wiki-ingest` (which processes the new clippings), then
   append one line to `log.md`:
   `## [YYYY-MM-DD] discover | <topic> → N clipped, M ingested`.
   **On decline:** leave the clippings in `raw/clippings/` for manual review.
```

- [ ] **Step 2: Verify frontmatter**

Run: `node --input-type=module -e "import {readFileSync} from 'node:fs'; const s=readFileSync('commands/wiki-discover.md','utf8'); if(!(s.startsWith('---')&&s.includes('description:'))) throw new Error('bad'); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add commands/wiki-discover.md
git commit -m "feat(discover): /wiki-discover orchestrator command"
```

---

## Phase 4 — Integration edits

### Task 4.1: Defuddle availability check in `/wiki-init`

**Files:**
- Modify: `scripts/init.mjs`

- [ ] **Step 1: Add a check function and call it in `main()`**

In `scripts/init.mjs`, add this import near the top (after the existing imports):
```javascript
import { execFileSync } from 'node:child_process';
```

Add this function above `export function main()`:
```javascript
function defuddleAvailable() {
  for (const [cmd, args] of [['defuddle', ['--version']], ['npx', ['--yes', 'defuddle', '--version']]]) {
    try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { /* try next */ }
  }
  return false;
}
```

In `main()`, as the **last statement** (after the existing step-3 `console.log(... Web Clipper ...)` line), add:
```javascript
  if (!defuddleAvailable()) {
    console.log(`\n  Note: /wiki-discover needs the Defuddle CLI. Install: npm i -g defuddle`);
  }
```

- [ ] **Step 2: Verify init still scaffolds (existing test unaffected)**

Run: `node --test test/init.test.mjs`
Expected: PASS (2 tests). (`scaffold` is unchanged; only `main`'s console output changed.)

- [ ] **Step 3: Commit**

```bash
git add scripts/init.mjs
git commit -m "feat(discover): /wiki-init flags missing Defuddle CLI"
```

### Task 4.2: Document the `quality` field in the maintainer skill

**Files:**
- Modify: `skills/wiki-maintainer/SKILL.md`

- [ ] **Step 1: Add a line to the Vault contract section**

In `skills/wiki-maintainer/SKILL.md`, find the line:
```markdown
- Links are `[[wikilinks]]`. `![[embeds]]` are transclusion only — not relationship edges.
```
Add immediately after it:
```markdown
- Clippings from `/wiki-discover` carry `quality: high|medium|low` (AI credibility
  rating). Treat `low` sources with extra skepticism when ingesting; `/wiki-lint`
  may flag claims that rest only on `low`-quality provenance.
```

- [ ] **Step 2: Verify frontmatter still valid**

Run: `node --input-type=module -e "import {readFileSync} from 'node:fs'; const s=readFileSync('skills/wiki-maintainer/SKILL.md','utf8'); if(!(s.startsWith('---')&&s.includes('name: wiki-maintainer'))) throw new Error('bad'); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add skills/wiki-maintainer/SKILL.md
git commit -m "docs(discover): document quality field for ingest/lint"
```

---

## Phase 5 — Live smoke + finish

### Task 5.1: Full unit suite

- [ ] **Step 1: Run everything**

Run: `node --test`
Expected: PASS — blocklist, clip, plus all pre-existing suites (health, stale, embed, drift, vault, init). Note the total; no failures.

### Task 5.2: Live clip smoke (needs network + Defuddle)

- [ ] **Step 1: Ensure Defuddle is reachable**

Run: `defuddle --version || npx --yes defuddle --version`
Expected: a version prints. If not: `npm i -g defuddle`.

- [ ] **Step 2: Clip one real, article-shaped URL into the live vault**

Run (pick a stable article, e.g. a Wikipedia page or a docs page — NOT a blocked domain):
```bash
node scripts/clip.mjs "https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)" --quality=high
```
Expected: `clipped: raw/clippings/<slug>.md (quality=high)`. Open the file and confirm: frontmatter has `title`, `source`, `created`, `tags: [clippings]`, `quality: high`, `source-hash`, and the body is clean article markdown. If Defuddle's JSON field names differ from `contentMarkdown`/`title`/`author`/`published`, fix `main()`'s mapping now and re-run.

- [ ] **Step 3: Verify blocklist + dedup live**

Run: `node scripts/clip.mjs "https://reddit.com/r/whatever"`
Expected: `blocked (unreliable domain): ...`.
Run the Step-2 command again.
Expected: `duplicate (already clipped): ...` (or `exists (slug clash)`).

- [ ] **Step 4: Record results; commit any CLI-mapping fixes**

```bash
git add -A
git commit -m "fix(discover): align clip main with live Defuddle JSON output"
```
(If no fixes were needed, note that and skip.)

### Task 5.3: Live discover dry-run (optional, exercises subagents)

- [ ] **Step 1:** In Claude Code with the plugin loaded, run `/wiki-discover "a narrow topic you know well"`. Confirm: 5 parallel subagents fan out, a ranked list is presented, clips land in `raw/clippings/` with `quality`, blocked/duplicate/thin are reported, and the confirm gate appears before ingest. Decline at the gate to inspect the clippings, or confirm to exercise `/wiki-ingest`.

---

## Definition of done
- `node --test` green (blocklist + clip suites added, nothing regressed).
- Live clip smoke: a real URL clipped with the full frontmatter contract; blocklist + dedup confirmed; any Defuddle JSON-mapping fixed.
- `/wiki-discover` + `wiki-discoverer` skill present with valid frontmatter; `/wiki-init` flags missing Defuddle; `quality` documented in the maintainer skill.
- Guardrails intact: discovery subagents never write the vault; `clip.mjs` is the sole `raw/` writer; clippings immutable; user confirms before ingest.
```
