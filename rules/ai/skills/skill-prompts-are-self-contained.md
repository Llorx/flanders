# Flanders skill artifact prompts are self-contained — no citations of flanders-internal spec paths

The body of every Flanders skill artifact — the prompt text that the `install` command writes to the user's AI-tool skill folders, where each artifact represents `/flanders-spec` or `/flanders-plan` — is self-contained. Every obligation the artifact enforces is inline in its body. The body never cites a specific file path that points to a file under flanders' own `contracts/`, `rules/`, or `plans/` folders, because those folders do not exist in the user's project where the artifact runs and the citation resolves to nothing.

## Who this applies to

- **Subject:** the source content that produces each Flanders skill artifact body — every place in the flanders codebase where the prompt text shipped by `install` is authored or assembled.
- **Subject:** the resulting skill artifact files that `install` writes into the user's AI-tool skill folders.
- **Not subject:** files under flanders' own `contracts/`, `rules/`, or `plans/` folders, which freely cross-reference each other by relative path. Those files are flanders' development spec and never ship to user projects.

## What is forbidden in a skill artifact body

- A relative or absolute path that names a specific file under flanders' own `contracts/`, `rules/`, or `plans/` folders. Examples of what NOT to embed: `contracts/ai-skills/spec-skill.md`, `rules/ai/skills/final-validator-host.md`, `rules/ai/agents/no-git-writes.md`, `contracts/shared/spec-folder-write-authority.md`, `contracts/cli-commands/install.md`.
- A phrase that defers an obligation to such a file — "the full obligation lives in X", "subject to X", "see X for the canonical definition", "verbatim from X", and analogous deferrals — when `X` is a flanders-internal spec path. The obligation itself is inlined in the body; the pointer is removed.

## What is permitted in a skill artifact body

- Structural references to the user's project folders by their conventional names — `contracts/`, `rules/`, `plans/` — without naming a specific file inside them. For example: "list every file currently inside the project's `contracts/` folder", "persist exactly one markdown file inside the project's `plans/` folder", "for every leaf task, link the relevant contract file or files by their listed relative path".
- Names of user-visible AI tools the skill targets (Claude Code, Codex CLI) and the install destinations those tools use as already pinned by the install behavior the user has consented to.

The body never embeds a specific file path that points to a file from flanders' own spec.

## How to apply this rule

When authoring or editing a skill artifact body source, search the body for any string of the form `contracts/<path>`, `rules/<path>`, or `plans/<path>` where `<path>` names a file rather than just the folder. Every such citation is removed. The substantive obligation the citation pointed at is inlined in its place — the citation is the only thing being stripped; the obligation itself stays in the body. The result is a body that, when shipped to an arbitrary user project, makes sense in that project without requiring access to flanders' own repository.

When a flanders-internal spec file is renamed, the correct response in any skill artifact body that cites it is to REMOVE the citation, not to update the path.

## Failure signals

- A skill artifact body, once written by `install` into a user project, contains a path under `contracts/`, `rules/`, or `plans/` that names a specific file — and that file does not exist in the user's project (because it belongs to flanders' own repository).
- A skill artifact body says "the full obligation lives in X.md", "verbatim from X.md", or any analogous deferral, where X is a flanders-internal spec path.
- A flanders-internal spec file is renamed and the rename is propagated into a skill artifact body as a path update, instead of the citation being removed entirely.
- The artifact body source in flanders' codebase is edited to add a new citation to a flanders-internal spec path instead of inlining the obligation.
