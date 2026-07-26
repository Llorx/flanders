# Duplicated: flanders-internal spec-path citation matcher
Date: 2026-07-26

## What
The regex that recognizes a citation of a flanders-internal spec file — a path under a spec folder that names a specific `.md` file — is declared independently in two test modules under `src/prompts`, both named `INTERNAL_SPEC_PATH_CITATION`. The two copies have already drifted: the folder alternation and the filename character class differ.

## Where
- `src/prompts/skills.test.ts:12` — `/(contracts|rules|flanders|plans)\/[A-Za-z0-9][A-Za-z0-9._/\-]*\.md/`, shared by every skill-artifact-body self-containedness guard. Covers the `flanders` folder and allows a leading digit and dots in the filename (a timestamped plan name).
- `src/prompts/prompts.test.ts:9` — `/(contracts|rules|plans)\/[A-Za-z][A-Za-z0-9_/\-]*\.md/`, shared by the agent-prompt self-containedness guards. Does not cover the `flanders` folder, and rejects a leading digit and dots.

## Why It Matters
The two copies encode the same concept, so a gap closed in one silently persists in the other — exactly what happened here: the `flanders` folder was missing from both, and adding it to the skill-body copy left the agent-prompt copy still blind to a `.spec/flanders/<file>.md` citation. A single shared matcher would give the concept one authoritative source. Consolidating it is deferred rather than fixed inline because it requires deciding one folder set and one filename character class for both subject families, and the agent-prompt family's obligations (its prompts legitimately enumerate the host project's own behavior rules) must be re-derived before its guard is widened — work outside the scope of the change that surfaced this.
