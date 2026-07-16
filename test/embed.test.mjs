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
