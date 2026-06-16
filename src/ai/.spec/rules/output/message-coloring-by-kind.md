# AI agent message coloring is applied by the output renderer, keyed off the message kind

The component that renders the AI runner's `output` events into the text shown in the output region applies the message coloring itself, at render time, choosing each color from the kind of message being rendered — an assistant reply, reasoning, a tool or command action, or a tool or command result. The exact palette is the one pinned by the implement UI contract (see [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md), section `Colors`).

The color is decided from the message kind, never from which tool produced the message: the renderer derives a message's kind from the event it receives, not from the identity of the underlying tool. This keeps the coloring consistent with the output events staying tool-agnostic (see [src/ai/.spec/rules/runner/tool-interface.md](/src/ai/.spec/rules/runner/tool-interface.md)).

The coloring lives in the renderer and only there. An adapter must not synthesize color escape sequences for the purpose of implementing this kind-based coloring; turning a message's kind into its on-screen color is the renderer's responsibility. This is distinct from an adapter forwarding ANSI that the underlying tool's own output already contains, which the runner passes through unchanged per [src/ai/.spec/rules/runner/tool-interface.md](/src/ai/.spec/rules/runner/tool-interface.md).

## Who this applies to

- **Subject:** the AI output renderer — the code in `src/ai` that consumes the runner's `output` events and writes their on-screen representation into the command's single output channel.
- **Not subject:**
  - The per-tool adapters and the AI runner, which produce and forward the abstract `output` events and apply no terminal styling of their own (see [src/ai/.spec/rules/runner/tool-interface.md](/src/ai/.spec/rules/runner/tool-interface.md)).
  - The streaming output of the `building` and `testing` scripts, which is passed through to the terminal unchanged and is not recolored by the renderer.
  - The bottom-fixed block (header, metrics, footer) and the per-task completion snapshot, whose coloring is defined directly by the implement UI contract.
