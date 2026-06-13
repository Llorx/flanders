# Build and Test Validation — Shared Contract

## Purpose
Define, once for every Flanders surface that validates a project through build and test, how the build and test commands are determined and how they run as ordered validation gates. The `implement` command (see `.docs/contracts/cli-commands/implement/workspace.md` and `.docs/contracts/cli-commands/implement/iteration-loop.md`) and the `/flanders-work` skill (see `.docs/contracts/ai-skills/work-skill.md`) both rely on this behavior. This contract is surface-neutral: where the commands are stored, how they are invoked, and how a surface recovers from a failing gate are each surface's own concern, defined where that surface is defined.

## Determining the build and test commands
- The project is inspected directly to recognize what kind of project it is and the build and test commands it exposes. The determination reads the project itself — it does not ask the user and does not consult a Flanders configuration file.
- The build command and the test command are determined independently: either one may be determinable while the other is not.
- A command that cannot be confidently determined is left undetermined. Its validation gate is then skipped, and no fallback command is invented in its place.
- A determined command is the project's own native build or test command — for example, the `build`/`test` scripts a Node.js project exposes, or the host's compiler or build-system invocation for a C++ project. The exact command is an output of inspecting the project, never a value fixed by this contract.

## Build and test as ordered validation gates
- Build and test run as two ordered validation gates: the build gate runs first, and the test gate runs after it.
- Each gate passes when its command completes with a success status and fails when its command completes with a failure status.
- A gate whose command was left undetermined is skipped, and a skipped gate counts as passed.
- The output a failing gate's command produced is the diagnostic the surface relies on to recover. This contract fixes that a failing gate blocks progress past it until the gate passes; the recovery a surface performs in response — and whether reaching a passing build and test gate is a precondition of a later stage — is defined by that surface.

## Out of scope
- Where the determined commands are stored and how they are invoked (a script file, an in-session command, or otherwise).
- What a surface does when a gate fails (restarting a loop, reworking in place, or otherwise) and what it preserves for diagnosis.
- The order of build and test relative to any other stage a surface runs around them.
