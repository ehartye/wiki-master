import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAuthoredProject, classifyAuthoredKind, classifyDecisionStatus, insertAuthoredMetadata,
} from '../scripts/lib/authored-classify.mjs';

// Backfill classification for the 34 pre-existing wiki/authored/ files (spec
// docs/superpowers/specs/2026-08-11-authored-project-docs-design.md §8). Every
// case below is a REAL filename from the live vault, not a synthetic example —
// this test doubles as the executable record of what the spec's own table says
// each one resolves to, verified against a real parser rather than assumed.

// --- project ------------------------------------------------------------------

test('classifyAuthoredProject: the sparta-migrator sub-project, including the bare overview file', () => {
  for (const f of ['sparta-migrator', 'sparta-migrator-roadmap', 'sparta-migrator-sf-cli-removal-adr', 'sparta-migrator-gap-analysis']) {
    assert.equal(classifyAuthoredProject(f), 'sparta-suite/migrator', f);
  }
});

test('classifyAuthoredProject: the processing-agent/translation sub-project', () => {
  for (const f of ['processing-agent-translation-overview', 'processing-agent-translation-user-guide']) {
    assert.equal(classifyAuthoredProject(f), 'processing-agent/translation', f);
  }
});

test('classifyAuthoredProject: processing-agent top-level (not the translation sub-project)', () => {
  for (const f of ['processing-agent-overview', 'processing-agent-architecture', 'processing-agent-skills']) {
    assert.equal(classifyAuthoredProject(f), 'processing-agent', f);
  }
});

// Named to match the MOC that already exists (moc/sparta-suite.md), not a
// shorter unexamined "sparta" guess that would target a different, new file —
// spec §5.1's naming note.
test('classifyAuthoredProject: the sparta-suite top-level apps', () => {
  for (const f of ['sparta-governance', 'sparta-ideas', 'sparta-siop', 'sparta-spartanet', 'sparta-usage-tracker', 'sparta-scope', 'sparta-platform', 'sparta-suite-overview']) {
    assert.equal(classifyAuthoredProject(f), 'sparta-suite', f);
  }
});

test('classifyAuthoredProject: a sibling-repo note names its parent project by its own content, not its filename prefix', () => {
  assert.equal(classifyAuthoredProject('HCLS-LABS-SS-migrator-package'), 'sparta-suite/migrator');
});

test('classifyAuthoredProject: cross-cutting research with no project gets none — never guessed', () => {
  assert.equal(classifyAuthoredProject('sf-cli-local-auth-mechanics'), null);
});

// --- kind -----------------------------------------------------------------------

test('classifyAuthoredKind: diagram, from any of the three diagram-suffix spellings seen live', () => {
  for (const f of ['processing-agent-architecture-diagrams', 'processing-agent-process-diagrams', 'processing-agent-translation-diagrams']) {
    assert.equal(classifyAuthoredKind(f, ''), 'diagram', f);
  }
});

test('classifyAuthoredKind: guide, for all three audience suffixes', () => {
  for (const f of ['processing-agent-user-guide', 'processing-agent-administrator-guide', 'processing-agent-developer-guide']) {
    assert.equal(classifyAuthoredKind(f, ''), 'guide', f);
  }
});

test('classifyAuthoredKind: reference, for every recognized reference-shaped suffix', () => {
  for (const f of ['processing-agent-configuration', 'processing-agent-skills', 'processing-agent-llm-integration', 'processing-agent-lwc', 'processing-agent-build-test', 'processing-agent-dashboards', 'sparta-migrator-gap-analysis', 'sparta-migrator-user-journeys', 'sparta-migrator-mission-control-redesign']) {
    assert.equal(classifyAuthoredKind(f, ''), 'reference', f);
  }
});

test('classifyAuthoredKind: decision, for both real ADRs', () => {
  for (const f of ['sparta-migrator-sf-cli-removal-adr', 'sparta-migrator-local-git-dev-mode-adr']) {
    assert.equal(classifyAuthoredKind(f, ''), 'decision', f);
  }
});

test('classifyAuthoredKind: roadmap and architecture and overview suffixes', () => {
  assert.equal(classifyAuthoredKind('sparta-migrator-roadmap', ''), 'roadmap');
  assert.equal(classifyAuthoredKind('sparta-scope-roadmap', ''), 'roadmap');
  assert.equal(classifyAuthoredKind('processing-agent-architecture', ''), 'architecture');
  assert.equal(classifyAuthoredKind('processing-agent-overview', ''), 'overview');
  assert.equal(classifyAuthoredKind('processing-agent-translation-overview', ''), 'overview');
});

// A bare `<project-name>.md` with no doc-kind suffix at all is resolved
// structurally, not guessed: confirmed live that every one of these opens
// `# <slug>` immediately followed by a blank line then `## Summary` — the
// identical shape sparta-migrator.md itself uses, which is unambiguously that
// project's own overview page.
test('classifyAuthoredKind: bare project-name files resolve to overview via the # title / ## Summary shape', () => {
  const body = '\n# sparta-governance\n\n## Summary\n\nSome text.\n';
  for (const f of ['sparta-governance', 'sparta-ideas', 'sparta-siop', 'sparta-spartanet', 'sparta-usage-tracker', 'sparta-scope', 'sparta-platform', 'sparta-migrator']) {
    assert.equal(classifyAuthoredKind(f, body), 'overview', f);
  }
});

test('classifyAuthoredKind: the one file that matches the bare-overview SHAPE but is not one, by explicit exception', () => {
  // sparta-suite/migrator already has its overview (sparta-migrator.md itself);
  // this is a supporting artifact of that project, not a second front door.
  const body = '\n# HCLS-LABS-SS-migrator-package\n\n## Summary\n\nA sibling repo...\n';
  assert.equal(classifyAuthoredKind('HCLS-LABS-SS-migrator-package', body), 'reference');
});

test('classifyAuthoredKind: cross-cutting research with no project defaults to the note escape hatch', () => {
  assert.equal(classifyAuthoredKind('sf-cli-local-auth-mechanics', 'anything'), 'note');
});

test('classifyAuthoredKind: a filename with no recognized suffix and a body that does not match the overview shape resolves to nothing — never guessed', () => {
  assert.equal(classifyAuthoredKind('some-random-file', '# Title\nNot a summary shape.\n'), null);
});

// --- decision-status --------------------------------------------------------------

test('classifyDecisionStatus: only applies to kind: decision pages', () => {
  assert.equal(classifyDecisionStatus('overview', '## Status\n\n**Decided, done.**\n'), null);
});

test('classifyDecisionStatus: "decided"/"done"/"shipped"/"merged" all read as accepted — both real ADRs use this phrasing', () => {
  assert.equal(classifyDecisionStatus('decision', '## Status\n\n**Decided, done, and verified.** Full replacement...\n'), 'accepted');
  assert.equal(classifyDecisionStatus('decision', '## Status\n\n**Decided, done, and merged to `main`** — PRs...\n'), 'accepted');
});

test('classifyDecisionStatus: recognizes the other three Nygard states from unambiguous keywords', () => {
  assert.equal(classifyDecisionStatus('decision', '## Status\n\n**Proposed.** Awaiting review.\n'), 'proposed');
  assert.equal(classifyDecisionStatus('decision', '## Status\n\n**Superseded** by ADR-7.\n'), 'superseded');
  assert.equal(classifyDecisionStatus('decision', '## Status\n\n**Deprecated.**\n'), 'deprecated');
});

test('classifyDecisionStatus: no confident keyword match leaves it unset rather than guessed', () => {
  assert.equal(classifyDecisionStatus('decision', '## Status\n\nSomething ambiguous.\n'), null);
});

// --- insertAuthoredMetadata ----------------------------------------------------

test('insertAuthoredMetadata appends only the fields provided, at the end of the frontmatter block', () => {
  const text = '---\ntype: authored\nsources: []\nai-generated: true\n---\nbody\n';
  const out = insertAuthoredMetadata(text, { project: 'sparta-suite', kind: 'overview' });
  assert.match(out, /ai-generated: true\nproject: sparta-suite\nkind: overview\n---/);
  assert.ok(out.endsWith('---\nbody\n'));
});

test('insertAuthoredMetadata writes decision-status alongside kind for an ADR', () => {
  const text = '---\ntype: authored\nsources: []\nai-generated: true\n---\nbody\n';
  const out = insertAuthoredMetadata(text, { project: 'sparta-suite/migrator', kind: 'decision', decisionStatus: 'accepted' });
  assert.match(out, /kind: decision\ndecision-status: accepted/);
});

test('insertAuthoredMetadata is idempotent — never duplicates or clobbers a field already present', () => {
  const text = '---\ntype: authored\nsources: []\nai-generated: true\nproject: existing-value\n---\nbody\n';
  const out = insertAuthoredMetadata(text, { project: 'would-be-wrong', kind: 'overview' });
  assert.equal((out.match(/^project:/gm) || []).length, 1);
  assert.match(out, /project: existing-value/);
  assert.match(out, /kind: overview/, 'kind is still added — only the already-present field is protected');
});

test('insertAuthoredMetadata is a no-op when nothing was classified', () => {
  const text = '---\ntype: authored\nsources: []\nai-generated: true\n---\nbody\n';
  assert.equal(insertAuthoredMetadata(text, {}), text);
});
