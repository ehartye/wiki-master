const HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.WIKI_MASTER_EMBED_MODEL || 'nomic-embed-text';

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function embed(text, { fetchImpl = fetch, model = MODEL } = {}) {
  const res = await fetchImpl(`${HOST}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt: text }),
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
