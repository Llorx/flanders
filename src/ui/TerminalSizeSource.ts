import type { TimeContext, TimeoutHandle } from "../contexts";

export type TerminalSize = Readonly<{ columns:number; rows:number }>;

// Reads the real current terminal size straight from the OS on each call, never
// from a value the runtime cached at an earlier point. Returns null when the
// real size cannot be read (for example when the output is not a TTY).
export type RawTerminalSizeReader = () => TerminalSize | null;

// Subscribes to the runtime's native resize notification and returns an
// unsubscribe handle.
export type NativeResizeSubscriber = (listener:() => void) => () => void;

const FALLBACK_COLUMNS = 80;
const FALLBACK_ROWS = 24;

// Supplies the current terminal width/height and resize notifications for the
// live UI. The width and height it reports are read from the real terminal on
// every call rather than from a runtime-cached value, and resize detection does
// not depend solely on the runtime's native resize notification: every active
// subscription also polls the real size, so a resize is detected even when the
// native notification is never delivered (the case on Windows consoles for a
// drag-resize). The native notification is kept as an additional, faster path.
//
// See src/.docs/rules/terminal/current-terminal-width-reflects-the-real-terminal.md
// and src/.docs/rules/terminal/resize-refit-not-solely-from-the-runtime-resize-event.md.
export class TerminalSizeSource {
    #teardowns = new Set<() => void>();

    constructor(
        private _read:RawTerminalSizeReader,
        private _subscribeNative:NativeResizeSubscriber,
        private _time:TimeContext,
        private _pollMs:number
    ) {}

    columns():number {
        const size = this._read();
        return size && size.columns > 0 ? size.columns : FALLBACK_COLUMNS;
    }

    rows():number {
        const size = this._read();
        return size && size.rows > 0 ? size.rows : FALLBACK_ROWS;
    }

    onResize(listener:() => void):() => void {
        const initial = this._read();
        let lastColumns = initial ? initial.columns : FALLBACK_COLUMNS;
        let lastRows = initial ? initial.rows : FALLBACK_ROWS;
        let pollTimer:TimeoutHandle | null = null;
        let stopped = false;

        const fireIfChanged = () => {
            const size = this._read();
            if (!size) return;
            if (size.columns === lastColumns && size.rows === lastRows) return;
            lastColumns = size.columns;
            lastRows = size.rows;
            listener();
        };
        const schedulePoll = () => {
            pollTimer = this._time.setTimeout(() => {
                pollTimer = null;
                fireIfChanged();
                if (!stopped) schedulePoll();
            }, this._pollMs);
        };

        const unsubNative = this._subscribeNative(fireIfChanged);
        schedulePoll();

        const teardown = () => {
            stopped = true;
            if (pollTimer) {
                pollTimer.cancel();
                pollTimer = null;
            }
            unsubNative();
        };
        this.#teardowns.add(teardown);
        return () => {
            if (!this.#teardowns.delete(teardown)) return;
            teardown();
        };
    }

    dispose():void {
        for (const teardown of [...this.#teardowns]) {
            teardown();
        }
        this.#teardowns.clear();
    }
}
