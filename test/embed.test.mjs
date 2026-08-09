import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embed, isAvailable, cosine, modelPresent } from '../scripts/lib/embed.mjs';

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

// A reachable server is not a usable one: isAvailable() only proves Ollama
// answers. Without the model, search() still reports `hybrid` while semantic
// silently contributes nothing — the one place the pipeline misreports itself.
test('modelPresent is false when the server answers but the model was never pulled', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ models: [{ name: 'llama3:8b' }] }) });
  assert.equal(await modelPresent({ fetchImpl, model: 'nomic-embed-text' }), false);
});

// Ollama reports a model pulled as "nomic-embed-text" under "nomic-embed-text:latest".
test('modelPresent matches on the bare name, ignoring the tag on either side', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ models: [{ name: 'nomic-embed-text:latest' }] }) });
  assert.equal(await modelPresent({ fetchImpl, model: 'nomic-embed-text' }), true);
  assert.equal(await modelPresent({ fetchImpl, model: 'nomic-embed-text:v1.5' }), true);
});

test('modelPresent falls back to the model field when name is absent', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ models: [{ model: 'nomic-embed-text:latest' }] }) });
  assert.equal(await modelPresent({ fetchImpl, model: 'nomic-embed-text' }), true);
});

test('modelPresent is false when Ollama is unreachable or answers badly', async () => {
  assert.equal(await modelPresent({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }), false);
  assert.equal(await modelPresent({ fetchImpl: async () => ({ ok: false }) }), false);
  assert.equal(await modelPresent({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), false);
});
