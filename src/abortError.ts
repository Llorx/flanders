const ABORT_ERROR_NAME = "AbortError";

// A prompt's abort comes from one of two ends — the user releasing the input it waits on, or the
// prompt's owner cancelling it during teardown — and at a real Ctrl+C both fire in the same turn,
// so afterwards the signals no longer tell them apart. `inputReleased` records which end it was.
export type AbortError = Error & { inputReleased?:true };

export function abortError(options?:Readonly<{ inputReleased?:boolean }>):AbortError {
    const e:AbortError = new Error("aborted");
    e.name = ABORT_ERROR_NAME;
    if (options?.inputReleased) {
        e.inputReleased = true;
    }
    return e;
}

export function isAbortError(e:unknown):e is AbortError {
    return e instanceof Error && e.name === ABORT_ERROR_NAME;
}

export function isInputReleasedError(e:unknown):boolean {
    return isAbortError(e) && e.inputReleased === true;
}
