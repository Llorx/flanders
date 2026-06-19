# Flanders voice CLI variant pools

## The `implement` command's flavored fixed messages are drawn from fixed Ned-Flanders variant pools

The fixed user-facing messages the `implement` command emits are not single strings: each is realized as one variant drawn from a fixed pool of Ned-Flanders-flavored variants, so the user does not see the same string every time. The user-facing behavior — that a pool exists, and how a variant is chosen from it — is pinned by [.spec/contracts/shared/flanders-voice.md](/.spec/contracts/shared/flanders-voice.md), [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md), and [.spec/contracts/cli-commands/implement/overview.md](/.spec/contracts/cli-commands/implement/overview.md). This rule pins the exact membership of each pool. Every variant is in English, the language these commands address the user in.

### Who this applies to

- **Subject:** the code in `src/ui` that renders the bottom-fixed block's footer working label and the terminal label shown at exit, and the code in `src/commands` that prints the `implement` command's completion messages and selects the terminal label for the outcome.
- **Not subject:** every other message and surface. The header activity identifiers (`implementing`, `reviewing`, `building`, `testing`, `done`) are literal and not drawn from any pool. Agent narration and skill messages carry the voice through prompt instructions, not from these pools (see [src/prompts/.spec/rules/ai/flanders-tone.md](/src/prompts/.spec/rules/ai/flanders-tone.md)).

### Selection

How a variant is selected from each pool is pinned by the owning contract: the working-label rotation by [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md), the random per-occurrence choice of a terminal label by [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md), and the random per-occurrence choice of a completion message by [.spec/contracts/cli-commands/implement/overview.md](/.spec/contracts/cli-commands/implement/overview.md). This rule fixes only which variants each pool contains.

### Working-label pool

The footer working label rotates through exactly these 50 variants:

- `Workin'-diddly`
- `Toilin' away`
- `Okely-workin'`
- `Pluggin' away`
- `Diddly-doin'`
- `Beaverin' away`
- `Tinkerin'-diddly`
- `Hammerin' away`
- `Whittlin' away`
- `Doodly-doin'`
- `Scribblin'-diddly`
- `Codin'-aroo`
- `Buildin'-diddly`
- `Fixin'-diddly`
- `Noodlin' away`
- `Tappity-tappin'`
- `Diddly-dabblin'`
- `Plowin' ahead`
- `Chuggin' along`
- `Pressin' on-aroo`
- `Diligent-diddly`
- `Steady-diddly`
- `Crunchin'-diddly`
- `Diddly-developin'`
- `Wranglin' code`
- `Pokin' at it`
- `Diddly-debuggin'`
- `Cookin'-diddly`
- `Trundlin' along`
- `Diddly-draftin'`
- `Bustlin'-aroo`
- `Hummin' along`
- `Choppin'-diddly`
- `Sweatin'-diddly`
- `Diddly-deliverin'`
- `Craftin'-aroo`
- `Workin'-aroo`
- `Toilin'-diddly`
- `Diddly-drudgin'`
- `Gettin' it done`
- `Grindin'-diddly`
- `Diddly-graftin'`
- `Peggin' away`
- `Diddly-doodlin'`
- `Crankin'-diddly`
- `Hustlin'-diddly`
- `Diddly-diggin'`
- `Pluggin'-diddly`
- `Tappin' keys`
- `Dilly-workin'`

### Success terminal-label pool

The terminal label shown when the command ends on a non-error path is one of exactly these 10 variants:

- `Done-diddly`
- `Done-diddly-done`
- `All wrapped up, neighbor`
- `Okely-dokely — done`
- `Done-aroo`
- `Hi-diddly-done`
- `All done, neighborino`
- `Done and done-diddly`
- `That's a wrap, neighbor`
- `Mission accomplished-diddly`

### Hard-stop terminal-label pool

The terminal label shown when the run ends on a hard stop is one of exactly these 10 variants:

- `Whoopsie, hard stop`
- `Dilly of a pickle — hard stop`
- `Hard stop, neighbor`
- `Hard stop-aroo`
- `Well, heck — hard stop`
- `Hard stop-diddly`
- `Fiddlesticks — hard stop`
- `Gotta call it — hard stop`
- `Pumpin' the brakes — hard stop`
- `Hard stop, neighborino`

### Interruption terminal-label pool

The terminal label shown when the command is interrupted is one of exactly these 10 variants:

- `Interrupted-aroo`
- `Well, heck — interrupted`
- `Interrupted, neighbor`
- `Stopped short-diddly`
- `Cut off-aroo`
- `Hold the phone — interrupted`
- `Interrupted-diddly`
- `Toodle-oo — interrupted`
- `Interrupted, neighborino`
- `Halted-aroo`

### Failure terminal-label pool

The terminal label shown when the command ends on any other failure is one of exactly these 10 variants:

- `Aw, fiddlesticks — failed`
- `Dad-gummit — failed`
- `Failed, neighbor`
- `Failed-aroo`
- `Gosh-darn it — failed`
- `Heavens to Betsy — failed`
- `Failed-diddly`
- `Well, shucks — failed`
- `That's a no-go — failed`
- `Failed, neighborino`

### Tasks-completed message pool

The message printed when every task in the plan was already marked complete at startup is one of exactly these 10 variants:

- `tasks completed — nothin' to do-diddly-do, neighbor!`
- `all done already, neighbor — okely-dokely!`
- `nothin' left to do here, neighbor!`
- `tasks completed — already shipshape, neighborino!`
- `nothin' to do-diddly-do — all set, neighbor!`
- `tasks completed — couldn't be tidier, neighbor!`
- `all squared away already — okely-dokely!`
- `nothin' doin' here — all done, neighbor!`
- `tasks completed — easy-peasy, neighborino!`
- `all wrapped up already, neighbor — toodle-oo!`

### All-tasks-completed message pool

The message printed when every remaining task was implemented and accepted during the run is one of exactly these 10 variants:

- `all tasks completed — okely-dokely-doo, neighbor!`
- `all tasks completed — hi-diddly-done, neighbor!`
- `every last task done-diddly-done, neighbor!`
- `all tasks completed — that's a wrap, neighborino!`
- `all tasks completed — mission accomplished-diddly!`
- `all tasks done and dusted, neighbor — okely-dokely!`
- `all tasks completed — nailed it-aroo, neighbor!`
- `every task done-diddly-done — toodle-oo, neighbor!`
- `all tasks completed — what a humdinger, neighbor!`
- `all tasks completed — done and done, neighborino!`
