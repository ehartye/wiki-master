import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addressSecret, urlCarriesSecret, SECRET_QUERY_NAMES } from '../scripts/lib/url-safety.mjs';
import { redactAddress } from '../scripts/lib/clip-ledger.mjs';

// An address with a username, a password or a secret query parameter must never reach the triage log, declined.json, a
// message, a ledger row or a clipping's source: line. Every clipper refuses it with exit 2 before it computes anything else,
// in whichever argument it arrives (decision 21, criterion 25).

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const OK = 'https://example.test/ok.pdf';

// Each form carries its own secret, so a leak names the form that leaked. The last column is what the refusal says was found.
const USER = 'username or password';
const FORMS = [
  ['user and password', 'https://u:secretpw1@example.test/z.pdf', 'secretpw1', USER],
  ['user only', 'https://tok3n2@example.test/z.pdf', 'tok3n2', USER],
  ['password only', 'https://:secretpw3@example.test/z.pdf', 'secretpw3', USER],
  ['mixed-case scheme', 'HtTpS://u:secretpw4@example.test/z.pdf', 'secretpw4', USER],
  ['?token=', 'https://example.test/z.pdf?page=2&token=secretpw5', 'secretpw5', 'secret in its query (token)'],
  ['?password=', 'https://example.test/z.pdf?password=secretpw6&lang=en', 'secretpw6', 'secret in its query (password)'],
  ['a mixed-case name', 'https://example.test/z.pdf?X-Amz-Signature=secretpw7', 'secretpw7', 'secret in its query (x-amz-signature)'],
  ['a percent-encoded name', 'https://example.test/z.pdf?%61pi_%4Bey=secretpw8', 'secretpw8', 'secret in its query (api_key)'],
];
// The two forms the document clippers are tried with.
const DOC_FORMS = [FORMS[0], FORMS[4]];

test('addressSecret names the kind, and for a query parameter its name, whole names only', () => {
  for (const [, url, , kind] of FORMS) assert.equal(addressSecret(url)?.text, kind, url);
  assert.equal(addressSecret('https://u:p@example.test/?token=x')?.text, USER, 'a credential is named before a query');
  for (const name of SECRET_QUERY_NAMES) {
    assert.equal(addressSecret(`https://example.test/?${name.toUpperCase()}=v`)?.text, `secret in its query (${name})`, name);
    assert.equal(addressSecret(`https://example.test/?${name}x=v&x${name}=v`), null, `${name} inside a longer name`);
  }
  assert.equal(SECRET_QUERY_NAMES.length, 18);
  for (const url of ['https://example.test/?page=2&lang=en', 'https://example.test/?tokenizer=x&author=y&keyword=z', 'https://example.test/token/password?x=1#token=a',
    'https://example.test/a@b', 'https://example.test/?u=a@b', 'HTTP://example.test:8080/x', '/tmp/a.pdf', 'C:\\a\\b.docx', '', undefined])
    assert.equal(addressSecret(url), null, String(url));
  for (const [, url] of FORMS) assert.equal(urlCarriesSecret(url), true, url);
  assert.equal(urlCarriesSecret('https://example.test/?page=2'), false);
});

test('the ledger keeps an address without its username or password and with each secret value replaced', () => {
  assert.equal(redactAddress('https://u:secretpw1@example.test/z?page=2&Token=secretpw2&a%20b=c%20d&%70assword=secretpw3'), 'https://example.test/z?page=2&Token=redacted&a%20b=c%20d&%70assword=redacted');
  assert.equal(redactAddress('https://example.test/z?tokenizer=x&sig'), 'https://example.test/z?tokenizer=x&sig=redacted');
  assert.equal(redactAddress('not an address'), null);
});

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-url-credentials-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const run = (root, script, args) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, WIKI_MASTER_VAULT: root } });
const stateOf = (root, name) => { const file = join(root, '.wiki-master', name); return existsSync(file) ? readFileSync(file, 'utf8').trim() : ''; };

function assertRefused(root, r, secret, label, kind = USER) {
  assert.equal(r.status, 2, `${label}: ${r.stdout}${r.stderr}`);
  assert.ok(r.stderr.includes(`refused: the address carries a ${kind}; remove it`), `${label}: ${r.stderr}`);
  assert.ok(!(r.stdout + r.stderr).includes(secret), `${label}: the secret was repeated in a message`);
  for (const name of ['triage.jsonl', 'declined.json']) assert.equal(stateOf(root, name), '', `${label}: ${name} was written`);
  assert.deepEqual(readdirSync(join(root, 'raw', 'clippings')), [], `${label}: a clipping was written`);
}

for (const [form, url, secret, kind] of FORMS) {
  test(`clip-pdf.mjs refuses ${form} in --source, with or without --decline`, (t) => {
    const root = vault(t);
    assertRefused(root, run(root, 'clip-pdf.mjs', [OK, `--source=${url}`]), secret, '--source', kind);
    assertRefused(root, run(root, 'clip-pdf.mjs', [OK, '--decline=no', `--source=${url}`]), secret, '--decline --source', kind);
    assertRefused(root, run(root, 'clip-pdf.mjs', [url]), secret, 'address', kind);
  });

  for (const script of ['clip-gh.mjs', 'clip-confluence.mjs']) {
    test(`${script} refuses ${form} as its address, with or without --decline, before it writes, queues or declines anything`, (t) => {
      const root = vault(t);
      assertRefused(root, run(root, script, [url]), secret, 'address', kind);
      assertRefused(root, run(root, script, [url, '--decline=no']), secret, '--decline', kind);
      assertRefused(root, run(root, script, [url, '--topic=Docs', '--quality=high']), secret, 'options', kind);
    });
  }

  test(`clip.mjs refuses ${form} as its address, with or without --decline or --from-file`, (t) => {
    const root = vault(t);
    const page = join(root, 'saved.html');
    writeFileSync(page, '<html><body><p>saved</p></body></html>');
    const address = url.replace('example.test', '127.0.0.1:9');
    assertRefused(root, run(root, 'clip.mjs', [address]), secret, 'address', kind);
    assertRefused(root, run(root, 'clip.mjs', [address, '--decline=no']), secret, '--decline', kind);
    assertRefused(root, run(root, 'clip.mjs', [address, '--from-file', page]), secret, '--from-file', kind);
  });
}

test('clip.mjs suggests --from-file, since a credentialed page cannot be fetched', (t) => {
  const root = vault(t);
  assert.match(run(root, 'clip.mjs', ['http://u:secretpw5@127.0.0.1:9/x']).stderr, /--from-file/);
  assert.match(run(root, 'clip.mjs', ['http://127.0.0.1:9/x?token=secretpw5']).stderr, /--from-file/);
});

for (const script of ['clip-docx.mjs', 'clip-pptx.mjs', 'clip-xlsx.mjs']) {
  test(`${script} refuses a secret in --source, with or without --decline`, (t) => {
    const root = vault(t);
    const file = join(root, 'doc' + script.slice(4, -4).replace(/^/, '.'));
    writeFileSync(file, 'not really a document');
    for (const [, url, secret, kind] of DOC_FORMS) {
      assertRefused(root, run(root, script, [file, `--source=${url}`]), secret, '--source', kind);
      assertRefused(root, run(root, script, [file, '--decline=no', `--source=${url}`]), secret, '--decline --source', kind);
    }
  });
}

// ---------------------------------------------------------------- the ledger and --list

test('clip.mjs --list turns a line with a secret into an error outcome, the run goes on, and nothing repeats the secret', (t) => {
  const root = vault(t);
  const list = join(root, 'urls.txt');
  const ledger = join(root, 'ledger.jsonl');
  writeFileSync(list, ['https://u:secretpw1@example.test/a?page=2', 'https://example.test/b?lang=en&Access_Token=secretpw2', 'ftp://example.test/c', 'https://example.test/d?%70wd=secretpw3'].join('\n'));
  const r = run(root, 'clip.mjs', ['--list', list, '--ledger', ledger]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /list: 4 URLs: error 4/);
  assert.match(r.stderr, /line 2: refused: the address carries a secret in its query \(access_token\)/);
  const rows = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((row) => [row.status, row.url]), [
    ['error', 'https://example.test/a?page=2'],
    ['error', 'https://example.test/b?lang=en&Access_Token=redacted'],
    ['error', 'ftp://example.test/c'],
    ['error', 'https://example.test/d?%70wd=redacted'],
  ]);
  const everything = [r.stdout, r.stderr, readFileSync(ledger, 'utf8'), stateOf(root, 'triage.jsonl'), stateOf(root, 'declined.json')].join('\n');
  for (const secret of ['secretpw1', 'secretpw2', 'secretpw3']) assert.ok(!everything.includes(secret), secret);
  assert.deepEqual(readdirSync(join(root, 'raw', 'clippings')), []);
});

test('a refused address with a ledger leaves a row whose address has no secret value', (t) => {
  const root = vault(t);
  const ledger = join(root, 'ledger.jsonl');
  const r = run(root, 'clip.mjs', ['https://example.test/p?x=1&token=secretpw1', '--ledger', ledger, '--topic=Docs']);
  assert.equal(r.status, 2);
  const [row, ...more] = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(more.length, 0);
  assert.equal(row.url, 'https://example.test/p?x=1&token=redacted');
  assert.equal(row.status, 'error');
  assert.match(row.reason, /secret in its query \(token\)/);
  assert.ok(!(r.stdout + r.stderr + readFileSync(ledger, 'utf8')).includes('secretpw1'));
});

// ---------------------------------------------------------------- what is not a secret

test('an unlisted or look-alike parameter clips normally from a supplied page', (t) => {
  const root = vault(t);
  const page = join(root, 'saved.html');
  writeFileSync(page, `<html><head><title>Saved</title></head><body><article><h1>Saved</h1><p>${'Plain words about the saved page and what it explains. '.repeat(40)}</p></article></body></html>`);
  const url = 'https://example.test/page?page=2&lang=en&tokenizer=x&author=y&keyword=z';
  const r = run(root, 'clip.mjs', [url, '--from-file', page]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const files = readdirSync(join(root, 'raw', 'clippings'));
  assert.equal(files.length, 1);
  assert.match(readFileSync(join(root, 'raw', 'clippings', files[0]), 'utf8'), /^source: .*tokenizer=x/m);
});
