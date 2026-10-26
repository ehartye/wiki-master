// Reads the backlog items below one folder of a vault: every Markdown page whose `kind` is
// backlog-item, as the shape lib/backlog-deps.mjs analyzes. Read-only and scoped to the folder, so
// a caller that needs only authored pages does not build the whole-vault graph. Dot entries and
// symlinked directories are skipped, which also keeps a link cycle from being followed.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNote } from './note.mjs';

export function readBacklogItems(vaultPath, startDir) {
  const items = [];
  (function walk(abs, rel) {
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(join(abs, e.name), `${rel}/${e.name}`);
      else if (e.name.endsWith('.md')) {
        let markdown;
        try { markdown = readFileSync(join(abs, e.name), 'utf8'); } catch { continue; }
        const { metadata, body } = parseNote(markdown);
        if (metadata.kind !== 'backlog-item') continue;
        items.push({
          path: `${rel}/${e.name}`,
          project: typeof metadata.project === 'string' ? metadata.project : undefined,
          backlogStatus: metadata['backlog-status'],
          metadata,
          title: body.match(/^#[ \t]+(.+?)[ \t]*$/m)?.[1] ?? e.name.slice(0, -3),
        });
      }
    }
  })(join(vaultPath, ...startDir.split('/')), startDir);
  return items;
}
