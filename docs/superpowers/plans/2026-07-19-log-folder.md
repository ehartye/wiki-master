# log/ Folder + log.base Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use h-superpowers:subagent-driven-development, h-superpowers:team-driven-development, or h-superpowers:executing-plans to implement this plan (ask user which approach). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single shared append-only `log.md` with one file per log entry under `log/`, written by a shared `scripts/log-entry.mjs` and viewed via `log.base`, so a log merge conflict is structurally impossible across machines.

**Architecture:** A new `scripts/log-entry.mjs` owns entry naming + frontmatter (mirrors how `index-gen.mjs` centralizes catalog logic). The five logging skills call it instead of `obsidian append path=log.md`. `init.mjs` scaffolds `log/` + `log.base` instead of an append-target `log.md`. The existing vault's `log.md` is frozen verbatim as a dated archive note inside `log/`; a tiny immutable `log.md` stub preserves existing `[[log]]` links.

**Tech Stack:** Node ESM (`type: module`), Node's built-in test runner (`node --test`), Obsidian Bases (`.base` YAML), the `obsidian` CLI (unchanged for other ops).

**Spec:** `docs/superpowers/specs/2026-07-19-log-folder-design.md`

**Reference skills:** @h-superpowers:test-driven-development, @h-superpowers:verification-before-completion

---

## File Structure

- **Create** `scripts/log-entry.mjs` — writes one uniquely-named log entry file. Owns naming, slugify, frontmatter, collision-avoidance. Exports `slugify`, `stamp`, `writeLogEntry` (pure, clock-injectable) + a `main()` CLI.
- **Create** `test/log-entry.test.mjs` — unit tests for the above.
- **Create** `templates/log.base` — Bases view over the `log/` folder.
- **Create** `test/init.test.mjs` — asserts `scaffold()` creates `log/`, `log.base`, and a stub `log.md`.
- **Modify** `scripts/init.mjs` — add `log` dir, copy `log.base`, write the `log.md` stub instead of `# Log\n\n`.
- **Modify** `skills/wiki-ingest/SKILL.md`, `skills/wiki-discover/SKILL.md`, `skills/wiki-lint/SKILL.md`, `skills/wiki-relink/SKILL.md`, `skills/wiki-query/SKILL.md` — call `log-entry.mjs`.
- **Modify** `skills/wiki-maintainer/SKILL.md` — rewrite the "The log" contract + two references.
- **Modify** `templates/vault-schema.md` — update the one-line log description.
- **Vault migration** (operates on `~/.wiki-master-vault`, not plugin code) — freeze `log.md` as archive, add stub + `log.base`.

---

## Task 1: `scripts/log-entry.mjs` (the entry writer)

**Files:**
- Create: `scripts/log-entry.mjs`
- Test: `test/log-entry.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/log-entry.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slugify, stamp, writeLogEntry } from '../scripts/log-entry.mjs';

test('slugify lowercases, replaces punctuation, drops edge dashes', () => {
  assert.equal(slugify('State DOT: Estimating Practices!'), 'state-dot-estimating-practices');
  assert.equal(slugify(''), 'entry');
});

test('stamp formats day and zero-padded time (local clock)', () => {
  const d = new Date(2026, 6, 19, 9, 3, 5); // month is 0-based: 6 => July
  assert.deepEqual(stamp(d), { day: '2026-07-19', time: '090305' });
});

test('writeLogEntry writes a uniquely-named file with frontmatter + heading', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-log-'));
  const now = new Date(2026, 6, 19, 22, 43, 1);
  const rel = writeLogEntry({ vaultPath: vault, op: 'ingest', title: 'Hello: World', body: 'the body', now });
  assert.equal(rel, join('log', '2026-07-19-224301-ingest-hello-world.md'));
  const txt = readFileSync(join(vault, rel), 'utf8');
  assert.match(txt, /^---\ndate: 2026-07-19\nop: ingest\ntitle: "Hello: World"\n---\n/);
  assert.match(txt, /## \[2026-07-19\] ingest \| Hello: World\n\nthe body\n$/);
});

test('writeLogEntry never overwrites: a collision gets a numeric suffix', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-log-'));
  const now = new Date(2026, 6, 19, 22, 43, 1);
  const a = writeLogEntry({ vaultPath: vault, op: 'ingest', title: 'Dup', body: 'A', now });
  const b = writeLogEntry({ vaultPath: vault, op: 'ingest', title: 'Dup', body: 'B', now });
  assert.notEqual(a, b);
  assert.equal(b, join('log', '2026-07-19-224301-ingest-dup-2.md'));
  assert.ok(readFileSync(join(vault, a), 'utf8').includes('A'));
  assert.ok(readFileSync(join(vault, b), 'utf8').includes('B'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scripts/log-entry.mjs'`.

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/log-entry.mjs`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all four `log-entry` tests green; no other test regresses.

- [ ] **Step 5: Commit**

```bash
git add scripts/log-entry.mjs test/log-entry.test.mjs
git commit -m "feat: add scripts/log-entry.mjs — one file per log entry"
```

---

## Task 2: `templates/log.base` + `init.mjs` scaffolding

**Files:**
- Create: `templates/log.base`
- Test: `test/init.test.mjs`
- Modify: `scripts/init.mjs`

- [ ] **Step 1: Create the Base template**

Create `templates/log.base`:

```yaml
filters:
  and:
    - file.inFolder("log")
views:
  - type: table
    name: log
    order:
      - date
      - op
      - title
      - file.path
    sort:
      - property: date
        direction: DESC
```

- [ ] **Step 2: Write the failing test**

Create `test/init.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffold } from '../scripts/init.mjs';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

test('scaffold creates log/ + log.base and a non-append log.md stub', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-init-'));
  scaffold(vault, TEMPLATES);
  assert.ok(existsSync(join(vault, 'log')), 'log/ folder created');
  assert.ok(existsSync(join(vault, 'log.base')), 'log.base created');
  const stub = readFileSync(join(vault, 'log.md'), 'utf8');
  assert.match(stub, /log\.base/, 'log.md is a pointer stub, not an append target');
  assert.ok(existsSync(join(vault, 'index.md')), 'index.md still scaffolded');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `log/` / `log.base` not created, and the stub assertion fails (current `log.md` is `# Log\n\n`).

- [ ] **Step 4: Modify `scripts/init.mjs`**

Change the `DIRS` constant to include `log`:

```js
const DIRS = ['raw/clippings', 'wiki/sources', 'wiki/entities', 'wiki/concepts',
              'wiki/syntheses', 'moc', 'log', '_templates', '.wiki-master'];
```

Replace the `log.md` line inside `scaffold()`:

```js
  writeIfAbsent(join(vaultPath, 'log.md'), '# Log\n\n');
```

with the pointer stub:

```js
  writeIfAbsent(join(vaultPath, 'log.md'),
    '# Log\n\nEntries now live one file per operation in the log/ folder. Open **log.base** to browse them.\n');
```

Add a `log.base` copy immediately after the existing `stale.base` copy block:

```js
  if (!existsSync(join(vaultPath, 'log.base')))
    copyFileSync(join(templatesDir, 'log.base'), join(vaultPath, 'log.base'));
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — `init` test green; `log-entry` tests still green; no regressions.

- [ ] **Step 6: Commit**

```bash
git add templates/log.base scripts/init.mjs test/init.test.mjs
git commit -m "feat: init scaffolds log/ + log.base, log.md becomes a pointer stub"
```

---

## Task 3: Point the skills + schema at `log-entry.mjs`

Prose-only edits (no tests). Each is an exact find/replace. Preserve surrounding text and indentation exactly.

**Files:** the five skill SKILL.md files, `skills/wiki-maintainer/SKILL.md`, `templates/vault-schema.md`.

- [ ] **Step 1: `skills/wiki-ingest/SKILL.md`**

Find:

```
(never hand-edit index.md's generated fence). Append
   `## [YYYY-MM-DD] ingest | <title>` to `log.md` via `obsidian append` only.
```

Replace with:

```
(never hand-edit index.md's generated fence). Write the log entry by piping the
   narrative to `node ../../scripts/log-entry.mjs --op ingest --title "<title>"`
   (creates `log/<timestamp>-ingest-<slug>.md`; resolved relative to this skill dir).
```

- [ ] **Step 2: `skills/wiki-discover/SKILL.md`**

Find:

```
  append one line to `log.md` via `obsidian append` only:
  `## [YYYY-MM-DD] discover | <topic> → N clipped, M ingested`.
```

Replace with:

```
  write the log entry by piping a one-line summary to
  `node ../../scripts/log-entry.mjs --op discover --title "<topic> → N clipped, M ingested"`.
```

- [ ] **Step 3: `skills/wiki-lint/SKILL.md`**

Find:

```
for the user to approve. Stamp `reviewed` on pages you touch. Append a
   `## [YYYY-MM-DD] lint | ...` line to `log.md`.
```

Replace with:

```
for the user to approve. Stamp `reviewed` on pages you touch. Write the log entry:
   `node ../../scripts/log-entry.mjs --op lint --title "<summary>"` (details on stdin).
```

- [ ] **Step 4: `skills/wiki-relink/SKILL.md`**

Find:

```
4. Build or refresh MOC hubs in `moc/` for dense clusters. Append a
   `## [YYYY-MM-DD] relink | ...` line to `log.md`.
```

Replace with:

```
4. Build or refresh MOC hubs in `moc/` for dense clusters. Write the log entry:
   `node ../../scripts/log-entry.mjs --op relink --title "<summary>"` (details on stdin).
```

- [ ] **Step 5: `skills/wiki-query/SKILL.md`**

Find:

```
   `wiki/syntheses/<slug>.md` page (with provenance), then regenerate the catalog
   (`node ../../scripts/index-gen.mjs`) and append to `log.md`
   via `obsidian append` only.
```

Replace with:

```
   `wiki/syntheses/<slug>.md` page (with provenance), then regenerate the catalog
   (`node ../../scripts/index-gen.mjs`) and write the log entry:
   `node ../../scripts/log-entry.mjs --op query --title "<question>"` (answer summary on stdin).
```

- [ ] **Step 6: `skills/wiki-maintainer/SKILL.md` — the vault-contract line**

Find:

```
  pages you own. `moc/`: navigational hubs. `index.md`: catalog. `log.md`: append-only history.
```

Replace with:

```
  pages you own. `moc/`: navigational hubs. `index.md`: catalog. `log/`: one file per operation (view via `log.base`).
```

- [ ] **Step 7: `skills/wiki-maintainer/SKILL.md` — the "The log" section**

Find:

```
## The log
Every operation appends one line to `log.md`:
`## [YYYY-MM-DD] <op> | <title>` — grep-parseable. Ops: ingest, query, lint, relink.
**Append ONLY via `obsidian append path=log.md` (from PowerShell)** — never by
filesystem write. All app-side writers are serialized by Obsidian's operation
queue; a filesystem read-modify-write racing a concurrent session silently
erases its entries. log.md is unreconstructable history — it is the one file
that cannot be regenerated after a lost update.
```

Replace with:

```
## The log
Every operation writes ONE new file under `log/`, via the shared script:
`node ../../scripts/log-entry.mjs --op <op> --title "<title>"` with the entry
narrative piped on stdin. It creates `log/YYYY-MM-DD-HHmmss-<op>-<slug>.md` with
`date`/`op`/`title` frontmatter and a `## [YYYY-MM-DD] <op> | <title>` heading
(still grep-parseable — grep the `log/` folder). Ops: ingest, discover, query,
lint, relink. Never write a shared aggregate file: one entry = one uniquely-named
file, so two machines can never collide (this replaces the old append-only `log.md`,
whose cross-machine lost-update race is now structurally impossible). Browse the
log via `log.base`.
```

- [ ] **Step 8: `skills/wiki-maintainer/SKILL.md` — the Ingest-workflow reference**

Find:

```
  catalog (`node ../../scripts/index-gen.mjs`, resolved relative to this skill's own
  directory) → append to `log.md` via `obsidian append`.
```

Replace with:

```
  catalog (`node ../../scripts/index-gen.mjs`, resolved relative to this skill's own
  directory) → write the log entry via `node ../../scripts/log-entry.mjs`.
```

- [ ] **Step 9: `templates/vault-schema.md`**

Find:

```
- `moc/` — Maps of Content. `index.md` — catalog. `log.md` — append-only history.
```

Replace with:

```
- `moc/` — Maps of Content. `index.md` — catalog. `log/` — one file per operation, viewed via `log.base`.
```

- [ ] **Step 10: Verify no stale references remain**

Run: `grep -rniE "append.*log\.md|log\.md.*obsidian append" skills templates`
Expected: no matches (an empty result).

- [ ] **Step 11: Commit**

```bash
git add skills templates/vault-schema.md
git commit -m "docs: point all logging skills + schema at log-entry.mjs / log.base"
```

---

## Task 4: Full test run + finish the plugin branch

**Files:** none (verification).

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: PASS — all suites green (existing tests + `log-entry` + `init`).

- [ ] **Step 2: Smoke-test the CLI against a throwaway vault**

Run:

```bash
WIKI_MASTER_VAULT="$(mktemp -d)" bash -c 'echo "smoke body" | node scripts/log-entry.mjs --op ingest --title "Smoke: Test"; ls "$WIKI_MASTER_VAULT/log"'
```

Expected: prints `log/2026-...-ingest-smoke-test.md` and `ls` shows that one file.

- [ ] **Step 3: Verify (evidence before "done")** — @h-superpowers:verification-before-completion

Confirm: suite green (Step 1 output), CLI produced a correctly-named file (Step 2 output), and Task 3 Step 10 grep was empty. Only then treat the plugin change as complete.

- [ ] **Step 4: Push + open PR**

```bash
git push -u origin feat/log-folder
gh pr create --fill --title "log/ folder + log.base: eliminate multi-machine log conflicts"
```

---

## Task 5: Vault migration (one-time — operates on the live vault, NOT plugin code)

> **Sequencing:** Run this AFTER the plugin change is published and `/plugin update` has run on every machine. An un-updated machine would still `obsidian append` and recreate a shared `log.md`. A stray recreated `log.md` is harmless (fold it into the archive later), but updating first keeps it clean. Vault path below is `~/.wiki-master-vault` (adjust if `WIKI_MASTER_VAULT` differs).

**Files (in the vault):** `log.md` → `log/2026-07-19-000000-archive.md`, new stub `log.md`, `log.base`, `vault-schema.md`.

- [ ] **Step 1: Snapshot the current log for verification**

```bash
V="$HOME/.wiki-master-vault"; cd "$V"
sha256sum log.md | tee /tmp/log-before.sha
grep -c '^## \[' log.md   # note the entry count
```

- [ ] **Step 2: Move log.md into the archive slot (preserving git history)**

```bash
mkdir -p log
git mv log.md log/2026-07-19-000000-archive.md
```

- [ ] **Step 3: Prepend archive frontmatter (body stays verbatim)**

```bash
A="log/2026-07-19-000000-archive.md"
{ printf -- '---\ndate: 2026-07-19\nop: archive\ntitle: "Log archive (through 2026-07-19)"\n---\n'; cat "$A"; } > "$A.tmp" && mv "$A.tmp" "$A"
```

- [ ] **Step 4: Verify the archive body is byte-identical to the old log.md**

```bash
# strip the 5 prepended frontmatter lines, compare hash to the snapshot
tail -n +6 "log/2026-07-19-000000-archive.md" | sha256sum
cat /tmp/log-before.sha
```

Expected: the two hashes match (the archive body == original `log.md`).

- [ ] **Step 5: Recreate the immutable stub log.md**

```bash
printf '# Log\n\nEntries now live one file per operation in the log/ folder. Open **log.base** to browse them.\n' > log.md
```

- [ ] **Step 6: Add log.base and update the schema line**

Copy `log.base` from the installed/updated plugin's `templates/log.base` into the vault root (or author it identically to Task 2 Step 1). Then in the vault's `vault-schema.md`, apply the same one-line edit as Task 3 Step 9.

- [ ] **Step 7: Verify in Obsidian**

Open the vault; confirm `log.base` lists the archive entry (dated 2026-07-19) and that new ops create files under `log/`. If entries are not newest-first, adjust `log.base`'s `sort` (`property:`/`direction:`) to match your Bases version, then re-verify.

- [ ] **Step 8: Commit the vault migration**

```bash
git add -A
git commit -m "chore(vault): migrate log.md to log/ folder + log.base (frozen archive)"
```

(obsidian-git will push on its next cycle, or push manually.)

---

## Self-Review notes (addressed)

- **Spec coverage:** log-entry.mjs (§Arch 1) → Task 1; log.base (§2) → Task 2; init (§3) → Task 2; skill/maintainer prose (§4) → Task 3; migration freeze (§5) → Task 5; testing (§Testing) → Tasks 1,2,4. All covered.
- **Signature consistency:** `writeLogEntry`, `slugify`, `stamp` are defined in Task 1 and referenced only there; skills invoke the CLI (`--op`/`--title` + stdin) exactly as `main()` parses it.
- **Naming:** archive file `log/2026-07-19-000000-archive.md` matches the `date` frontmatter (freeze boundary) — no name/date contradiction.
