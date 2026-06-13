# `/flanders-work` Skill Contract

## Purpose
Carry a single, self-contained piece of work from request to reviewed completion in one invocation, without authoring a plan or running the `implement` pipeline. The skill is the lightweight path for small, well-scoped tasks: it implements the user's request directly in the user's own AI-tool session and gates the result through the same adversarial review the `implement` command applies, reworking until the review is clean. The skill runs inside the user's own AI-tool session and writes its changes directly into the user's project.

## Provisioning
The skill becomes available only after the user runs `npx flanders install` (see `.docs/contracts/cli-commands/install.md`). The skill is installed for each AI tool the user picked at install time (Claude Code, Codex CLI, or both). The invocation form below is the same regardless of which AI tool the user is invoking it from.

## Invocation
The user invokes the skill from inside an AI-tool session as:

    /flanders-work [<data>]

The optional `<data>` argument is interpreted the same way as `/flanders-spec` and `/flanders-plan`:
- Omitted: the skill takes the user's natural-language request from the conversation.
- Supplied and resolves to an existing file path: the file's content is read and used as the input.
- Supplied and does not resolve to an existing file path: the value is used verbatim as the inline input.

## Behavior
The skill carries the request through a work-then-review cycle:

1. **Work.** The session that invoked the skill performs the work itself: it implements the request directly, editing the project's code and updating or extending tests so the new behavior is covered. The work honors every contract, rule, and behavior rule in the project's spec corpus whose scope its changes touch — discovered across the project's `.docs` folders — whether or not the request names them, the same obligation the `implement` command places on its worker.

2. **Review.** Once the work is done, the skill validates the result through a single adversarial reviewer it runs as a subagent within the same session. The reviewer applies the same review methodology the `implement` command's adversarial reviewer applies: it determines the change set under review, and it fails the work when the request is not satisfied, when a contract or rule that applies is not honored, or when an applicable behavior rule is not honored — enumerating every violation it finds rather than stopping at the first. The reviewer reports the violations it finds back to the skill.

3. **Iterate.** When the review reports violations, the skill reworks the implementation to address them and reviews again. This cycle repeats with no fixed upper bound until a review reports no violations. The user may interrupt the session to stop it.

4. **Finish.** When a review reports no violations, the skill's work is complete. It does not commit, does not write or update any plan file, and does not write any Flanders configuration. The implemented changes are left in the working tree for the user to dispose of.

### The reviewer is an in-session subagent, independent of the Flanders configuration
The reviewer is a subagent the skill runs within the same session — an instance of the same AI tool the user is running the skill in, not an invocation governed by the Flanders configuration. The worker tool, model, effort, and reviewer list persisted in `.flanders/` (see `.docs/contracts/shared/flanders-config.md`) do not govern it: its tool, model, and effort are the host session's. The skill runs exactly one reviewer, not the configured reviewer list the `implement` command runs.

## Git
The skill does not commit and does not require the working tree to be clean before it runs. The project is expected to be a git repository so the reviewer can determine the change set under review; the reviewer judges the working tree against the latest commit, so any uncommitted change present when the review runs is part of what the reviewer evaluates, whether or not the skill itself produced it.

## Spec-folder immovability
Neither the work the session performs nor the reviewer subagent creates, modifies, deletes, or renames any file inside any `.docs/contracts` folder, any `.docs/rules` folder, or the `plans/` folder. Those folders are governed by their dedicated skills, per `.docs/contracts/shared/spec-folder-write-authority.md`. The skill consults the spec corpus freely but never writes to it.

## Interaction language
The natural language the skill converses in with the user — its progress messages, the summary it prints when the work is done or when it surfaces a review that keeps failing, and every other message it prints in chat — is resolved per `.docs/contracts/ai-skills/interaction-language.md`.

## Out of scope
- The skill does not produce a plan file and does not run the `implement` command's iteration loop, build and test gates, per-task commits, or task metrics.
- The skill does not read or write the Flanders configuration; it relies only on having been installed.
- The exact internal contents of the skill artifact (frontmatter fields, body shape) are implementation choices, pinned only insofar as the user is able to invoke `/flanders-work` from inside an AI-tool session of each selected tool after a successful `install` run.
