// The set of model identifiers that support Claude Code's fast mode — exactly the Opus 4.8 and Opus
// 4.7 catalog entries and their 1M-context variants, plus the auto-updating `Latest Opus` alias (and
// its 1M variant), which resolve to a fast-capable Opus. This is the single definition of the
// fast-capable set; both the install flag validation and the install interactive fast gating consult
// `modelSupportsFastMode`, so the set has no second copy. The `.flanders/config.json` reader does not
// consult it — fast-eligibility is enforced at install time, not by the reader. Pinned by
// `src/commands/.spec/rules/install.md#fast-mode-is-offered-only-for-a-claude-role-whose-model-supports-it`.
export const FAST_CAPABLE_MODELS:readonly string[] = [
    "opus",
    "opus[1m]",
    "claude-opus-4-8",
    "claude-opus-4-8[1m]",
    "claude-opus-4-7",
    "claude-opus-4-7[1m]"
];

// Whether a resolved model identifier supports Claude Code's fast mode. Returns true for exactly the
// six `FAST_CAPABLE_MODELS` identifiers and false for every other value — `best`, Opus 4.6 and
// earlier, every Sonnet/Haiku/Fable identifier, a custom-typed identifier outside the set, and the
// empty default-model string.
export function modelSupportsFastMode(model:string):boolean {
    return FAST_CAPABLE_MODELS.includes(model);
}
