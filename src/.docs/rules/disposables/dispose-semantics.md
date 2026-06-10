# Dispose semantics

`dispose()` is the single entry point through which an owner releases its resources. The points below describe what `dispose()` must guarantee on top of the ownership rules (see `ownership-and-lifecycle.md`) and the cancellation contract (see `cancellable-async-operations.md`).

## Async dispose

`dispose()` may be asynchronous. When cleanup involves awaiting child disposals or in-flight promises, `dispose()` returns a `Promise` that resolves only after every managed resource is fully cleaned up. Callers `await` it.

```ts
async dispose() {
    for (const c of this._controllers) c.abort();
    this._controllers.clear();
    await Promise.allSettled(this._promises);
    for (const child of this._children) await child.dispose();
}
```

`Promise.allSettled` is preferred over `Promise.all` when awaiting in-flight work, because `dispose()` must complete even when individual operations reject — most of them just got aborted and will reject by design.

## Tracking in-flight operations

When an owner runs an async operation whose body must complete (or be observed completing) before disposal continues, the owner stores the operation's promise in a `Set` and removes it in a `finally`. `dispose()` aborts the operation's controller and then awaits the promise set so it does not return while a method on the owner is still running.

```ts
async run() {
    const p = (async () => {
        // ... composite async work
    })();
    this._promises.add(p);
    try {
        await p;
    } finally {
        this._promises.delete(p);
    }
}

async dispose() {
    for (const c of this._controllers) c.abort();
    await Promise.allSettled(this._promises);
}
```

## Remove from the registry before disposing

When deleting a child from a parent collection, remove it from the collection **first**, then call `dispose()`. Doing so guarantees that no concurrent lookup can hand the child to a new caller while it is being torn down.

```ts
async deleteMatch(matchId:string) {
    const match = this._matches.get(matchId);
    if (!match) return;
    this._matches.delete(matchId);   // first: nobody else can reach it
    const p = match.dispose();       // then: tear it down
    this._promises.add(p);
    try {
        await p;
    } finally {
        this._promises.delete(p);
    }
}
```

## Disposed flag for unreachable references

When an owner cannot guarantee that every reference to a resource is gone — because the reference lives inside a third-party library, a long-lived callback, an external map the owner does not control, etc. — the resource must:

1. Carry a private `_disposed` flag.
2. Set the flag at the very start of `dispose()` so that subsequent method entries see it.
3. Check the flag at the entry of every public method and refuse to operate (throw, return early, or otherwise no-op) when it is set.
4. Make `dispose()` itself idempotent — calling it after the flag is set must return immediately without running cleanup twice.

```ts
class Match {
    private _disposed = false;

    async join(playerId:string) {
        if (this._disposed) throw new Error("Match disposed");
        // ...
    }

    async dispose() {
        if (this._disposed) return;
        this._disposed = true;
        // ... cleanup
    }
}
```

## Failure signals

- A `dispose()` that awaits in-flight work uses `Promise.all` and so swallows or short-circuits on the first rejection.
- An owner aborts its controllers on `dispose()` but does not await the in-flight promises they belonged to.
- A child is `dispose()`d while it is still reachable through its parent's registry.
- A resource that may be referenced from outside has no `_disposed` flag and continues to accept method calls after teardown has started.
- `dispose()` is not idempotent — calling it twice runs cleanup twice.
