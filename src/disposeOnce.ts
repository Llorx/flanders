export function disposeOnce(tearDown:() => Promise<void>):() => Promise<void> {
    let inFlight:Promise<void>|null = null;
    return () => {
        if (inFlight === null) {
            inFlight = tearDown();
        }
        return inFlight;
    };
}
