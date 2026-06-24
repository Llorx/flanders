# The `.flanders/` folder contains a single `config.json` file

The persistent Flanders configuration pinned by [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md) is materialized as a single JSON file at `.flanders/config.json` inside the chosen scope's folder. The file is written by `install` and read by every Flanders command that needs the configuration (today, `implement`). There are no other files inside `.flanders/`.

## Who this applies to

- **Subject:** the `install` command (writer) and every Flanders command that reads the configuration (reader, currently `implement`).
- **Not subject:** code outside Flanders. The folder is owned by Flanders; other tools must not place files inside it.

## File location

- **Project scope:** `<project root>/.flanders/config.json`.
- **Global scope:** `<user home>/.flanders/config.json`.

Both paths are resolved at the time `install` runs (writer) or at the time the consuming command starts (reader). The reader follows the precedence pinned in [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md): a project `config.json` fully shadows a global one.

## Shape

The file is a UTF-8 JSON object parseable by Node.js's built-in `JSON.parse`. Its top-level keys are exactly:

```json
{
  "worker": {
    "tool": "claude" | "codex" | "antigravity",
    "model": "<model-identifier>" | "",
    "effort": "<effort-level>" | ""
  },
  "reviewers": [
    {
      "tool": "claude" | "codex" | "antigravity",
      "model": "<model-identifier>" | "",
      "effort": "<effort-level>" | "",
      "optional": true | false
    }
  ],
  "minimumReviews": <integer>
}
```

- `worker` — a single object describing the worker role.
- `reviewers` — a JSON array of one or more reviewer objects, in the order the user configured them. The array is never empty.
- `minimumReviews` — a JSON integer: the minimum number of reviewers that must run to a verdict in each review round. It is at least `1` and at most the number of entries in `reviewers`.
- Inside `worker` and each `reviewers` entry:
  - `tool` — exactly one of the three string literals `"claude"`, `"codex"`, or `"antigravity"`. No other value is accepted.
  - `model` — the model identifier the user supplied at install time, or an empty string `""` to mean "default configured model" (the runner does not pass an explicit model flag to the CLI).
  - `effort` — the reasoning-effort identifier the user supplied at install time, or an empty string `""` to mean "default configured effort" (the runner does not pass an explicit effort flag to the CLI). When `tool` is `"antigravity"`, this value is always the empty string `""`, because the Antigravity CLI exposes no reasoning-effort setting.
- Inside each `reviewers` entry only:
  - `optional` — a JSON boolean. `true` marks the reviewer optional: it may be cancelled before it finishes once its review round can complete without it. `false` marks it required: it always runs to a verdict and is never cancelled. See [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md).

The `worker` object, the `reviewers` array, and the `minimumReviews` integer are all mandatory; `reviewers` holds at least one entry; and every field inside `worker` and inside each reviewer entry — including each reviewer's `optional` — is mandatory. A missing top-level key, an empty `reviewers` array, a `minimumReviews` outside `[1, reviewers.length]`, or a missing inner field is a malformed configuration.

## Writes

`install` writes the file by serializing the in-memory configuration with `JSON.stringify` and a stable two-space indentation, plus a trailing newline. The write is atomic from the user's perspective: the file does not exist in a half-written state on disk. The exact mechanism (write to temp file then rename, write-with-flush, etc.) is implementation, but a malformed file on disk after a successful `install` run is a violation.

## Reads

A reader parses the file with `JSON.parse`. On any parse error, missing top-level key (`worker`, `reviewers`, or `minimumReviews`), a `reviewers` value that is not a non-empty array, a `minimumReviews` that is not an integer in `[1, reviewers.length]`, a reviewer `optional` that is not a boolean, a missing inner field, or a value outside the allowed shape above, the reader treats the configuration as malformed and exits non-zero with a diagnostic that names the offending field and the path to the file. The reader does not silently fill in defaults for missing fields — a malformed file is a hard error, not an opportunity for inference.

## Why one file and not several

- A single JSON keeps the read path trivial (one parse, one object) and the precedence rule trivial to apply (one file's presence shadows the other).
- A single JSON keeps the write path atomic per scope (one rename instead of N).
- Field-by-field merge across scopes is forbidden by [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md), so there is no use case that would benefit from splitting the file by role.

## Failure signals

- `install` writes any file inside `.flanders/` other than `config.json`.
- `install` writes a `config.json` that is not parseable by `JSON.parse`, or that is missing any of the required fields, or that serializes `reviewers` as an empty array or as anything other than an array, or whose `tool` value is none of `"claude"`, `"codex"`, or `"antigravity"`, or whose `minimumReviews` is not an integer in `[1, reviewers.length]`, or any of whose reviewer `optional` values is not a boolean.
- A reader silently substitutes a default for a missing or invalid field instead of failing with a diagnostic.
- A reader merges fields across scopes (for example, taking `worker` from the global file and `reviewers` from the project file).
- A reader parses `.flanders/` directory entries other than `config.json`.
