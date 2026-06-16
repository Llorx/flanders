# Tests use `arrange-act-assert` with named AAA sections

The project's only test framework is the [`arrange-act-assert`](https://www.npmjs.com/package/arrange-act-assert) library (already a `devDependency`). Every test file imports `test` from it and writes each test case as a `test()` call whose body is an object literal with the named sections `ARRANGE`, `ACT`, and `ASSERT` (or `ASSERTS` — see [src/.spec/rules/testing/asserts-object-for-multiple-assertions.md](/src/.spec/rules/testing/asserts-object-for-multiple-assertions.md)).

No other runner (`node --test`, `jest`, `vitest`, `mocha`, raw `assert` scripts, ad-hoc `if` blocks) may be added to the project.

## Running the tests

The canonical invocation when an AI worker (or any caller that consumes the output programmatically) needs to run the suite is `npm test -- --summary` (or `npx aaa --summary` to skip the build step). With `--summary` the runner emits only the final summary block plus, for any failing tests, the test path and the assertion error — and preserves the exit code as always. That is exactly the information needed to decide pass/fail and to act on failures; running without `--summary` produces a verbose per-test tree that has to be filtered away. Combine with `--coverage-target 100` (`npm test -- --coverage-target 100 --summary`) when the 100% coverage floor must also be enforced — the runner exits non-zero on a shortfall, so the threshold check is automatic. See [src/.spec/rules/testing/coverage-target.md](/src/.spec/rules/testing/coverage-target.md). Plain `npm test` / `npx aaa` (without `--summary`) is reserved for interactive use where the per-test tree is the whole point.

## Shape of a test

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

## Grouping with `describe`

When several tests share a subject, group them with `test.describe("<subject>", test => { ... })`. Nested describes are allowed when the subject naturally has sub-areas. A test file with a single subject may also call `test("...", { ... })` at the top level without a describe.

## Failure signals

- A test file imports a runner other than `arrange-act-assert`, or runs assertions outside a `test()` call.
- A test case is written as a bare function (`test("name", () => { ... })`) without the `{ ARRANGE, ACT, ASSERT }` object form.
- `Assert.*` calls appear inside `ARRANGE` or `ACT`.
- `ACT` performs more than one logical operation (e.g., calls two unrelated methods on the subject), making it impossible to identify which one the assertions are about.
- A test file declares its own bespoke assertion harness instead of using the library's structure.
