// Single source of truth for the closed set of AI tools Flanders supports: the runtime allowed
// list the config validator checks against, and — via ToolName, derived from this list in
// ToolAdapter — the type the adapter identity, the persisted config role tool (FlandersRole.tool),
// and the reviewing-footer tool token (ReviewerTool) all reuse. The set is stated once here rather
// than repeated per layer.
export const TOOL_NAMES = ["claude", "codex", "antigravity"] as const;
