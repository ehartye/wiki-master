import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A receipt that records its own byte length and SHA-256 must reach the repository with exactly those
// bytes. Git's text conversion (`* text=auto eol=lf` in a vault, or any user's core.autocrlf) rewrites line
// endings on `git add`, so a captured CRLF receipt can be stored with different bytes and no longer
// reproduce its recorded hash. These helpers check the STAGED blob against a declared size and hash, and
// name the exact attribute line that keeps the bytes. They never change an attribute themselves: a
// broad attribute change could disturb unrelated content, so the fix stays in the owner's hands.

const HEX = /^[0-9a-f]{64}$/;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// null when the map is usable with this ledger, else a sentence saying why not.
export function checkEvidenceMap(map, ledger) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return 'the evidence map must be a JSON object of path to { bytes, sha256 }';
  const paths = Object.keys(map);
  if (!paths.length) return 'the evidence map is empty';
  const owned = new Set(ledger ?? []);
  for (const path of paths) {
    if (!owned.has(path)) return `${path} is in the evidence map but not in the operation's ledger; the map covers only paths this operation owns`;
    const { bytes, sha256: hash } = map[path] ?? {};
    if (!Number.isInteger(bytes) || bytes < 0) return `${path}: bytes must be a non-negative integer`;
    if (typeof hash !== 'string' || !HEX.test(hash)) return `${path}: sha256 must be 64 lower-case hex characters`;
  }
  return null;
}

// The exact `.gitattributes` line that makes git store this one file unconverted. Glob characters are
// escaped and a name with whitespace is quoted, so the rule cannot match another file.
export function gitattributesLine(path) {
  const pattern = path.replace(/([\\*?[\]])/g, '\\$1').replace(/^([#!])/, '\\$1');
  return /[\s"]/.test(pattern) ? `"${pattern.replace(/"/g, '\\"')}" -text` : `${pattern} -text`;
}

const gitArgs = (args) => ['-c', 'core.quotePath=false', '--literal-pathspecs', ...args];

function stagedBlob(cwd, path) {
  try {
    return execFileSync('git', gitArgs(['cat-file', 'blob', `:${path}`]), { cwd, maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function effectiveAttributes(cwd, path) {
  try {
    const out = execFileSync('git', gitArgs(['check-attr', 'text', 'eol', '--', path]), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split(/\r?\n/).filter(Boolean).map((line) => line.replace(/^.*?: (\w+): /, '$1=')).join(', ');
  } catch {
    return 'unknown';
  }
}

// Compares each declared file's staged blob with its declaration. `verified` lists the paths whose bytes
// are exactly as declared; `problems` explains each one that is not.
export function verifyStagedEvidence(cwd, map) {
  const verified = [];
  const problems = [];
  for (const [path, declared] of Object.entries(map)) {
    const blob = stagedBlob(cwd, path);
    if (!blob) { problems.push({ path, line: `${path}: not in the index, so there is nothing to commit for it` }); continue; }
    const staged = { bytes: blob.length, sha256: sha256(blob) };
    if (staged.bytes === declared.bytes && staged.sha256 === declared.sha256) { verified.push(path); continue; }
    let disk = null;
    try { disk = readFileSync(join(cwd, path)); } catch { /* the line below says so */ }
    const diskMatches = disk && disk.length === declared.bytes && sha256(disk) === declared.sha256;
    const head = `${path}: declared ${declared.bytes} bytes sha256 ${declared.sha256}, git would store ${staged.bytes} bytes sha256 ${staged.sha256} (effective attributes: ${effectiveAttributes(cwd, path)})`;
    if (diskMatches) {
      problems.push({ path, line: `${head}\n  The file on disk is the declared bytes and git converted it on add. Add this exact line to .gitattributes (and list .gitattributes in the ledger), then rerun: ${gitattributesLine(path)}` });
    } else {
      problems.push({ path, line: `${head}\n  The file on disk does not match the declaration either (${disk ? `${disk.length} bytes sha256 ${sha256(disk)}` : 'missing'}); correct the declaration or restore the file.` });
    }
  }
  if (!problems.length) return { ok: true, verified };
  const reason = `refused: ${problems.length} evidence file(s) would be committed with different bytes than declared. Nothing was committed and the token is kept.\n${problems.map((p) => `  ${p.line}`).join('\n')}`;
  return { ok: false, verified, problems, reason };
}
