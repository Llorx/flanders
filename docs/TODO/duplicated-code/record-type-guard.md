# Duplicated: record type guard (non-null, non-array object check)
Date: 2026-07-24

## What
The predicate that decides whether an unknown value is a plain record — `typeof x === "object" && x !== null && !Array.isArray(x)`, or its negated form — is expressed independently across several modules. `src/commands/InstallModelProbe.ts` now names it as an `isRecord` type guard; the other sites inline the same three-part check.

## Where
- `src/commands/InstallModelProbe.ts:26` — `isRecord()` type guard, consumed by `parseEfforts` and `parseModelCatalog`.
- `src/workspace/FlandersConfig.ts:44` — inline guard rejecting a non-object top-level config.
- `src/workspace/FlandersConfig.ts:48` — inline guard on the `worker` field (combined with a `"worker" in obj` presence check).
- `src/workspace/FlandersConfig.ts:61` — inline guard on each `reviewers[i]` entry.
- `src/plan/PlanFile.ts:41` — inline guard in `validateMetrics` (a coverage-ignored defensive branch).

## Why It Matters
Five independent copies of the same object-shape predicate mean a fix or refinement applied to one copy silently misses the others. A single shared `isRecord` type guard imported by every site would give the check one authoritative source. The occurrences span `src/commands`, `src/workspace`, and `src/plan` — the latter two modules are unrelated to the codex-effort probe change that surfaced this pattern, and each is governed by its own validation rules — so consolidating the guard is deferred here rather than fixed inline, to avoid scope creep into those files.
