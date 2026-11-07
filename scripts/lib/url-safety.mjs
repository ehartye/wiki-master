// An address that carries a secret must never be written to the vault: the triage log, declined.json and a clipping's
// source: line are all synced, and every message would repeat it. A secret is a username or password in the address, or a
// query parameter whose name is on the list below. Refusal, not redaction: the owner chose it (spec decision 21).

// The query parameter names that hold a secret, lower case. Compared whole, after percent-decoding, whatever the case: `token`
// is on the list, `tokenizer` is not. The list is short on purpose and grows only on evidence.
export const SECRET_QUERY_NAMES = [
  'password', 'passwd', 'pwd', 'secret', 'client_secret', 'token', 'access_token', 'id_token', 'refresh_token',
  'api_key', 'apikey', 'auth', 'authorization', 'sig', 'signature', 'x-amz-signature', 'x-amz-security-token', 'x-amz-credential',
];
const SECRET_NAMES = new Set(SECRET_QUERY_NAMES);

// A query name as written (`%61pi_key`, `Token`) turned into the name it stands for. A malformed escape is left as it is.
function decodedName(raw) {
  const spaced = raw.replace(/\+/g, ' ');
  try { return decodeURIComponent(spaced); } catch { return spaced; }
}

// The name of a query piece (`a=b`, `a`) as written.
const rawNameOf = (piece) => piece.split('=', 1)[0];

// Is this piece of a query (`name=value`) a secret? Returns the lower-cased decoded name, or null.
export function secretQueryName(piece) {
  const name = decodedName(rawNameOf(piece)).toLowerCase();
  return SECRET_NAMES.has(name) ? name : null;
}

// What kind of secret the text carries, or null. `text` is the phrase the refusal uses: it names the kind and, for a query
// parameter, its name, and never a value. Anything that is not an address (a file path, an empty value) carries none.
// A username or password is named before a query parameter, whatever the case of the scheme.
// { kind: 'credentials', text } | { kind: 'query', name, text } | null
export function addressSecret(address) {
  let u;
  try { u = new URL(String(address ?? '')); } catch { return null; }
  if (u.username || u.password) return { kind: 'credentials', text: 'username or password' };
  for (const piece of u.search.slice(1).split('&')) {
    const name = piece ? secretQueryName(piece) : null;
    if (name) return { kind: 'query', name, text: `secret in its query (${name})` };
  }
  return null;
}

// True when the address carries a secret of either kind.
export const urlCarriesSecret = (address) => addressSecret(address) !== null;

// The address as a record may hold it: without a username or password, and with the value of each secret query parameter
// replaced by `redacted`. The rest of the query keeps its spelling. Null when the text is not an address.
export function redactSecrets(address) {
  let u;
  try { u = new URL(String(address ?? '')); } catch { return null; }
  u.username = '';
  u.password = '';
  if (u.search) u.search = '?' + u.search.slice(1).split('&').map((piece) => (piece && secretQueryName(piece) ? `${rawNameOf(piece)}=redacted` : piece)).join('&');
  return u.href;
}

// The refusal every clipper prints, without the address or any value. `hint` says what to do instead.
// With no address the secret is taken to be a username or password.
export function secretRefusal(address, hint = '') {
  const found = addressSecret(address);
  return `refused: the address carries a ${found?.text ?? 'username or password'}; remove it${hint ? ` (${hint})` : ''}`;
}

// The two older names, until each caller has moved to the ones above.
export function urlCarriesCredentials(address) {
  try { const u = new URL(String(address ?? '')); return Boolean(u.username || u.password); } catch { return false; }
}
export function credentialRefusal(hint = '') {
  return `refused: the address carries a username or password; remove it${hint ? ` (${hint})` : ''}`;
}
