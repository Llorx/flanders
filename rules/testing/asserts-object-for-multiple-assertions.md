# Multiple assertions go in an `ASSERTS` object

When a test verifies more than one fact about the operation under test, those checks must be split into named entries under the library's `ASSERTS` object — never collapsed into a single `ASSERT` block that runs several `Assert.*` calls in a row.

The default mental model is: **two or more `Assert.*` calls ⇒ `ASSERTS`**. The single-block `ASSERT` form is reserved for the cases described below.

## Why `ASSERTS` and not a stacked `ASSERT`

The `arrange-act-assert` runner reports each entry under `ASSERTS` as its own pass/fail line and counts them individually in the summary. A test with five checks stacked inside one `ASSERT` block fails on the first mismatch and hides the other four; the same five checks expressed as five `ASSERTS` entries report all five outcomes on every run. The shape of the file is also self-documenting — the key of each `ASSERTS` entry names the expectation in plain English.

## The form

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

## When multiple `Assert.*` calls may share one block or entry

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

## Failure signals

- An `ASSERT` block or an `ASSERTS` entry contains two or more `Assert.*` calls that operate on independent facts (e.g., a return value and an unrelated side effect, or two unrelated fields of the result) instead of being split into one entry per fact.
- A test concatenates several unrelated checks with `&&` or sequential `Assert.ok(...)` calls to keep them inside a single `ASSERT` or a single `ASSERTS` entry.
- The name of an `ASSERTS` entry describes several expectations at once ("returns the seat and deducts the fee and registers the player") — that is one entry doing the work of three.
- A `_result` argument is destructured into multiple unrelated property checks inside one `ASSERTS` entry instead of being split entry-by-entry.
