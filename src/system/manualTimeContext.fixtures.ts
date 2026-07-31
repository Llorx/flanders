import type { TimeContext, TimeoutHandle } from "../contexts";

export function manualTimeContext(initialNow = 0) {
    let now = initialNow;
    const timers:Array<{ at:number; cb:() => void; cancelled:boolean }> = [];
    const durations:number[] = [];
    return {
        $durations: durations,
        $advance(ms:number) {
            now += ms;
            for (const timer of timers.slice()) {
                if (!timer.cancelled && timer.at <= now) {
                    timer.cancelled = true;
                    timer.cb();
                }
            }
        },
        $pendingTimerCount() {
            return timers.filter(timer => !timer.cancelled).length;
        },
        ...({
            now() { return now; },
            setTimeout(handler:() => void, ms:number):TimeoutHandle {
                durations.push(ms);
                const timer = { at: now + ms, cb: handler, cancelled: false };
                timers.push(timer);
                return { cancel() { timer.cancelled = true; } };
            }
        } satisfies TimeContext)
    };
}
