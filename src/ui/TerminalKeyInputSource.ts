import type { TerminalKeyInputContext } from "../contexts";

const ESCAPE = "\x1b";
const INTERRUPT = "\x03";
const FIXED_RETRY_SEQUENCES = ["\x1b[15~", "\x1b[[E"] as const;
const RETRY_SEQUENCE_PATTERN = /\x1b(?:\[15(?:;\d+)?~|\[\[E)/g;

export type TerminalKeyInputPrimitives = Readonly<{
    isTerminal():boolean;
    isRawMode():boolean;
    setRawMode(enabled:boolean):void;
    subscribeBytes(listener:(chunk:Buffer|string) => void):() => void;
}>;

type RetrySubscription = Readonly<{ listener:() => void }>;

function unfinishedRetrySequence(input:string):string {
    const escapeIndex = input.lastIndexOf(ESCAPE);
    if (escapeIndex === -1) {
        return "";
    }
    const suffix = input.slice(escapeIndex);
    const fixedPrefix = FIXED_RETRY_SEQUENCES.some(sequence =>
        suffix.length < sequence.length && sequence.startsWith(suffix)
    );
    return fixedPrefix || /^\x1b\[15;\d*$/.test(suffix) ? suffix : "";
}

export class TerminalKeyInputSource implements TerminalKeyInputContext {
    private _disposed = false;
    private _pendingSequence = "";
    private _previousRawMode:boolean|null = null;
    private _unsubscribeBytes:(() => void)|null = null;
    private _subscriptions = new Set<RetrySubscription>();

    constructor(
        private _primitives:TerminalKeyInputPrimitives,
        private _onInterrupt:() => void
    ) {}

    available():boolean {
        return !this._disposed && this._primitives.isTerminal();
    }

    onRetryKey(listener:() => void):() => void {
        if (!this.available()) {
            return () => {};
        }

        const subscription:RetrySubscription = { listener };
        this._subscriptions.add(subscription);
        try {
            if (this._unsubscribeBytes === null) {
                this._startReading();
            }
        } catch (error) {
            this._subscriptions.delete(subscription);
            throw error;
        }

        return () => {
            if (!this._subscriptions.delete(subscription)) {
                return;
            }
            if (this._subscriptions.size === 0) {
                this._stopReading();
            }
        };
    }

    private _startReading():void {
        const previousRawMode = this._primitives.isRawMode();
        this._previousRawMode = previousRawMode;
        this._primitives.setRawMode(true);
        try {
            this._unsubscribeBytes = this._primitives.subscribeBytes(chunk => {
                this._consume(chunk);
            });
        } catch (error) {
            this._previousRawMode = null;
            this._primitives.setRawMode(previousRawMode);
            throw error;
        }
    }

    private _consume(chunk:Buffer|string):void {
        const text = typeof chunk === "string" ? chunk : chunk.toString("latin1");
        const input = this._pendingSequence + text;
        const events = input.match(new RegExp(`${INTERRUPT}|${RETRY_SEQUENCE_PATTERN.source}`, "g")) ?? [];
        this._pendingSequence = unfinishedRetrySequence(input);

        for (const event of events) {
            if (event === INTERRUPT) {
                this._onInterrupt();
                continue;
            }
            for (const subscription of [...this._subscriptions]) {
                subscription.listener();
            }
        }
    }

    private _stopReading():void {
        const unsubscribeBytes = this._unsubscribeBytes;
        const previousRawMode = this._previousRawMode;
        if (unsubscribeBytes === null || previousRawMode === null) {
            return;
        }

        this._unsubscribeBytes = null;
        this._previousRawMode = null;
        this._pendingSequence = "";
        try {
            unsubscribeBytes();
        } finally {
            this._primitives.setRawMode(previousRawMode);
        }
    }

    dispose():void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this._subscriptions.clear();
        this._stopReading();
    }
}
