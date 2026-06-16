# Testing rules

## Tests use `arrange-act-assert` with named AAA sections

The project's only test framework is the [`arrange-act-assert`](https://www.npmjs.com/package/arrange-act-assert) library (already a `devDependency`). Every test file imports `test` from it and writes each test case as a `test()` call whose body is an object literal with the named sections `ARRANGE`, `ACT`, and `ASSERT` (or `ASSERTS` — see [src/.spec/rules/testing.md#multiple-assertions-go-in-an-asserts-object](/src/.spec/rules/testing.md#multiple-assertions-go-in-an-asserts-object)).

No other runner (`node --test`, `jest`, `vitest`, `mocha`, raw `assert` scripts, ad-hoc `if` blocks) may be added to the project.

### Running the tests

The canonical invocation when an AI worker (or any caller that consumes the output programmatically) needs to run the suite is `npm test -- --summary` (or `npx aaa --summary` to skip the build step). With `--summary` the runner emits only the final summary block plus, for any failing tests, the test path and the assertion error — and preserves the exit code as always. That is exactly the information needed to decide pass/fail and to act on failures; running without `--summary` produces a verbose per-test tree that has to be filtered away. Combine with `--coverage-target 100` (`npm test -- --coverage-target 100 --summary`) when the 100% coverage floor must also be enforced — the runner exits non-zero on a shortfall, so the threshold check is automatic. See [src/.spec/rules/testing.md#tests-must-reach-100-coverage](/src/.spec/rules/testing.md#tests-must-reach-100-coverage). Plain `npm test` / `npx aaa` (without `--summary`) is reserved for interactive use where the per-test tree is the whole point.

### Shape of a test

```ts
import * as Assert from "assert";

import test from "arrange-act-assert";

import { thing } from "./thing";

test.describe("thing", test => {
    test("returns the value the producer gave it", {
        ARRANGE() {
            const input = 42;
            return { input };
        },
        ACT({ input }) {
            return thing(input);
        },
        ASSERT(result, { input }) {
            Assert.strictEqual(result, input);
        }
    });
});
```

Notes on the shape:

- `ARRANGE` builds and returns every piece of state the rest of the test needs. The same object is destructured into `ACT` and `ASSERT(S)`.
- `ACT` performs the single operation under test and returns its result (sync or async). Tests that exercise an operation expected to throw wrap the call in `monad(...)` and return the monad from `ACT`, then call `res.should.error(...)` from the assertion.
- `ASSERT` (or `ASSERTS`) is where every check happens. Putting `Assert.*` calls inside `ARRANGE` or `ACT` is not allowed — those sections describe the setup and the operation, not its verification.

### Grouping with `describe`

When several tests share a subject, group them with `test.describe("<subject>", test => { ... })`. Nested describes are allowed when the subject naturally has sub-areas. A test file with a single subject may also call `test("...", { ... })` at the top level without a describe.

### Failure signals

- A test file imports a runner other than `arrange-act-assert`, or runs assertions outside a `test()` call.
- A test case is written as a bare function (`test("name", () => { ... })`) without the `{ ARRANGE, ACT, ASSERT }` object form.
- `Assert.*` calls appear inside `ARRANGE` or `ACT`.
- `ACT` performs more than one logical operation (e.g., calls two unrelated methods on the subject), making it impossible to identify which one the assertions are about.
- A test file declares its own bespoke assertion harness instead of using the library's structure.

## Multiple assertions go in an `ASSERTS` object

When a test verifies more than one fact about the operation under test, those checks must be split into named entries under the library's `ASSERTS` object — never collapsed into a single `ASSERT` block that runs several `Assert.*` calls in a row.

The default mental model is: **two or more `Assert.*` calls ⇒ `ASSERTS`**. The single-block `ASSERT` form is reserved for the cases described below.

### Why `ASSERTS` and not a stacked `ASSERT`

The `arrange-act-assert` runner reports each entry under `ASSERTS` as its own pass/fail line and counts them individually in the summary. A test with five checks stacked inside one `ASSERT` block fails on the first mismatch and hides the other four; the same five checks expressed as five `ASSERTS` entries report all five outcomes on every run. The shape of the file is also self-documenting — the key of each `ASSERTS` entry names the expectation in plain English.

### The form

```ts
test("joining a match charges the entry fee and adds the player", {
    ARRANGE() {
        const match = buildMatch();
        return { match };
    },
    async ACT({ match }) {
        return await match.join("p1");
    },
    ASSERTS: {
        "returns the player's seat index"(result) {
            Assert.strictEqual(result.seat, 0);
        },
        "deducts the entry fee from the player's balance"(_result, { match }) {
            Assert.strictEqual(match.balanceOf("p1"), 90);
        },
        "registers the player as a participant"(_result, { match }) {
            Assert.deepStrictEqual(match.participants(), ["p1"]);
        }
    }
});
```

Each key is the human-readable expectation; each value is a function that runs **exactly the assertions for that expectation**. Argument shape mirrors `ASSERT`: the first argument is the `ACT` result, the second is the `ARRANGE` return.

### When multiple `Assert.*` calls may share one block or entry

The "one assertion call per block" guideline applies at the level of **independent facts**, not at the level of `Assert.*` syntax. Several `Assert.*` calls may sit inside a single `ASSERT` block — or inside a single entry of an `ASSERTS` object — when they form a **dependent chain** that cannot be split without losing meaning. The same rule governs both cases:

1. **Type narrowing** — an earlier `Assert.*` proves the value has a shape that a later assertion needs in order to compile or to be safely indexed.

   ```ts
   ASSERT(result) {
       Assert.ok(result.kind === "success");   // narrows result to the success variant
       Assert.strictEqual(result.value, 42);   // only valid after the narrowing above
   }
   ```

2. **State produced by the assertion itself** — checking the first fact mutates or consumes something (e.g., reads from an iterator, drains a queue, calls `after()` to advance state) that the next fact depends on.

   ```ts
   ASSERT(iterator) {
       Assert.deepStrictEqual(iterator.next(), { value: 1, done: false });
       Assert.deepStrictEqual(iterator.next(), { value: 2, done: false });
       Assert.deepStrictEqual(iterator.next(), { value: undefined, done: true });
   }
   ```

The same chain rule lifts directly into `ASSERTS` entries. An entry that verifies a single fact may contain multiple `Assert.*` calls when those calls form a dependent chain expressing that one fact:

```ts
ASSERTS: {
    "returns a success result carrying the value"(result) {
        Assert.ok(result.kind === "success");   // narrows the union…
        Assert.strictEqual(result.value, 42);   // …so this access is safe and on-topic.
    },
    "leaves the input untouched"(_result, { input }) {
        Assert.deepStrictEqual(input, ORIGINAL_INPUT);
    }
}
```

Anywhere else — assertions about different facts, different fields, or different observable consequences — the default applies: **split into separate entries**. Splitting an independent check off into its own entry would make the chain version fail to compile, or would run the assertion against different state than the chain requires; that is the test that distinguishes a legitimate chain from a stack of unrelated checks hiding behind one name.

A `_result` parameter prefix is conventional when the entry only inspects the `ARRANGE` return and does not need the `ACT` value.

### Failure signals

- An `ASSERT` block or an `ASSERTS` entry contains two or more `Assert.*` calls that operate on independent facts (e.g., a return value and an unrelated side effect, or two unrelated fields of the result) instead of being split into one entry per fact.
- A test concatenates several unrelated checks with `&&` or sequential `Assert.ok(...)` calls to keep them inside a single `ASSERT` or a single `ASSERTS` entry.
- The name of an `ASSERTS` entry describes several expectations at once ("returns the seat and deducts the fee and registers the player") — that is one entry doing the work of three.
- A `_result` argument is destructured into multiple unrelated property checks inside one `ASSERTS` entry instead of being split entry-by-entry.

### This rule is a hint, not enforced at review

This rule is advisory: a hint that improves test readability and per-assertion reporting, not a gate. It is **not enforced at review level** — the adversarial reviewer must not raise a violation of it as a FAIL, and the worker is not required to prove compliance with it in its Evidence Report. Apply it where it helps; never let it block a task from completing.

## Tests assert through the public surface, not private state

Tests verify the subject under test by exercising its public surface — return values, callbacks fired, side effects on dependencies, externally observable state — and by asserting on what that surface produces. They must not read or assert on values declared `private` (the TypeScript keyword) or `#privateField` (the JavaScript hash-prefixed syntax). These two encapsulation mechanisms exist because the implementer chose to keep that state out of the contract; a test that pierces them couples itself to internal mechanics that the contract does not promise to preserve.

### Who this applies to

Every test file in `src/` — anywhere a unit, integration, or behavior test sits next to the code under test. The rule governs assertions: it does not restrict what the test's `ARRANGE` may construct, only what the `ASSERT`/`ASSERTS` may inspect.

### The antipattern this rule kills

Asserting on a TypeScript `private` field by casting away its protection:

```ts
// BAD — pierces the TS private modifier via type assertion
Assert.strictEqual(
    (claude as unknown as { _transientAttempt: number })._transientAttempt,
    0
);
```

The cast `as unknown as { _x: T }` is the only way to access a TS `private` from a test, so it is the canonical syntactic signal that the rule is being broken. The same applies to any other cast shape (`<any>`, `as any`, `// @ts-expect-error`, `// @ts-ignore`) used to reach a `private` field, and to any reflection trick used to read a `#privateField`.

The underscore-prefix convention by itself is **not** in scope: an `_field` that is not also `private` (or `#`) is technically part of the public surface in TypeScript, and asserting on it is governed by the same rules as any other public field. This rule bites only when the field carries the `private` modifier or the `#` syntax.

### What to assert instead

Pick the observable consequence that the private state produces and assert on that — not on the state itself. A "counter resets on success" rule is not about a counter being zero; it is about the next failure waiting the initial amount, observable as a spawn that does not happen until the boundary time has elapsed. A test that asserts the boundary behavior verifies the rule directly and survives any refactor of the underlying counter, lookup table, or formula. A test that asserts the counter equals zero passes today and silently breaks tomorrow if the formula moves and the counter no longer maps one-to-one to wait values.

### When the public surface genuinely does not expose the behavior

Sometimes the behavior under test is real and important, but no part of the current public surface lets a test observe it. The correct response is **not** to peek at the private; it is to **widen the public surface** in a deliberate, minimal way:

- Promote the relevant capability into a public method, exported function, observable event, or constructor callback. The widening is shaped by what the test legitimately needs to observe.
- Treat the new public surface as a contract from that moment on: the implementation is free to change, but the public shape and meaning of the new entry are now stable.
- Document the widening at the point of the change with a short comment next to the newly-exposed entry explaining why the preexisting public surface could not carry this observation. The reader of the file must be able to tell, without leaving it, why this method/field/event is part of the public surface despite looking internal.

  ```ts
  /** Public for testing: the transient-backoff schedule is otherwise observable only as the absence of a process spawn for a duration, which is awkward to bound exactly. Production callers do not use this. */
  scheduleNextRetry(now: number, attempt: number): number { ... }
  ```

The widening is the last resort, not the first. The question to answer before widening is: *can a test verify this behavior via the public surface that already exists?* If a careful design of the test (fake time, spy callbacks, observing spawn timing, observing return values) lets the answer come from the existing surface, use that — even if the test is more involved than a private-state peek would have been. Every widening permanently grows the contract the implementation must honor; that is the cost the case-by-case analysis weighs.

### The subject's source text is not the public surface either

The public surface a test may inspect is what the code *does* — values it returns, callbacks it fires, calls it records on injected dependencies, state an observer can see. It is never the subject's own source *as text*. A test must not read the production source file of the subject (or any production source) and assert on its textual content — opening a `.ts` with `readFileSync`, `require('fs')`, or any equivalent and matching it against a pattern to assert that an import is absent, a token does or does not appear, or a count or order of source constructs holds. Such a "test" verifies the source as data rather than exercising behavior; it is the same encapsulation breach as a `private`-state peek, reaching past the behavioral surface into how the code is written.

A structural property of the production source — "imports neither `child_process`, `process`, nor `os`", "does not read `process.platform`", "no direct `console.log` from a class with an output context" — is therefore out of scope for tests entirely. Such a property is review-adjudicated per [src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression](/src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression) (the adversarial reviewer verifies it by reading the change), or toolchain-guarded when the project runs a linter that flags it (for example `no-restricted-imports`). It is never to be guarded by a source-reading test, and a missing source-reading test is never a reason to add one.

### Relationship to other rules

This rule names two antipatterns — the `private`-state peek and the source-text scan — that [src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report](/src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report) and [src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression](/src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression) classify more generally. A test that asserts on internal state typically supports only the trivial regression argument "if I delete the line that resets the counter, the assertion fails"; a source-text scan is the worker reaching for a test where the property is review-adjudicated or linter-guarded. The rules reinforce each other — the classification rule routes structural and semantic properties to the reviewer (or the linter), and this rule names the source-code shapes that try to smuggle them back into the test suite.

### Failure signals

- An `ASSERT`/`ASSERTS` block references a field declared with the TypeScript `private` keyword on the subject under test.
- An `ASSERT`/`ASSERTS` block references a `#privateField` of the subject (via reflection, dynamic property access, or any other workaround).
- A test contains a cast of the form `as unknown as { _x: T }`, `<any>`, `as any`, `// @ts-expect-error`, or `// @ts-ignore` whose purpose is to reach a `private` field.
- A public method, exported function, or event was added to the source under test for the sole purpose of allowing a test assertion, without a brief comment at the point of the change explaining why the preexisting public surface could not carry that observation.
- A test reads a production source file as text — `readFileSync`, `require('fs')`, or any equivalent over a `.ts` — and asserts on its textual content (an import is absent, a token appears or does not, a source-construct count or order holds) instead of leaving that structural property to the linter or the adversarial reviewer.

## Tests must reach 100% coverage

The project targets **100% line and branch coverage** on every file under `src/` that is not itself a test file. The target is a hard floor, not an aspiration: a change that lowers coverage is a change that has to be revisited before it is considered done.

### How to verify coverage

Run:

```
npm test -- --coverage-target 100 --summary
```

This invokes the project's `test` script (which builds the debug output and then runs `npx aaa`) and forwards `--coverage-target 100 --summary` to the `aaa` runner. `--coverage-target 100` implies `--coverage` (so coverage collection is automatic) **and** makes the runner exit non-zero when any covered file reports below 100% line or branch coverage — the threshold is enforced by the test run itself, not by reading the report. `--summary` suppresses the per-test live tree so the runner emits only the final summary block, the coverage table, and — when any test or the coverage check fails — the path and assertion error of each failure. That is the exact shape downstream tooling (and you as a worker reading the output) need; running without `--summary` produces a noisy tree that has to be filtered away.

`node_modules` and test files (`*.test.*`) are excluded by the runner by default — no extra configuration is needed for those.

`--coverage` on its own (without `--coverage-target`) still prints the report but does not fail the run on a shortfall, so it is not sufficient for verifying the 100% floor — use `--coverage-target 100` whenever the goal is to confirm the rule holds.

### When 100% is genuinely unreachable

Some lines cannot be covered by an in-process test even in principle — typically because exercising them would require reaching past the project's context interfaces (see [src/.spec/rules/external-access-through-contexts.md](/src/.spec/rules/external-access-through-contexts.md)) into real I/O, real time, or real platform behavior. In those narrow cases, the uncovered region is marked with the runner's coverage-ignore comments **and** carries an inline reason:

```ts
/* coverage ignore next 2 */ // Unreachable: TypeScript narrows the switch above, this guards the impossible default.
throw new Error("unreachable");
```

The supported forms are:

- `/* coverage ignore next */` — ignore the single line that follows the comment.
- `/* coverage ignore next N */` — ignore the next `N` lines.
- `/* coverage disable */` … `/* coverage enable */` — ignore everything between the two markers. Use this form only when several adjacent lines must be skipped together.

The line carrying the `/* coverage ignore ... */` comment is itself counted as normal — only the lines it covers are excluded.

### What does and does not justify an ignore

An ignore is acceptable for:

- Defensive `throw` / `return` branches that exist purely to satisfy the type system (exhaustive `switch` defaults, narrowing guards on values that cannot occur at runtime given the call sites).
- A thin wrapper around a Node built-in inside a context implementation, where the wrapper has no logic of its own and the built-in is what would need stubbing.
- A bootstrap entry file (`src/cli.ts` or equivalent) whose only job is to instantiate the production contexts and hand them to the application — provided every behavioral branch lives in a class that **is** covered.

An ignore is **not** acceptable for:

- Code that is hard to test because the class reaches for a global, a Node built-in, or a concrete dependency directly. The fix is to introduce or extend a context interface (see [src/.spec/rules/external-access-through-contexts.md](/src/.spec/rules/external-access-through-contexts.md)) and test the class against a stub — not to ignore the lines.
- Error branches in business logic ("this should never happen") that the test suite simply did not bother to exercise. If the branch exists, it has to be tested.
- Whole functions, classes, or files marked with `/* coverage disable */` to make a coverage report green.

Every ignore comment must carry a reason directly next to it (on the same line, in a `//` comment). A reviewer must be able to tell, without leaving the file, why the lines were excluded.

### Failure signals

- `npm test -- --coverage-target 100 --summary` exits non-zero because the runner's own coverage check rejected the run (any covered file below 100% lines or branches).
- A worker verifies coverage with `--coverage` alone and relies on eyeballing the table, instead of letting `--coverage-target 100` enforce the floor automatically.
- A `/* coverage ignore ... */` comment appears with no adjacent reason.
- An ignore is used to skip business logic rather than a genuinely unreachable defensive branch or an I/O wrapper inside a context implementation.
- A class is covered only because its tests exercise real Node built-ins (real `setTimeout`, real `fs`, etc.) instead of stubs wired through a context interface.
- Whole files appear in the coverage report at 0% because they are not imported by any test.

## Terminal-geometry behavior is tested against a headless terminal emulator's rendered grid

A test that verifies how terminal output is **rendered on screen** — the number of physical rows it occupies, line wrapping, what remains after a resize/reflow, cursor position, or the result of a multi-row clear — verifies it by feeding the bytes the code emits into a **headless terminal emulator** and asserting on the emulator's **rendered grid** (the cell/row contents after parsing). It does not rely solely on a string-concatenating fake output that stores the raw bytes, and it does not rely solely on matching the raw escape sequences emitted.

A string-concatenating fake models neither autowrap nor resize-reflow nor cursor motion, so a rendered-geometry claim asserted only against it can pass while the real terminal shows something different (extra rows, stale rows, misaligned content). The rendered grid produced by a terminal emulator from the emitted bytes is the behavioral surface that such a claim is actually about.

The project's headless terminal emulator is **`@xterm/headless`**, declared under `devDependencies`. A test drives it by writing the emitted bytes into the emulator, resizing it through its resize API to exercise reflow, and reading back the rendered rows from its active buffer.

### Who this applies to

- **Subject:** test files under `src/` (`*.test.ts`).
- **Scope:** any test whose correctness claim is about the rendered terminal geometry of a live, terminal-pinned region or of output whose layout depends on the terminal — specifically the bottom-fixed live block (`BottomBlock`) and any other code that draws or clears a multi-line terminal region, moves the cursor, or depends on line wrapping or resize-reflow. A rendered-geometry claim for such code is verified against the emulator's rendered grid.
- **Out of scope:** tests of pure logic and of pure string-formatting (for example, width-fitting a single line to a column count, token/time formatting) that make no claim about the rendered terminal grid. These keep asserting on returned values or captured output directly.

### Relationship to other testing rules

- `arrange-act-assert` remains the only test runner ([src/.spec/rules/testing.md#tests-use-arrange-act-assert-with-named-aaa-sections](/src/.spec/rules/testing.md#tests-use-arrange-act-assert-with-named-aaa-sections)); the emulator is a helper used inside the `ARRANGE`/`ASSERT` sections of an `arrange-act-assert` test, never a second runner.
- The emulator is a development-only dependency, so it does not add a production dependency ([.spec/rules/dependencies/no-production-dependencies.md](/.spec/rules/dependencies/no-production-dependencies.md)).
- Asserting on the emulator's rendered grid is asserting through the behavioral surface, consistent with [src/.spec/rules/testing.md#tests-assert-through-the-public-surface-not-private-state](/src/.spec/rules/testing.md#tests-assert-through-the-public-surface-not-private-state): the grid is computed from the bytes the code emits, not from its private state or its source text. Asserting the exact emitted control sequences against a captured-output fake remains permitted and complementary; this rule binds only the rendered-geometry claim, which must additionally be confirmed against the emulator grid.

### Failure signals

- A test asserts "the block stays N rows after a resize", "the line wraps / does not wrap", "no stale row remains", or "the cursor lands here" by inspecting a concatenated string of emitted bytes instead of an emulator-rendered grid.
- A rendered-geometry regression ships green because the only resize/wrapping test runs against a fake that cannot wrap or reflow.
- A test reaches for a terminal emulator other than the project's declared one, or adds the emulator under production `dependencies` rather than `devDependencies`.
