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
