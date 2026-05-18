# Async resources have a disposable owner

Every asynchronous resource — timers (`setTimeout` / `setInterval`), event listeners, `AbortController`s, open connections, in-flight requests, child processes, file descriptors — must belong to an owner object that exposes a `dispose()` method. Whoever creates the owner is responsible for calling `dispose()` when the owner is no longer needed.

## What counts as a resource

Anything whose lifetime extends beyond the synchronous call that produced it: a `setTimeout` whose callback may still fire, a listener wired to an `EventEmitter`, an `AbortController` linked to a pending operation, a network or database connection, a child process, an open file. Pure values (numbers, strings, plain data records) are not resources and need no disposal.

## Ownership rules

- A class (or structured object) that creates a resource holds it — typically as a private field — and tears it down inside its own `dispose()`.
- A composite owner that manages child owners disposes each of them from its own `dispose()`. Composition cascades; children are not orphaned when the parent goes away.
- An owner disposes **only resources it created**. Dependencies received from the outside (constructor parameters, factory inputs, context objects) belong to whoever passed them in and must not be disposed by the receiver.
- Resources are disposed in the **reverse order of creation**. A consumer is always disposed before the dependency it consumes, so no in-flight cleanup ever reaches into an already-torn-down resource. For example, a database connection injected into a manager is closed after the manager has disposed everything that may still touch it.

## Example

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

## Failure signals

- A class creates a timer / listener / controller / connection but exposes no `dispose()` (or equivalent teardown method).
- A `dispose()` exists but ignores some of the resources the class created.
- A composite owner's `dispose()` does not iterate its children.
- A class calls `dispose()` on a value it received from its caller instead of leaving it to the caller.
- A teardown sequence closes a shared dependency before disposing the components that still use it.
