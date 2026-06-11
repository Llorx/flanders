import type { TimeContext } from "../contexts";

export function wait(durationMs:number, chunkMs:number, time:TimeContext, signal:AbortSignal):Promise<void> {
    return new Promise<void>(resolve => {
        if (signal.aborted) {
            return resolve();
        }
        const start = time.now();
        let currentHandle:ReturnType<TimeContext["setTimeout"]>|null = null;
        const done = () => {
            signal.removeEventListener("abort", onAbort);
            currentHandle = null;
            resolve();
        };
        const onAbort = () => {
            currentHandle?.cancel();
            done();
        };
        const tick = () => {
            /* coverage ignore next 3 */ // — Defensive: onAbort cancels the timer before tick re-enters; unreachable in single-threaded JS.
            if (signal.aborted) {
                return done();
            }
            const elapsed = time.now() - start;
            const remaining = durationMs - elapsed;
            if (remaining <= 0) {
                return done();
            }
            const chunk = Math.min(remaining, chunkMs);
            currentHandle = time.setTimeout(tick, chunk);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        tick();
    });
}
