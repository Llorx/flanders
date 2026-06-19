import type { RandomContext } from "./contexts";

// The footer working label rotates through these 50 variants.
export const workingPool:readonly string[] = [
    "Workin'-diddly",
    "Toilin' away",
    "Okely-workin'",
    "Pluggin' away",
    "Diddly-doin'",
    "Beaverin' away",
    "Tinkerin'-diddly",
    "Hammerin' away",
    "Whittlin' away",
    "Doodly-doin'",
    "Scribblin'-diddly",
    "Codin'-aroo",
    "Buildin'-diddly",
    "Fixin'-diddly",
    "Noodlin' away",
    "Tappity-tappin'",
    "Diddly-dabblin'",
    "Plowin' ahead",
    "Chuggin' along",
    "Pressin' on-aroo",
    "Diligent-diddly",
    "Steady-diddly",
    "Crunchin'-diddly",
    "Diddly-developin'",
    "Wranglin' code",
    "Pokin' at it",
    "Diddly-debuggin'",
    "Cookin'-diddly",
    "Trundlin' along",
    "Diddly-draftin'",
    "Bustlin'-aroo",
    "Hummin' along",
    "Choppin'-diddly",
    "Sweatin'-diddly",
    "Diddly-deliverin'",
    "Craftin'-aroo",
    "Workin'-aroo",
    "Toilin'-diddly",
    "Diddly-drudgin'",
    "Gettin' it done",
    "Grindin'-diddly",
    "Diddly-graftin'",
    "Peggin' away",
    "Diddly-doodlin'",
    "Crankin'-diddly",
    "Hustlin'-diddly",
    "Diddly-diggin'",
    "Pluggin'-diddly",
    "Tappin' keys",
    "Dilly-workin'",
];

// The terminal label shown when the command ends on a non-error path.
export const successPool:readonly string[] = [
    "Done-diddly",
    "Done-diddly-done",
    "All wrapped up, neighbor",
    "Okely-dokely — done",
    "Done-aroo",
    "Hi-diddly-done",
    "All done, neighborino",
    "Done and done-diddly",
    "That's a wrap, neighbor",
    "Mission accomplished-diddly",
];

// The terminal label shown when the run ends on a hard stop.
export const hardStopPool:readonly string[] = [
    "Whoopsie, hard stop",
    "Dilly of a pickle — hard stop",
    "Hard stop, neighbor",
    "Hard stop-aroo",
    "Well, heck — hard stop",
    "Hard stop-diddly",
    "Fiddlesticks — hard stop",
    "Gotta call it — hard stop",
    "Pumpin' the brakes — hard stop",
    "Hard stop, neighborino",
];

// The terminal label shown when the command is interrupted.
export const interruptionPool:readonly string[] = [
    "Interrupted-aroo",
    "Well, heck — interrupted",
    "Interrupted, neighbor",
    "Stopped short-diddly",
    "Cut off-aroo",
    "Hold the phone — interrupted",
    "Interrupted-diddly",
    "Toodle-oo — interrupted",
    "Interrupted, neighborino",
    "Halted-aroo",
];

// The terminal label shown when the command ends on any other failure.
export const failurePool:readonly string[] = [
    "Aw, fiddlesticks — failed",
    "Dad-gummit — failed",
    "Failed, neighbor",
    "Failed-aroo",
    "Gosh-darn it — failed",
    "Heavens to Betsy — failed",
    "Failed-diddly",
    "Well, shucks — failed",
    "That's a no-go — failed",
    "Failed, neighborino",
];

// The message printed when every task in the plan was already complete at startup.
export const tasksCompletedPool:readonly string[] = [
    "tasks completed — nothin' to do-diddly-do, neighbor!",
    "all done already, neighbor — okely-dokely!",
    "nothin' left to do here, neighbor!",
    "tasks completed — already shipshape, neighborino!",
    "nothin' to do-diddly-do — all set, neighbor!",
    "tasks completed — couldn't be tidier, neighbor!",
    "all squared away already — okely-dokely!",
    "nothin' doin' here — all done, neighbor!",
    "tasks completed — easy-peasy, neighborino!",
    "all wrapped up already, neighbor — toodle-oo!",
];

// The message printed when every remaining task was implemented and accepted during the run.
export const allTasksCompletedPool:readonly string[] = [
    "all tasks completed — okely-dokely-doo, neighbor!",
    "all tasks completed — hi-diddly-done, neighbor!",
    "every last task done-diddly-done, neighbor!",
    "all tasks completed — that's a wrap, neighborino!",
    "all tasks completed — mission accomplished-diddly!",
    "all tasks done and dusted, neighbor — okely-dokely!",
    "all tasks completed — nailed it-aroo, neighbor!",
    "every task done-diddly-done — toodle-oo, neighbor!",
    "all tasks completed — what a humdinger, neighbor!",
    "all tasks completed — done and done, neighborino!",
];

// Lookup from each terminal outcome key to its pool. Keyed by the literal
// outcome strings so this module stays independent of the UI layer that also
// names them; consumers indexing with their own outcome union resolve fine
// because the key literals match.
export const terminalPools = {
    "Done": successPool,
    "Hard stop": hardStopPool,
    "Interrupted": interruptionPool,
    "Failed": failurePool,
} satisfies Record<string, readonly string[]>;

// Picks one entry from a pool through the injected RandomContext. When `exclude`
// is given and the pool has more than one entry, the result is drawn from the
// remaining entries so it is never the excluded one; a single-entry pool always
// returns its sole entry.
export function pickVariant(pool:readonly string[], random:RandomContext, exclude?:string):string {
    const candidates = exclude !== undefined && pool.length > 1
        ? pool.filter(variant => variant !== exclude)
        : pool;
    const index = Math.floor(random.random() * candidates.length);
    return candidates[index]!;
}
