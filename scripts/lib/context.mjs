import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontmatterDamage, withoutComment } from './note.mjs';
import { discoverRepository } from './repository.mjs';
import { ContextError } from './context-error.mjs';
export { ContextError } from './context-error.mjs';
import { findProject, validateProject } from './session-brief.mjs';
import { assertVaultPath } from './vault-path.mjs';

const ID = /^[a-z][a-z0-9-]*$/;
const PLUGIN_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const fail = message => { throw new ContextError(message); };
const home = env => env.HOME || env.USERPROFILE || homedir();
export function canonicalPath(path) {
  const absolute = resolve(path);
  try { return realpathSync.native(absolute); }
  catch {
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(canonicalPath(parent), basename(absolute));
  }
}
const pathKey = path => process.platform === 'win32' ? path.toLowerCase() : path;
export const sameRoot = (a, b) => pathKey(canonicalPath(a)) === pathKey(canonicalPath(b));
function contains(root, path) {
  const rel = relative(pathKey(resolve(root)), pathKey(resolve(path)));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel));
}
export function assertTestVault(path, env) {
  if (env.NODE_TEST_CONTEXT && !contains(canonicalPath(tmpdir()), canonicalPath(path)) && !contains(canonicalPath(PLUGIN_ROOT), canonicalPath(path))) {
    throw new ContextError(`the vault ${path} is outside the temporary directory and the plugin folder, and a test run may only use a temporary or fixture vault; set WIKI_MASTER_VAULT to a directory under ${tmpdir()}`);
  }
}
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${label}: unknown key ${key}`);
}
function id(value, label) { if (typeof value !== 'string' || !ID.test(value)) fail(`${label} must match [a-z][a-z0-9-]*`); }
function text(value, label) { if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a nonblank string`); }
function json(path, label) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { fail(`Cannot read ${label} JSON at ${path}: ${error.message}`); }
}
function descriptorString(raw, label) {
  const value = withoutComment(raw).trim();
  if (value.startsWith('"')) {
    try { const decoded = JSON.parse(value); if (typeof decoded === 'string' && decoded.trim()) return decoded; } catch { /* refuse below */ }
    fail(`${label} must be a valid quoted string`);
  }
  if (value.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(value)) fail(`${label} must be a valid quoted string`);
    const decoded = value.slice(1, -1).replaceAll("''", "'"); text(decoded, label); return decoded;
  }
  if (!value || /^[\[\]{}&*!|>]/.test(value) || /^(?:null|true|false|~|[-+]?\d+(?:\.\d*)?(?:e[-+]?\d+)?)$/i.test(value)) fail(`${label} must be a string`);
  return value;
}
function descriptorList(raw, label) {
  const value = withoutComment(raw).trim();
  if (!value.startsWith('[') || !value.endsWith(']')) fail(`${label} must be a string list`);
  const inner = value.slice(1, -1);
  if (!inner.trim()) return [];
  const items = []; let start = 0, quote = null;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (quote) {
      if (quote === '"' && char === '\\') { i++; continue; }
      if (char === quote) {
        if (quote === "'" && inner[i + 1] === "'") { i++; continue; }
        quote = null;
      }
    } else if ((char === '"' || char === "'") && !inner.slice(start, i).trim()) quote = char;
    else if (char === ',') { items.push(descriptorString(inner.slice(start, i), label)); start = i + 1; }
  }
  if (quote) fail(`${label} has an unclosed quote`);
  items.push(descriptorString(inner.slice(start), label));
  return items;
}
export function readVaultDescriptor(path, expectedId) {
  assertVaultPath(dirname(resolve(path)), resolve(path));
  let source;
  try { source = readFileSync(path, 'utf8'); } catch (error) { fail(`Cannot read VAULT.md descriptor at ${path}: ${error.message}`); }
  if (frontmatterDamage(source) || !/^\uFEFF?---\r?\n/.test(source)) fail(`Invalid VAULT.md frontmatter at ${path}`);
  const lines = source.replace(/^\uFEFF/, '').split(/^---\s*$/m)[1].split(/\r?\n/), metadata = {};
  for (let i = 0; i < lines.length; i++) {
    if (!withoutComment(lines[i]).trim()) continue;
    const field = lines[i].match(/^([\w-]+):[ \t]*(.*)$/);
    if (!field) fail(`Invalid flat VAULT.md field at ${path}`);
    const [, key, raw] = field;
    if (Object.hasOwn(metadata, key)) fail(`Duplicate VAULT.md field ${key} at ${path}`);
    const value = withoutComment(raw).trim(), label = `${path} ${key}`;
    if (key === 'schema-version') metadata[key] = value;
    else if (key === 'includes' || key === 'excludes') {
      if (value) metadata[key] = descriptorList(value, label);
      else {
        const items = [];
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) items.push(descriptorString(lines[++i].replace(/^\s*-\s+/, ''), label));
        if (!items.length) fail(`${label} must be a string list; use [] for an empty list`);
        metadata[key] = items;
      }
    } else metadata[key] = descriptorString(raw, label);
  }
  object(metadata, ['schema-version', 'vault-id', 'purpose', 'includes', 'excludes'], path);
  if (metadata['schema-version'] !== '1') fail(`Unsupported VAULT.md schema-version at ${path}`);
  id(metadata['vault-id'], `${path} vault-id`);
  if (metadata['vault-id'] !== expectedId) fail(`VAULT.md vault-id mismatch at ${path}; expected ${expectedId}`);
  text(metadata.purpose, `${path} purpose`);
  for (const key of ['includes', 'excludes']) {
    if (!Array.isArray(metadata[key]) || (key === 'includes' && !metadata[key].length) || metadata[key].some(v => typeof v !== 'string' || !v.trim())) fail(`${path} ${key} must be ${key === 'includes' ? 'a nonempty' : 'a'} string list`);
  }
  return metadata;
}
export function readRegistry(configPath, env = process.env) {
  const data = json(configPath, 'registry');
  object(data, ['version', 'defaultVault', 'vaults'], 'registry');
  if (data.version !== 1) fail('Unsupported registry version; expected 1');
  id(data.defaultVault, 'defaultVault');
  if (!Array.isArray(data.vaults) || !data.vaults.length) fail('registry vaults must be a nonempty list');
  const ids = new Set(), selectors = new Set(), roots = [];
  // Validate all logical entries and overlaps before descriptors, even when a root is offline.
  for (const entry of data.vaults) {
    object(entry, ['id', 'path', 'obsidian'], 'vault entry'); id(entry.id, 'vault id');
    text(entry.path, `vault ${entry.id} path`); text(entry.obsidian, `vault ${entry.id} obsidian selector`);
    if (!isAbsolute(entry.path)) fail(`vault ${entry.id} path must be absolute`);
    if (ids.has(entry.id)) fail(`Duplicate vault ID ${entry.id}`);
    if (selectors.has(entry.obsidian)) fail(`Duplicate Obsidian selector ${entry.obsidian}`);
    ids.add(entry.id); selectors.add(entry.obsidian);
    const path = canonicalPath(entry.path);
    for (const previous of roots) {
      if (contains(previous.path, path) || contains(path, previous.path) || contains(previous.given, entry.path) || contains(entry.path, previous.given)) fail(`Registered roots overlap or are nested: ${previous.id} and ${entry.id}`);
    }
    roots.push({ id: entry.id, path, given: entry.path, selector: entry.obsidian });
  }
  if (!ids.has(data.defaultVault)) fail(`defaultVault names unknown vault ${data.defaultVault}`);
  const targets = roots.map(({ given, ...target }) => {
    assertTestVault(target.path, env);
    let available = false;
    try { available = statSync(target.path).isDirectory(); } catch { /* offline roots remain discoverable */ }
    const descriptorPath = join(target.path, 'VAULT.md');
    if (available) readVaultDescriptor(descriptorPath, target.id);
    return { ...target, descriptorPath, available };
  });
  return { defaultVault: data.defaultVault, targets };
}
export function readProjectConfig(path) {
  const data = json(path, 'project configuration');
  object(data, ['version', 'project', 'documentationVault', 'researchVaults'], 'project configuration');
  if (data.version !== 1) fail('Unsupported project configuration version; expected 1');
  if ('project' in data) {
    try { validateProject(data.project); } catch (error) { fail(error.message); }
    if (data.project.split('/').length > 2) fail('project supports at most one subproject level');
  }
  if ('documentationVault' in data) id(data.documentationVault, 'documentationVault');
  if ('researchVaults' in data) {
    if (!Array.isArray(data.researchVaults) || !data.researchVaults.length) fail('researchVaults must be a nonempty list');
    data.researchVaults.forEach(value => id(value, 'researchVaults ID'));
    if (new Set(data.researchVaults).size !== data.researchVaults.length) fail('researchVaults contains duplicate IDs');
  }
  return data;
}

// Read-only discovery: unreachable targets are reported here; mutation calls requireSelectedTarget.
export function resolveContext(env = process.env, { purpose = 'documentation', repo, cwd = process.cwd(), select, discoverLegacyProject = true } = {}) {
  if (!['documentation', 'research', 'maintenance'].includes(purpose)) fail(`Unknown purpose ${purpose}`);
  const repoArg = repo ?? env.WIKI_MASTER_PROJECT_ROOT;
  const repository = discoverRepository(resolve(cwd, repoArg ?? '.'), { explicit: repoArg !== undefined });
  const diagnostics = [...repository.diagnostics];
  const configPath = env.WIKI_MASTER_CONFIG || join(home(env), '.config', 'wiki-master', 'vaults.json');
  if (env.WIKI_MASTER_CONFIG && !isAbsolute(env.WIKI_MASTER_CONFIG)) fail('WIKI_MASTER_CONFIG must be an absolute registry filename');
  const hasRegistry = existsSync(configPath);
  if (!hasRegistry && env.WIKI_MASTER_CONFIG) fail(`Explicit registry configuration does not exist: ${configPath}`);
  const projectConfig = repository.configPath ? readProjectConfig(repository.configPath) : {};
  if (!hasRegistry && ('documentationVault' in projectConfig || 'researchVaults' in projectConfig)) fail('Project vault overrides require a registry; run wiki-setup');
  let targets, defaultId;
  if (hasRegistry) {
    const registry = readRegistry(configPath, env); targets = registry.targets; defaultId = registry.defaultVault;
  } else {
    if (!env.WIKI_MASTER_VAULT && env.WIKI_MASTER_REQUIRE_VAULT && env.WIKI_MASTER_REQUIRE_VAULT !== '0') fail('WIKI_MASTER_REQUIRE_VAULT is set and WIKI_MASTER_VAULT is not, so no vault is chosen; set WIKI_MASTER_VAULT to the vault to act on');
    const given = env.WIKI_MASTER_VAULT || join(home(env), '.wiki-master-vault'), path = canonicalPath(given);
    assertTestVault(path, env);
    let available = false; try { available = statSync(path).isDirectory(); } catch { /* discovery can describe a missing legacy root */ }
    targets = [{ id: 'legacy', path, selector: env.WIKI_MASTER_VAULT_NAME || basename(given), descriptorPath: join(path, 'VAULT.md'), available }]; defaultId = 'legacy';
    if (!existsSync(targets[0].descriptorPath)) diagnostics.push('Legacy vault has not been described by setup; VAULT.md is absent.');
  }
  const target = value => { const found = targets.find(v => v.id === value); if (!found) fail(`Unknown configured vault ID ${value}`); return found; };
  const documentation = { ...target(projectConfig.documentationVault ?? defaultId) };
  const research = (projectConfig.researchVaults ?? [defaultId]).map(target);
  let project = projectConfig.project ?? null;
  if (repository.root && documentation.available && (hasRegistry || repository.configPath || discoverLegacyProject)) {
    const { matches } = findProject(documentation.path, repository);
    if (matches.length > 1) fail('More than one project overview matches this repository; correct the ambiguous repo bindings');
    if (project && matches.length && matches[0].project !== project) fail(`Configured project ${project} conflicts with repository match ${matches[0].project}`);
    project ??= matches[0]?.project ?? null;
  }
  documentation.projectPath = project ? canonicalPath(join(documentation.path, 'wiki', 'authored', project)) : null;
  if (documentation.projectPath && !contains(documentation.path, documentation.projectPath)) fail('Documentation project folder escapes the selected vault');
  if (select !== undefined && env.WIKI_MASTER_VAULT_ID && select !== env.WIKI_MASTER_VAULT_ID) fail('Conflicting explicit vault selections (--select and WIKI_MASTER_VAULT_ID)');
  const selection = select ?? env.WIKI_MASTER_VAULT_ID;
  if (selection !== undefined) id(selection, 'selected vault ID');
  let selected = null;
  if (purpose === 'documentation') {
    if (selection && selection !== documentation.id) fail('Selection cannot redirect the configured documentation destination');
    selected = documentation;
  } else if (purpose === 'research') {
    if (selection && !research.some(v => v.id === selection)) fail(`Selected vault ${selection} is not in this project's research list`);
    selected = selection ? target(selection) : research.length === 1 ? research[0] : null;
  } else selected = selection ? target(selection) : documentation;
  if (hasRegistry && (env.WIKI_MASTER_VAULT || env.WIKI_MASTER_VAULT_NAME)) {
    if (!selected) fail('Select a research vault ID before supplying a vault root or selector');
    if (env.WIKI_MASTER_VAULT && !sameRoot(env.WIKI_MASTER_VAULT, selected.path)) fail(`WIKI_MASTER_VAULT root conflicts with selected vault ${selected.id}`);
    if (env.WIKI_MASTER_VAULT_NAME && env.WIKI_MASTER_VAULT_NAME !== selected.selector) fail(`WIKI_MASTER_VAULT_NAME selector conflicts with selected vault ${selected.id}`);
  }
  const context = { version: 1, purpose, configPath: hasRegistry ? canonicalPath(configPath) : null, projectConfigPath: repository.configPath, inheritedProjectConfig: repository.inherited, project, documentation, research, selected, selectionRequired: purpose === 'research' && !selected, diagnostics };
  // Runtime binding metadata is not part of the public discovery JSON.
  Object.defineProperties(context, { repositoryRoot: { value: repository.root }, legacyPath: { value: hasRegistry ? null : env.WIKI_MASTER_VAULT || join(home(env), '.wiki-master-vault') } });
  return context;
}

export function requireSelectedTarget(context, { available = true } = {}) {
  if (!context.selected) fail('Select a research vault at the beginning of this request (--select or WIKI_MASTER_VAULT_ID)');
  if (available && !context.selected.available) throw new ContextError(`Selected vault ${context.selected.id} is unavailable: ${context.selected.path}`, 1);
  return context.selected;
}

// Pass this snapshot to children. The next invocation validates it against configuration again.
export function contextEnv(context, env = process.env) {
  const selected = requireSelectedTarget(context, { available: false });
  return { ...env, WIKI_MASTER_VAULT: selected.path, WIKI_MASTER_VAULT_NAME: selected.selector,
    ...(context.repositoryRoot ? { WIKI_MASTER_PROJECT_ROOT: context.repositoryRoot } : {}),
    ...(context.configPath ? { WIKI_MASTER_CONFIG: context.configPath, WIKI_MASTER_VAULT_ID: selected.id } : {}) };
}
