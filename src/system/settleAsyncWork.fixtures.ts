// Adapter streams and fake timers resume across `setImmediate` turns outside the fake clock.
const SETTLE_ROUNDS = 20;

export async function settleAsyncWork():Promise<void> {
    for (let i = 0; i < SETTLE_ROUNDS; i++) {
        await new Promise<void>(resolve => setImmediate(resolve));
    }
}
