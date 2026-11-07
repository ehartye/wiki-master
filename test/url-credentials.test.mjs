import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { urlCarriesCredentials } from '../scripts/lib/url-safety.mjs';

// An address with a username or password must never reach the triage log, declined.json, a message or a clipping's
// source: line. Every clipper refuses it with exit 2 before it computes anything else, in whichever argument it arrives.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const OK = 'https://example.test/ok.pdf';

// Each form carries its own secret, so a leak names the form that leaked.
const FORMS = [
  ['user and password', 'https://u:secretpw1@example.test/z.pdf', 'secretpw1'],
  ['user only', 'https://tok3n2@example.test/z.pdf', 'tok3n2'],
  ['password only', 'https://:secretpw3@example.test/z.pdf', 'secretpw3'],
  ['mixed-case scheme', 'HtTpS://u:secretpw4@example.test/z.pdf', 'secretpw4'],
];

test('urlCarriesCredentials sees a username, a password or both, and nothing else', () => {
  for (const [, url] of FORMS) assert.equal(urlCarriesCredentials(url), true, url);
  for (const url of ['https://example.test/a@b', 'https://example.test/?u=a@b', 'HTTP://example.test:8080/x', '/tmp/a.pdf', 'C:\a\b.docx', '', undefined])
    assert.equal(urlCarriesCredentials(url), false, String(url));
});

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-url-credentials-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const run = (root, script, args) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, WIKI_MASTER_VAULT: root } });

function assertRefused(root, r, secret, label) {
  assert.equal(r.status, 2, `${label}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /refused: the address carries a username or password; remove it/, label);
  assert.ok(!(r.stdout + r.stderr).includes(secret), `${label}: the credential was repeated in a message`);
  for (const name of ['triage.jsonl', 'declined.json']) {
    const file = join(root, '.wiki-master', name);
    assert.ok(!existsSync(file) || readFileSync(file, 'utf8').trim() === '', `${label}: ${name} was written`);
  }
  assert.deepEqual(readdirSync(join(root, 'raw', 'clippings')), [], `${label}: a clipping was written`);
}

for (const [form, url, secret] of FORMS) {
  test(`clip-pdf.mjs refuses a ${form} in --source, with or without --decline`, (t) => {
    const root = vault(t);
    assertRefused(root, run(root, 'clip-pdf.mjs', [OK, `--source=${url}`]), secret, '--source');
    assertRefused(root, run(root, 'clip-pdf.mjs', [OK, '--decline=no', `--source=${url}`]), secret, '--decline --source');
  });

  test(`clip.mjs refuses a ${form} as its address, with or without --decline or --from-file`, (t) => {
    const root = vault(t);
    const page = join(root, 'saved.html');
    writeFileSync(page, '<html><body><p>saved</p></body></html>');
    const address = url.replace('example.test', '127.0.0.1:9');
    assertRefused(root, run(root, 'clip.mjs', [address]), secret, 'address');
    assertRefused(root, run(root, 'clip.mjs', [address, '--decline=no']), secret, '--decline');
    assertRefused(root, run(root, 'clip.mjs', [address, '--from-file', page]), secret, '--from-file');
  });
}

test('clip.mjs suggests --from-file, since a credentialed page cannot be fetched', (t) => {
  const root = vault(t);
  const r = run(root, 'clip.mjs', ['http://u:secretpw5@127.0.0.1:9/x']);
  assert.match(r.stderr, /--from-file/);
});

for (const script of ['clip-docx.mjs', 'clip-pptx.mjs', 'clip-xlsx.mjs']) {
  test(`${script} refuses a credentialed --source, with or without --decline`, (t) => {
    const root = vault(t);
    const file = join(root, 'doc' + script.slice(4, -4).replace(/^/, '.'));
    writeFileSync(file, 'not really a document');
    const [, url, secret] = FORMS[0];
    assertRefused(root, run(root, script, [file, `--source=${url}`]), secret, '--source');
    assertRefused(root, run(root, script, [file, '--decline=no', `--source=${url}`]), secret, '--decline --source');
  });
}
