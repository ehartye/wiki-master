// The authoring contract for wiki/authored/ pages, stated once.
//
// Pure and I/O-free. scripts/validate-authored.mjs applies it to the pages one
// task wrote; test/validate-authored.test.mjs pins every list below against the
// places the vocabulary is also written for people (templates/vault-schema.md,
// the authored templates and skills/wiki-maintainer/references/authoring.md),
// so none of them can be edited in one place only.

import { BACKLOG_STATUS_ORDER, KIND_ORDER, projectKey } from './authored-group.mjs';

export const AUTHORED_ROOT = 'wiki/authored/';

// Kinds the project catalogs group by, plus the backlog item, which has its own folder.
export const KINDS = Object.freeze([...KIND_ORDER, 'backlog-item']);

export const DECISION_STATUSES = Object.freeze(['proposed', 'accepted', 'superseded', 'deprecated']);

// Imported, never copied: the generated roadmap and this contract read one list.
export const BACKLOG_STATUSES = BACKLOG_STATUS_ORDER;

// The canonical placement table (authoring reference): the folder under a
// project that holds each kind of page, and the files that sit directly in it.
export const FOLDER_KINDS = Object.freeze({
  guides: 'guide', diagrams: 'diagram', reference: 'reference',
  decisions: 'decision', notes: 'note', backlog: 'backlog-item',
});
export const FILE_KINDS = Object.freeze({
  'overview.md': 'overview', 'architecture.md': 'architecture', 'roadmap.md': 'roadmap',
});

// Every authored page carries these. `reviewed` is deliberately absent: a missing
// review means unverified, which is a state, not a defect. `status` is required
// but its value is free, because older pages use words beyond stub/draft/maintained.
export const REQUIRED_KEYS = Object.freeze(['type', 'created', 'updated', 'status', 'sources', 'ai-generated']);
// A page in a project folder also names its project and kind.
export const PROJECT_KEYS = Object.freeze(['project', 'kind']);
// Kinds that carry a status of their own, and the key that holds it.
export const KIND_STATUS_KEY = Object.freeze({ decision: 'decision-status', 'backlog-item': 'backlog-status' });

// Where an authored page sits. `project` is the folder path above the page's kind
// folder; `strict` says that folder is known to be the project (a kind folder
// ends it), otherwise the folder may also hold free sub-folders. `expectedKind` is
// what the location implies, or null when it implies nothing. null for any path
// outside wiki/authored/.
export function placement(path) {
  if (!path.startsWith(AUTHORED_ROOT)) return null;
  const parts = path.slice(AUTHORED_ROOT.length).split('/');
  const file = parts.pop();
  // A kind folder only counts below a project folder: wiki/authored/notes/x.md is
  // a project named "notes".
  const at = parts.findIndex((part, i) => i > 0 && Object.hasOwn(FOLDER_KINDS, part));
  if (at > 0) return { project: parts.slice(0, at).join('/'), strict: true, expectedKind: FOLDER_KINDS[parts[at]], folder: parts[at] };
  const project = parts.join('/');
  return { project, strict: false, expectedKind: project && Object.hasOwn(FILE_KINDS, file) ? FILE_KINDS[file] : null, folder: null };
}

// null when `declared` agrees with the folder, otherwise the reason. A page
// directly under wiki/authored/ has no project folder and no expectation.
export function projectProblem(declared, place) {
  if (!place?.project) return null;
  const key = projectKey(declared);
  const chain = place.project.toLowerCase().split('/');
  if (place.strict) {
    if (chain.length > 2) return `folder "${place.project}" nests deeper than a project and one sub-project`;
    return key === chain.join('/') ? null : `project ${JSON.stringify(declared)} does not match its folder "${place.project}"`;
  }
  // No kind folder to mark where the project ends: the project is the top folder,
  // or the top folder plus one sub-project level.
  const accepted = [chain[0], chain.slice(0, 2).join('/')];
  return accepted.includes(key) ? null : `project ${JSON.stringify(declared)} does not match its folder "${place.project}"`;
}
