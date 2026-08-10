# Grouping triage items by research topic — design

**Date:** 2026-08-10
**Status:** implemented in 0.13.0

## 1. The problem

Triage groups by **kind** — clip failures, fidelity flags, expiring declines, ingest backlog,
hub-stubs. Kind determines which actions a row offers, so that structure is load-bearing and is
not going away.

But it is the wrong axis for *deciding*. A user does not sit down to disposition "all fidelity
flags"; they sit down to deal with **the research run that produced them**. Twelve failed clips
from a BPD sweep and three from an audio-DSP sweep are two unrelated decisions wearing one
label, and the queue gives no way to tell them apart. On a vault with several hundred queued
items the kind groups are a flat wall.

## 2. What exists today — nothing

There is no persisted notion of a research topic anywhere in wiki-master. It exists in exactly
three transient places:

- `/wiki-discover`'s `$ARGUMENTS`, which is gone when the turn ends;
- the log entry title (`--op discover --title "<topic> → N clipped, M ingested"`), which is
  prose, not a field;
- the `op-commit` title, same.

Deriving topic from log entries by date was considered and rejected: several runs happen on one
day, `created:` on a clipping is a date not a timestamp, and the join would silently mis-attribute
rather than fail. A wrong topic is worse than none — it hides items in a group the user has
already decided about.

## 3. Design: two carriers, one resolver

Topic is recorded at the moment it is known — clip time — into two places, because triage items
come from two populations with different lifetimes.

### 3.1 `topic:` in clipping frontmatter — the durable carrier

`clip.mjs --topic="<topic>"` writes a `topic:` line into the clipping's frontmatter. This is the
primary carrier because it is the only one that is **git-tracked and therefore shared across
machines**: `.wiki-master/` is gitignored, so anything stored there is local to one clone.

It attributes every item that has a file behind it: fidelity flags (scanned from that same
frontmatter) and the ingest backlog (whose rows *are* clipping paths).

`raw/` bodies are immutable, but frontmatter written at creation time is not a mutation — this is
the same slot `source-hash`, `fidelity`, and `extraction` already occupy.

### 3.2 `topic` on triage log events — for items with no file

A clip that 403s never becomes a file, so frontmatter cannot carry its topic. `recordIssue` gains
a `topic` field, appended into `triage.jsonl` like every other event.

The coupling is free: `clip.mjs`'s failure and thin paths already call `recordIssue`, so one
`--topic` flag feeds both carriers and no caller has to know which one applies.

### 3.3 Resolution order

For each triage item, first match found wins:

1. the `topic` on its own triage-log event;
2. the `topic:` frontmatter of the clipping whose `source:` matches the item's URL;
3. the `topic:` frontmatter of the clipping at the item's path (backlog rows are paths);
4. **Unattributed**.

Hub-stubs are wiki pages, not clippings, and have no research origin. They land in Unattributed
by construction, which is correct rather than a gap.

### 3.4 Retroactive attribution is not attempted

Every clipping that predates this change has no `topic:`, and there is no sound way to infer one.
They group under Unattributed. This is stated plainly in the UI rather than hidden — a topic bar
that silently omitted two thirds of the queue would be the same silent-truncation lie the
existing bulk buttons are careful to avoid.

## 4. UI: a filter, not a re-grouping

Topic becomes a **filter across** the kind groups, not a replacement for them.

Making topic the outer grouping was rejected: it would nest kind inside topic, multiplying the
group headers (and their bulk buttons) by the number of topics, and it would scatter one kind's
rows across the page — so "disposition every fidelity flag" would become the hard case instead
of the easy one. A filter gives the topic-scoped view without taking the kind-scoped one away.

- A topic bar renders above the groups: `All`, one chip per topic, `Unattributed` last. Each
  carries its count.
- Every row carries `data-topic-key`, and shows a topic chip when it has one.
- Selecting a topic hides non-matching rows and any group left empty.

### 4.1 The bulk-count invariant

`group()` already refuses to let "apply to all N" mean more than the rows actually rendered. A
filter breaks that guarantee if left alone: with a topic selected, "decline all 12" would still
reach the 9 hidden rows.

So filtering **recomputes every bulk button's count and label from the visible rows**, and the
bulk handler acts only on visible rows. A bulk button whose group has no visible rows is
disabled. This is the same honesty rule the truncated-backlog case already follows, extended to a
second way of showing fewer rows than exist.

## 5. Determinism

Topic groups sort by count descending, then by topic key ascending; Unattributed is always last
regardless of count. This project has been bitten repeatedly by filesystem iteration order
reaching user-visible output, so ordering is total and explicit rather than incidental.

Topic identity is `normalizeTopic` (trim, collapse internal whitespace) lowercased. Display keeps
the first-seen original casing.

## 6. What this does not do

- No back-fill of existing clippings, per §3.4.
- No topic taxonomy, hierarchy, aliasing, or merge. A topic is a free-text string the user
  already typed when they ran `/wiki-discover`; inventing structure over it before anyone has
  asked is exactly the over-building the repo's YAGNI rule forbids.
- No cross-machine sharing of triage *state*. `triage.jsonl` stays local, as it already is; only
  the frontmatter carrier syncs.
