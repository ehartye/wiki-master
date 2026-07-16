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
