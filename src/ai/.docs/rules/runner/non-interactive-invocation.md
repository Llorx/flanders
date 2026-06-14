# Every AI adapter invokes its tool non-interactively

A Flanders AI invocation runs a single turn to completion with no human in the loop. Each per-tool adapter must drive its binary in a mode where the tool never pauses mid-turn to obtain a tool-use approval, never requests a permission, and never raises a question to the user. The adapter holds no live input channel through which the tool could solicit input: after delivering the prompt it closes the binary's input stream so the turn terminates on its own, and it neither writes a control or approval response back to the tool nor forwards any question the tool could raise to the user.

## Who this applies to

- **Subject:** every per-tool adapter — today the Claude adapter ([src/ai/.docs/rules/runner/claude-invocation.md](/src/ai/.docs/rules/runner/claude-invocation.md)) and the Codex adapter ([src/ai/.docs/rules/runner/codex-invocation.md](/src/ai/.docs/rules/runner/codex-invocation.md)), and any adapter added later. Each adapter realizes this obligation through the specific flags and input handling of its own binary, pinned in that adapter's rule.
- **Not subject:** the AI runner and the runner's call sites (worker stage, reviewer stage, detect-agent, prep), which never touch a tool's invocation surface directly.

The user-visible consequence of this rule — that an implement run never pauses for the AI to ask the user anything — is stated in [.docs/contracts/cli-commands/implement/non-interactive.md](/.docs/contracts/cli-commands/implement/non-interactive.md).
