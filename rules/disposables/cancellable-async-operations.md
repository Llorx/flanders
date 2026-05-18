# Cancellable async operations

Any asynchronous operation whose lifetime can outlive the synchronous call that started it must be cancellable through an `AbortController`. The owner that runs the operation tracks the controller, aborts it on `dispose()` (and on any other event that should cancel the operation), and the operation itself follows the shape described below so abort is honored deterministically.

## Tracking controllers

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

## Shape of a cancellable async function

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

## Reverting side effects on abort

When a cancellable async function performs a **side effect** (writes to a database, deducts a balance, mutates external state), the abort path must either:

- Revert the side effect inline before rejecting, **or**
- Resolve with a revert callback that the caller invokes when its overall operation later fails or is itself aborted.

The signal must not be passed verbatim to a downstream operation whose revert behavior on abort is unknown — instead, the function manages reversion itself.

## Post-await abort recheck

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

## Failure signals

- An async operation accepts no `AbortSignal` (or accepts one but ignores it).
- An owner runs cancellable operations without tracking their controllers.
- An owner's `dispose()` does not abort outstanding controllers.
- A cancellable async function leaves its `abort` listener registered after resolving / rejecting.
- A cancellable async function reacts to `abort` after it has already settled.
- A side-effecting cancellable function aborts without reverting (or returning a way to revert) its side effect.
- A multi-step async operation commits its result without re-checking the abort signal after its last `await`.
