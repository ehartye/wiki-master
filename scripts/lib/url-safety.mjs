// An address that carries a username or password must never be written to the vault: the triage log, declined.json
// and a clipping's source: line are all synced, and every message would repeat it.

// True when the text parses as an address with a username, a password or both (`u:p@host`, `u@host`, `:p@host`),
// whatever the case of its scheme. Anything that is not an address (a file path, an empty value) carries none.
export function urlCarriesCredentials(address) {
  try { const u = new URL(String(address ?? '')); return Boolean(u.username || u.password); } catch { return false; }
}

// The refusal every clipper prints, without the address. `hint` says what to do instead.
export function credentialRefusal(hint = '') {
  return `refused: the address carries a username or password; remove it${hint ? ` (${hint})` : ''}`;
}
