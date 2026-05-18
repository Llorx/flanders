# Tests must reach 100% coverage

The project targets **100% line and branch coverage** on every file under `src/` that is not itself a test file. The target is a hard floor, not an aspiration: a change that lowers coverage is a change that has to be revisited before it is considered done.

## How to verify coverage

Run:

```
npm test -- --coverage --summary
```

This invokes the project's `test` script (which builds the debug output and then runs `npx aaa`) and forwards `--coverage --summary` to the `aaa` runner. `--coverage` makes the runner print per-file line and branch percentages; everything that is not explicitly ignored (see below) must report 100%. `--summary` suppresses the per-test live tree so the runner emits only the final summary block, the coverage table, and — when any test fails — the path and assertion error of each failure. That is the exact shape downstream tooling (and you as a worker reading the output) need; running without `--summary` produces a noisy tree that has to be filtered away.

`node_modules` and test files (`*.test.*`) are excluded by the runner by default — no extra configuration is needed for those.

## When 100% is genuinely unreachable

Some lines cannot be covered by an in-process test even in principle — typically because exercising them would require reaching past the project's context interfaces (see `external-access-through-contexts.md`) into real I/O, real time, or real platform behavior. In those narrow cases, the uncovered region is marked with the runner's coverage-ignore comments **and** carries an inline reason:

```ts
/* coverage ignore next 2 */ // Unreachable: TypeScript narrows the switch above, this guards the impossible default.
throw new Error("unreachable");
```

The supported forms are:

- `/* coverage ignore next */` — ignore the single line that follows the comment.
- `/* coverage ignore next N */` — ignore the next `N` lines.
- `/* coverage disable */` … `/* coverage enable */` — ignore everything between the two markers. Use this form only when several adjacent lines must be skipped together.

The line carrying the `/* coverage ignore ... */` comment is itself counted as normal — only the lines it covers are excluded.

## What does and does not justify an ignore

An ignore is acceptable for:

- Defensive `throw` / `return` branches that exist purely to satisfy the type system (exhaustive `switch` defaults, narrowing guards on values that cannot occur at runtime given the call sites).
- A thin wrapper around a Node built-in inside a context implementation, where the wrapper has no logic of its own and the built-in is what would need stubbing.
- A bootstrap entry file (`src/cli.ts` or equivalent) whose only job is to instantiate the production contexts and hand them to the application — provided every behavioral branch lives in a class that **is** covered.

An ignore is **not** acceptable for:

- Code that is hard to test because the class reaches for a global, a Node built-in, or a concrete dependency directly. The fix is to introduce or extend a context interface (see `external-access-through-contexts.md`) and test the class against a stub — not to ignore the lines.
- Error branches in business logic ("this should never happen") that the test suite simply did not bother to exercise. If the branch exists, it has to be tested.
- Whole functions, classes, or files marked with `/* coverage disable */` to make a coverage report green.

Every ignore comment must carry a reason directly next to it (on the same line, in a `//` comment). A reviewer must be able to tell, without leaving the file, why the lines were excluded.

## Failure signals

- `npm test -- --coverage --summary` reports any covered file below 100% lines or branches.
- A `/* coverage ignore ... */` comment appears with no adjacent reason.
- An ignore is used to skip business logic rather than a genuinely unreachable defensive branch or an I/O wrapper inside a context implementation.
- A class is covered only because its tests exercise real Node built-ins (real `setTimeout`, real `fs`, etc.) instead of stubs wired through a context interface.
- Whole files appear in the coverage report at 0% because they are not imported by any test.
