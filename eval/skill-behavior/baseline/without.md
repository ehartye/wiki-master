**A — Update and publish Atlas guide**

1. Work against `C:/vault`, using the existing Atlas guide. Inspect its content, metadata, and Git status; keep unrelated changes out of the update.
2. After the observed Obsidian CLI timeout, use normal filesystem access. Use PowerShell commands with explicit vault paths or `git -C C:/vault`.
3. Add the code-verified offline behavior and preserve the existing `sources[]` metadata. Do not advance the whole guide’s `reviewed` date: its other claims have not been reviewed.
4. Resolve the conflicting branch instructions before committing: the supplied user instruction prohibits committing on the default branch of the main checkout. Prepare the change on a feature branch or isolated worktree, and use the vault’s `op-begin`/`op-commit` workflow where compatible.
5. Review the diff for accuracy and scope, commit the guide change, integrate through the permitted workflow, and push. Verify the remote contains the published change.

User-facing update: “I’ll update the existing guide with the verified offline behavior, preserve the review status of its other claims, and publish the change.”

Stop condition: the intended remote branch contains the verified guide update. Say that the laptop can receive it; do not claim the laptop has synchronized without evidence.

**B — Find existing if-then planning material**

Use `wiki-search`, resolving “If-then planning” to “Implementation Intentions.” Search both the concept note and existing clipping, using aliases and exact phrases. Return matching page paths, relevant passages, and citation-ready line numbers. Do not synthesize a new answer, discover sources, ingest anything, or save a page.

User-facing response: “Here are the existing pages and passages matching if-then planning.”

Stop condition: relevant existing matches have been located and reported without mutations.

**C — Check whether recommendations remain current**

First separate structural integrity from factual currency. A health score of 100 shows no detected structural problems; it does not establish that recommendations remain current. Yesterday’s edits also do not establish review.

Run a stale-knowledge inventory, identifying the 12 undated concepts and checking the review dates and evidence for the remaining 28. Treat the drift run as unsuccessful: zero evaluated items and ten failures provide no drift conclusion. Restore the embedder and rerun the sample, then verify dated or consequential recommendations against current authoritative evidence.

User-facing response: “The wiki is structurally healthy, but its factual currency is not established. Twelve concepts lack review dates, and the drift check evaluated nothing because the embedder failed.”

Stop condition: deliver an evidence-backed currency assessment identifying verified, stale, and unresolved recommendations; explicitly report any remaining verification failures.

**D — Application database naming**

No wiki mutation operation is appropriate. A bounded `wiki-search` for existing application schema conventions or terminology may inform the decision because the wiki is designated as the source of truth. Then inspect the application’s schema and usage to determine whether rows represent source documents or citations to those documents.

Do not invoke wiki authoring, ingestion, or discovery merely because the proposed table names resemble wiki terminology. Stop after giving the naming recommendation and its rationale.
