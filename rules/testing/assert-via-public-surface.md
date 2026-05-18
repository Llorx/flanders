# Tests assert through the public surface, not private state

Tests verify the subject under test by exercising its public surface — return values, callbacks fired, side effects on dependencies, externally observable state — and by asserting on what that surface produces. They must not read or assert on values declared `private` (the TypeScript keyword) or `#privateField` (the JavaScript hash-prefixed syntax). These two encapsulation mechanisms exist because the implementer chose to keep that state out of the contract; a test that pierces them couples itself to internal mechanics that the contract does not promise to preserve.

## Who this applies to

Every test file in `src/` — anywhere a unit, integration, or behavior test sits next to the code under test. The rule governs assertions: it does not restrict what the test's `ARRANGE` may construct, only what the `ASSERT`/`ASSERTS` may inspect.

## The antipattern this rule kills

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

## What to assert instead

Pick the observable consequence that the private state produces and assert on that — not on the state itself. A "counter resets on success" rule is not about a counter being zero; it is about the next failure waiting the initial amount, observable as a spawn that does not happen until the boundary time has elapsed. A test that asserts the boundary behavior verifies the rule directly and survives any refactor of the underlying counter, lookup table, or formula. A test that asserts the counter equals zero passes today and silently breaks tomorrow if the formula moves and the counter no longer maps one-to-one to wait values.

## When the public surface genuinely does not expose the behavior

Sometimes the behavior under test is real and important, but no part of the current public surface lets a test observe it. The correct response is **not** to peek at the private; it is to **widen the public surface** in a deliberate, minimal way:

- Promote the relevant capability into a public method, exported function, observable event, or constructor callback. The widening is shaped by what the test legitimately needs to observe.
- Treat the new public surface as a contract from that moment on: the implementation is free to change, but the public shape and meaning of the new entry are now stable.
- Document the widening at the point of the change with a short comment next to the newly-exposed entry explaining why the preexisting public surface could not carry this observation. The reader of the file must be able to tell, without leaving it, why this method/field/event is part of the public surface despite looking internal.

  ```ts
  /** Public for testing: the transient-backoff schedule is otherwise observable only as the absence of a process spawn for a duration, which is awkward to bound exactly. Production callers do not use this. */
  scheduleNextRetry(now: number, attempt: number): number { ... }
  ```

The widening is the last resort, not the first. The question to answer before widening is: *can a test verify this behavior via the public surface that already exists?* If a careful design of the test (fake time, spy callbacks, observing spawn timing, observing return values) lets the answer come from the existing surface, use that — even if the test is more involved than a private-state peek would have been. Every widening permanently grows the contract the implementation must honor; that is the cost the case-by-case analysis weighs.

## Relationship to other rules

This rule names a specific antipattern (`private`-state peek) that `rules/ai/agents/evidence-report.md` already classifies more generally as a regression-argument weakness: a test that asserts on internal state typically supports only the trivial regression argument "if I delete the line that resets the counter, the assertion fails". The two rules reinforce each other — the Evidence Report rule requires a sound regression argument; this rule names the source-code shape that almost always produces an unsound one.

## Failure signals

- An `ASSERT`/`ASSERTS` block references a field declared with the TypeScript `private` keyword on the subject under test.
- An `ASSERT`/`ASSERTS` block references a `#privateField` of the subject (via reflection, dynamic property access, or any other workaround).
- A test contains a cast of the form `as unknown as { _x: T }`, `<any>`, `as any`, `// @ts-expect-error`, or `// @ts-ignore` whose purpose is to reach a `private` field.
- A public method, exported function, or event was added to the source under test for the sole purpose of allowing a test assertion, without a brief comment at the point of the change explaining why the preexisting public surface could not carry that observation.
