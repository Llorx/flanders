// Adapter streams and fake timers resume across `setImmediate` turns outside the fake clock.
const SETTLE_ROUNDS = 20;

export async function settleAsyncWork(rounds = SETTLE_ROUNDS):Promise<void> {
    for (let i = 0; i < rounds; i++) {
        await new Promise<void>(resolve => setImmediate(resolve));
    }
}
