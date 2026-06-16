# Disposable resource rules

## Async resources have a disposable owner

Every asynchronous resource — timers (`setTimeout` / `setInterval`), event listeners, `AbortController`s, open connections, in-flight requests, child processes, file descriptors — must belong to an owner object that exposes a `dispose()` method. Whoever creates the owner is responsible for calling `dispose()` when the owner is no longer needed.

### What counts as a resource

Anything whose lifetime extends beyond the synchronous call that produced it: a `setTimeout` whose callback may still fire, a listener wired to an `EventEmitter`, an `AbortController` linked to a pending operation, a network or database connection, a child process, an open file. Pure values (numbers, strings, plain data records) are not resources and need no disposal.

### Ownership rules

- A class (or structured object) that creates a resource holds it — typically as a private field — and tears it down inside its own `dispose()`.
- A composite owner that manages child owners disposes each of them from its own `dispose()`. Composition cascades; children are not orphaned when the parent goes away.
- An owner disposes **only resources it created**. Dependencies received from the outside (constructor parameters, factory inputs, context objects) belong to whoever passed them in and must not be disposed by the receiver.
- Resources are disposed in the **reverse order of creation**. A consumer is always disposed before the dependency it consumes, so no in-flight cleanup ever reaches into an already-torn-down resource. For example, a database connection injected into a manager is closed after the manager has disposed everything that may still touch it.

### Example

```ts
class Worker {
    private _timer:ReturnType<typeof setTimeout>|null = null;

    start() {
        this._timer = setTimeout(() => { /* ... */ }, 1_000);
    }

    dispose() {
        if (this._timer != null) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    }
}

class WorkerPool {
    private _workers:Worker[] = [];

    add() {
        const w = new Worker();
        this._workers.push(w);
        w.start();
    }

    dispose() {
        for (const w of this._workers) w.dispose();
        this._workers.length = 0;
    }
}

// The caller that created the pool is the one responsible for disposing it.
const pool = new WorkerPool();
try {
    pool.add();
    // ...
} finally {
    pool.dispose();
}
```

### Failure signals

- A class creates a timer / listener / controller / connection but exposes no `dispose()` (or equivalent teardown method).
- A `dispose()` exists but ignores some of the resources the class created.
- A composite owner's `dispose()` does not iterate its children.
- A class calls `dispose()` on a value it received from its caller instead of leaving it to the caller.
- A teardown sequence closes a shared dependency before disposing the components that still use it.

## Dispose semantics

`dispose()` is the single entry point through which an owner releases its resources. The points below describe what `dispose()` must guarantee on top of the ownership rules (see [src/.spec/rules/disposables.md#async-resources-have-a-disposable-owner](/src/.spec/rules/disposables.md#async-resources-have-a-disposable-owner)) and the cancellation contract (see [src/.spec/rules/disposables.md#cancellable-async-operations](/src/.spec/rules/disposables.md#cancellable-async-operations)).

### Async dispose

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

### Tracking in-flight operations

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

### Remove from the registry before disposing

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

### Disposed flag for unreachable references

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

### Failure signals

- A `dispose()` that awaits in-flight work uses `Promise.all` and so swallows or short-circuits on the first rejection.
- An owner aborts its controllers on `dispose()` but does not await the in-flight promises they belonged to.
- A child is `dispose()`d while it is still reachable through its parent's registry.
- A resource that may be referenced from outside has no `_disposed` flag and continues to accept method calls after teardown has started.
- `dispose()` is not idempotent — calling it twice runs cleanup twice.

## Cancellable async operations

Any asynchronous operation whose lifetime can outlive the synchronous call that started it must be cancellable through an `AbortController`. The owner that runs the operation tracks the controller, aborts it on `dispose()` (and on any other event that should cancel the operation), and the operation itself follows the shape described below so abort is honored deterministically.

### Tracking controllers

- The owner stores its in-flight `AbortController`s in a `Set` (when only disposal needs to cancel them) or in a `Map` keyed by an external identifier (when an outside event must cancel a specific operation — e.g., a player leaving cancels that player's pending join).
- The controller is added to the collection before the operation is awaited and removed in a `finally` block so cancelled, settled, and thrown paths all clean up.
- On `dispose()`, every controller in the collection is aborted before any further teardown runs.

```ts
class Joiner {
    private _controllers = new Map<string, AbortController>();

    async join(playerId:string) {
        const controller = new AbortController();
        this._controllers.set(playerId, controller);
        try {
            await this._doJoin(playerId, controller.signal);
        } finally {
            this._controllers.delete(playerId);
        }
    }

    cancel(playerId:string) {
        this._controllers.get(playerId)?.abort();
    }

    dispose() {
        for (const c of this._controllers.values()) c.abort();
        this._controllers.clear();
    }

    private async _doJoin(_playerId:string, _signal:AbortSignal):Promise<void> { /* ... */ }
}
```

### Shape of a cancellable async function

A function that accepts an `AbortSignal` must:

1. Check `signal.aborted` before starting any work and reject immediately if it is already set.
2. Register an `abort` listener that rejects the returned promise.
3. Remove that listener on the normal resolve / reject paths to avoid leaking it.
4. **Not** react to the `abort` event once the promise has already settled — the settlement (resolve or reject) is the final outcome.

```ts
function delay(ms:number, signal:AbortSignal):Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const onAbort = () => reject(new Error("aborted"));
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort);
        setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
    });
}
```

### Reverting side effects on abort

When a cancellable async function performs a **side effect** (writes to a database, deducts a balance, mutates external state), the abort path must either:

- Revert the side effect inline before rejecting, **or**
- Resolve with a revert callback that the caller invokes when its overall operation later fails or is itself aborted.

The signal must not be passed verbatim to a downstream operation whose revert behavior on abort is unknown — instead, the function manages reversion itself.

### Post-await abort recheck

Because `resolve` / `reject` settle through the microtask queue, an `abort` event can be observed *after* the operation has technically completed. After every `await` in a multi-step operation, the caller must re-check `controller.signal.aborted` (or equivalent) before committing the result. If the signal was aborted, the caller throws and runs the same revert path it would run on any other failure.

```ts
async function joinMatch(playerId:string, controller:AbortController) {
    const refund = await deductFee(playerId, controller.signal);
    try {
        await registerPlayer(playerId, controller.signal);
        if (controller.signal.aborted) throw new Error("aborted");
        commit(playerId);
    } catch (e) {
        await refund();
        throw e;
    }
}
```

### Failure signals

- An async operation accepts no `AbortSignal` (or accepts one but ignores it).
- An owner runs cancellable operations without tracking their controllers.
- An owner's `dispose()` does not abort outstanding controllers.
- A cancellable async function leaves its `abort` listener registered after resolving / rejecting.
- A cancellable async function reacts to `abort` after it has already settled.
- A side-effecting cancellable function aborts without reverting (or returning a way to revert) its side effect.
- A multi-step async operation commits its result without re-checking the abort signal after its last `await`.
