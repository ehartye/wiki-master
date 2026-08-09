const HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.WIKI_MASTER_EMBED_MODEL || 'nomic-embed-text';

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// keepAlive defaults to 30m (Ollama's own default is 5m): profiled on the
// live vault, an embed call took 2,142 ms with the model unloaded and 30 ms
// warm -- the dominant cost in a semantic query is Ollama evicting the model
// between calls, not the embedding itself. Passing keep_alive on every
// request keeps it resident across the gap between queries/index runs.
export async function embed(text, { fetchImpl = fetch, model = MODEL, keepAlive = '30m' } = {}) {
  const res = await fetchImpl(`${HOST}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt: text, keep_alive: keepAlive }),
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

export const EMBED_MODEL = MODEL;
export const OLLAMA_HOST = HOST;

// A reachable server is NOT a usable one. isAvailable() only proves Ollama
// answers; if the configured model was never pulled, search() still reports the
// `hybrid` tier, then every embed call 404s, semanticSearch skips each page in
// turn, and the caller receives keyword-only results wearing a hybrid label.
// That is the one place this pipeline actively misreports itself, so the model
// is checked separately rather than inferred from the server being up.
export async function modelPresent({ fetchImpl = fetch, model = MODEL } = {}) {
  try {
    const res = await fetchImpl(`${HOST}/api/tags`);
    if (!res || !res.ok) return false;
    const data = await res.json();
    // Ollama reports a model pulled as "nomic-embed-text" under the name
    // "nomic-embed-text:latest", so compare on the bare name. A caller that
    // pins an explicit tag still matches, because both sides are stripped.
    const bare = (s) => String(s).split(':')[0];
    return (data.models ?? []).some((m) => bare(m.name ?? m.model ?? '') === bare(model));
  } catch {
    return false;
  }
}
