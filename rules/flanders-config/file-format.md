# The `.flanders/` folder contains a single `config.json` file

The persistent Flanders configuration pinned by `contracts/shared/flanders-config.md` is materialized as a single JSON file at `.flanders/config.json` inside the chosen scope's folder. The file is written by `install` and read by every Flanders command that needs the configuration (today, `implement`). There are no other files inside `.flanders/`.

## Who this applies to

- **Subject:** the `install` command (writer) and every Flanders command that reads the configuration (reader, currently `implement`).
- **Not subject:** code outside Flanders. The folder is owned by Flanders; other tools must not place files inside it.

## File location

- **Project scope:** `<project root>/.flanders/config.json`.
- **Global scope:** `<user home>/.flanders/config.json`.

Both paths are resolved at the time `install` runs (writer) or at the time the consuming command starts (reader). The reader follows the precedence pinned in `contracts/shared/flanders-config.md`: a project `config.json` fully shadows a global one.

## Shape

The file is a UTF-8 JSON object parseable by Node.js's built-in `JSON.parse`. Its top-level keys are exactly:

```json
{
  "worker": {
    "tool": "claude" | "codex",
    "model": "<model-identifier>" | "",
    "effort": "<effort-level>" | ""
  },
  "reviewer": {
    "tool": "claude" | "codex",
    "model": "<model-identifier>" | "",
    "effort": "<effort-level>" | ""
  }
}
```

- `tool` — exactly one of the two string literals `"claude"` or `"codex"`. No other value is accepted.
- `model` — the model identifier the user supplied at install time, or an empty string `""` to mean "default configured model" (the runner does not pass an explicit model flag to the CLI).
- `effort` — the reasoning-effort identifier the user supplied at install time, or an empty string `""` to mean "default configured effort" (the runner does not pass an explicit effort flag to the CLI).

Both objects (`worker` and `reviewer`) are mandatory. Every field inside them is mandatory. Missing fields are a malformed configuration.

## Writes

`install` writes the file by serializing the in-memory configuration with `JSON.stringify` and a stable two-space indentation, plus a trailing newline. The write is atomic from the user's perspective: the file does not exist in a half-written state on disk. The exact mechanism (write to temp file then rename, write-with-flush, etc.) is implementation, but a malformed file on disk after a successful `install` run is a violation.

## Reads

A reader parses the file with `JSON.parse`. On any parse error, missing top-level key (`worker` or `reviewer`), missing inner field, or value outside the allowed shape above, the reader treats the configuration as malformed and exits non-zero with a diagnostic that names the offending field and the path to the file. The reader does not silently fill in defaults for missing fields — a malformed file is a hard error, not an opportunity for inference.

## Why one file and not several

- A single JSON keeps the read path trivial (one parse, one object) and the precedence rule trivial to apply (one file's presence shadows the other).
- A single JSON keeps the write path atomic per scope (one rename instead of N).
- Field-by-field merge across scopes is forbidden by `contracts/shared/flanders-config.md`, so there is no use case that would benefit from splitting the file by role.

## Failure signals

- `install` writes any file inside `.flanders/` other than `config.json`.
- `install` writes a `config.json` that is not parseable by `JSON.parse`, or that is missing any of the required fields, or whose `tool` value is neither `"claude"` nor `"codex"`.
- A reader silently substitutes a default for a missing or invalid field instead of failing with a diagnostic.
- A reader merges fields across scopes (for example, taking `worker` from the global file and `reviewer` from the project file).
- A reader parses `.flanders/` directory entries other than `config.json`.
