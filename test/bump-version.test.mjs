import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MANIFEST_FILES, VERSION_FIELDS, valueAt, changelogHeading, changelogProblem, compareVersions, applyBump } from '../scripts/lib/version-fields.mjs';

// A release changes the version in nine fields of seven manifests and in one changelog heading. The bump was a hand
// edit that skipped a file twice; bump-version.mjs does it in one step from the same list the drift test reads.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'bump-version.mjs');
const EM = String.fromCharCode(0x2014);

// The real manifests and changelog, copied: the script is proved on the files it will really change.
function fixture(t, { eol = '\n' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-bump-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of [...MANIFEST_FILES, 'CHANGELOG.md']) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    const text = readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
    writeFileSync(join(dir, file), eol === '\n' ? text : text.replace(/\n/g, eol));
  }
  const current = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
  const [a, b] = current.split('.').map(Number);
  return { dir, current, next: `${a}.${b + 1}.0`, read: (f) => readFileSync(join(dir, f), 'utf8') };
}

const run = (dir, args) => spawnSync(process.execPath, [SCRIPT, ...args, '--root', dir], { encoding: 'utf8', timeout: 60000 });
const snapshot = (f) => Object.fromEntries([...MANIFEST_FILES, 'CHANGELOG.md'].map((file) => [file, f.read(file)]));
const fieldsOf = (f) => VERSION_FIELDS.map((r) => valueAt(JSON.parse(f.read(r.file)), r.path));

test('a dry run says what it would change and writes nothing', (t) => {
  const f = fixture(t);
  const before = snapshot(f);
  const r = run(f.dir, [f.next, '--date', '2026-11-01']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`would bump ${f.current.replace(/\./g, '\\.')} -> ${f.next.replace(/\./g, '\\.')}`));
  assert.match(r.stdout, /dry run/);
  assert.deepEqual(snapshot(f), before);
});

test('--apply changes all nine fields and the changelog heading, and nothing else', (t) => {
  const f = fixture(t);
  const before = snapshot(f);
  const r = run(f.dir, [f.next, '--apply', '--date', '2026-11-01']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fieldsOf(f), VERSION_FIELDS.map(() => f.next));
  // Each manifest is the old text with only the version string replaced.
  for (const file of MANIFEST_FILES) {
    const n = VERSION_FIELDS.filter((x) => x.file === file).length;
    assert.equal(f.read(file), before[file].split(`"version": "${f.current}"`).join(`"version": "${f.next}"`), file);
    assert.equal(before[file].split(`"version": "${f.current}"`).length - 1, n, `${file} held ${n} field(s)`);
  }
  const log = f.read('CHANGELOG.md');
  assert.ok(log.startsWith(`# Changelog\n\n${changelogHeading(f.next, '2026-11-01')}\n\n`));
  assert.equal(log.slice(log.indexOf(`## ${f.current}`)), before['CHANGELOG.md'].slice(before['CHANGELOG.md'].indexOf(`## ${f.current}`)), 'the older entries are untouched');
  assert.match(r.stdout, /Write the changelog entry/);
});

test('--changelog-entry puts the entry body under the heading', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.dir, 'entry.md'), '- First change.\n- Second change.\n');
  const r = run(f.dir, [f.next, '--apply', '--date', '2026-11-01', '--changelog-entry', join(f.dir, 'entry.md')]);
  assert.equal(r.status, 0, r.stderr);
  const log = f.read('CHANGELOG.md');
  assert.ok(log.startsWith(`# Changelog\n\n## ${f.next} ${EM} 2026-11-01\n\n- First change.\n- Second change.\n\n## ${f.current}`));
  assert.equal(changelogProblem(log, f.next), null);
  assert.doesNotMatch(r.stdout, /Write the changelog entry/);
});

test('CRLF files stay CRLF, in the manifests and in the changelog', (t) => {
  const f = fixture(t, { eol: '\r\n' });
  const r = run(f.dir, [f.next, '--apply', '--date', '2026-11-01']);
  assert.equal(r.status, 0, r.stderr);
  for (const file of [...MANIFEST_FILES, 'CHANGELOG.md']) {
    const text = f.read(file);
    assert.equal(text.split('\r\n').length - 1, text.split('\n').length - 1, `${file} has a bare LF`);
  }
  assert.deepEqual(fieldsOf(f), VERSION_FIELDS.map(() => f.next));
  assert.ok(f.read('CHANGELOG.md').startsWith(`# Changelog\r\n\r\n## ${f.next} ${EM} 2026-11-01\r\n\r\n`));
});

test('it refuses, and writes nothing, when the fields already disagree', (t) => {
  const f = fixture(t);
  const file = '.codex-plugin/plugin.json';
  writeFileSync(join(f.dir, file), f.read(file).replace(`"version": "${f.current}"`, '"version": "0.0.1"'));
  const before = snapshot(f);
  const r = run(f.dir, [f.next, '--apply']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /disagree/);
  assert.match(r.stderr, /\.codex-plugin\/plugin\.json/);
  assert.deepEqual(snapshot(f), before);
});

test('it refuses a version that is not greater, malformed, or missing', (t) => {
  const f = fixture(t);
  const before = snapshot(f);
  for (const bad of [f.current, '0.0.1', '1.2', 'v1.2.3', '1.2.3-beta']) {
    const r = run(f.dir, [bad, '--apply']);
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /not greater|look like x\.y\.z/);
  }
  const none = spawnSync(process.execPath, [SCRIPT, '--apply', '--root', f.dir], { encoding: 'utf8' });
  assert.equal(none.status, 1);
  assert.deepEqual(snapshot(f), before);
});

test('it refuses, and writes nothing, when a dependency in the lockfile shares the old version', (t) => {
  const f = fixture(t);
  const lock = JSON.parse(f.read('package-lock.json'));
  lock.packages['node_modules/some-dependency'] = { version: f.current };
  writeFileSync(join(f.dir, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  const before = snapshot(f);
  const r = run(f.dir, [f.next, '--apply']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /package-lock\.json/);
  assert.match(r.stderr, /shares the version/);
  assert.deepEqual(snapshot(f), before);
});

test('a heading that is already there is not duplicated, and an unknown option is refused', (t) => {
  const f = fixture(t);
  const log = f.read('CHANGELOG.md');
  writeFileSync(join(f.dir, 'CHANGELOG.md'), log.replace('# Changelog\n\n', `# Changelog\n\n## ${f.next} ${EM} 2026-10-30\n\n- Written first.\n\n`));
  const r = run(f.dir, [f.next, '--apply']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.read('CHANGELOG.md').split(`## ${f.next} `).length - 1, 1);
  assert.match(r.stdout, /already there/);
  assert.equal(changelogProblem(f.read('CHANGELOG.md'), f.next), null);
  const bad = run(f.dir, ['0.99.0', '--frobnicate']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown option/);
});

test('changelogProblem names a heading that is behind, a missing entry, and a missing heading', () => {
  const entry = (v, body) => `## ${v} ${EM} 2026-10-26\n\n${body}\n\n`;
  const good = `# Changelog\n\n${entry('1.2.0', '- Did a thing.')}${entry('1.1.0', '- Older.')}`;
  assert.equal(changelogProblem(good, '1.2.0'), null);
  assert.match(changelogProblem(good, '1.3.0'), /newest CHANGELOG\.md heading is 1\.2\.0 but the version is 1\.3\.0/);
  assert.match(changelogProblem(`# Changelog\n\n${entry('1.2.0', '')}${entry('1.1.0', '- Older.')}`, '1.2.0'), /no bullet/, 'an older entry\'s bullet is not this entry\'s');
  assert.match(changelogProblem('# Changelog\n\nNo releases yet.\n', '1.2.0'), /no release heading/);
});

test('versions compare as numbers, not as text', () => {
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('0.9.0', '0.10.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
});

test('a write that fails puts the files already written back', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-bump-rollback-'));
  t.after(() => { chmodSync(join(dir, 'b.json'), 0o644); rmSync(dir, { recursive: true, force: true }); });
  writeFileSync(join(dir, 'a.json'), 'old a\n');
  writeFileSync(join(dir, 'b.json'), 'old b\n');
  chmodSync(join(dir, 'b.json'), 0o444); // read-only: the second write is refused
  assert.throws(() => applyBump(dir, { writes: [{ file: 'a.json', text: 'new a\n' }, { file: 'b.json', text: 'new b\n' }], changelog: { changed: false } }), /a write failed and the files were put back/);
  assert.equal(readFileSync(join(dir, 'a.json'), 'utf8'), 'old a\n', 'the file written first is restored');
  assert.equal(readFileSync(join(dir, 'b.json'), 'utf8'), 'old b\n');
});
