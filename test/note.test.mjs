import { test } from 'node:test';
import assert from 'node:assert/strict';

async function parse(markdown) {
  const mod = await import('../scripts/lib/note.mjs').catch(() => ({}));
  assert.equal(typeof mod.parseNote, 'function', 'shared note parser must be available');
  return mod.parseNote(markdown);
}

test('note parser preserves quoted commas, apostrophes and wikilinks in flow lists', async () => {
  const n = await parse(`---\ntitle: "Learning: a guide"\naliases: ["Learning, transfer", 'Learner''s guide', O'Brien]\nsources: ["[[raw/clippings/Study, one.md]]", '[[wiki/sources/Author''s study]]']\nproject: sparta/migrator\ndecision-status: accepted\n---\n# Body\n`);
  assert.deepEqual(n.aliases, ['Learning, transfer', "Learner's guide", "O'Brien"]);
  assert.deepEqual(n.sources, ['[[raw/clippings/Study, one.md]]', "[[wiki/sources/Author's study]]"]);
  assert.equal(n.metadata.title, 'Learning: a guide');
  assert.equal(n.metadata.project, 'sparta/migrator');
  assert.equal(n.metadata['decision-status'], 'accepted');
  assert.equal(n.body, '# Body\n');
});

test('note parser reads block lists and does not consume the following metadata', async () => {
  const n = await parse(`---\nsources:\n  - "[[raw/clippings/A.md]]"\n  - '[[wiki/sources/B]]'\naliases:\n  - 'A, B'\nreviewed: 2026-01-01\nupdated: 2026-09-07\nstatus: maintained\n---\nBody`);
  assert.deepEqual(n.sources, ['[[raw/clippings/A.md]]', '[[wiki/sources/B]]']);
  assert.deepEqual(n.aliases, ['A, B']);
  assert.equal(n.metadata.reviewed, '2026-01-01');
  assert.equal(n.metadata.updated, '2026-09-07');
});

test('notes without frontmatter retain their body and empty list contracts', async () => {
  assert.deepEqual(await parse('# Bare note'), { body: '# Bare note', metadata: {}, sources: [], aliases: [] });
});

test('shared exact identity trims and folds case while retaining punctuation', async () => {
  const { normalizeIdentity } = await import('../scripts/lib/note.mjs');
  assert.equal(typeof normalizeIdentity, 'function');
  assert.equal(normalizeIdentity(' Agent-Memory '), 'agent-memory');
  assert.notEqual(normalizeIdentity('Agent-Memory'), normalizeIdentity('Agent Memory'));
});

test('quoted scalar comments are excluded while quoted hash characters remain literal', async () => {
  const n = await parse(`---\nproject: "wiki-master" # Owning project\nscope: 'C# and references # in quotes' # Comment\naliases:\n  - "Agent Memory" # Equivalent term\n  - 'Author''s # guide' # Another comment\nsources: ["[[raw/clippings/C# guide.md]]", "[[raw/clippings/Other.md]]"] # Evidence\n---\nBody`);
  assert.equal(n.metadata.project, 'wiki-master');
  assert.equal(n.metadata.scope, 'C# and references # in quotes');
  assert.deepEqual(n.aliases, ['Agent Memory', "Author's # guide"]);
  assert.deepEqual(n.sources, ['[[raw/clippings/C# guide.md]]', '[[raw/clippings/Other.md]]']);
});
