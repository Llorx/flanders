import type { TerminalKeyInputContext } from "../contexts";

export const unavailableTerminalKeyInputContext:TerminalKeyInputContext = {
    available() {
        return false;
    },
    onRetryKey() {
        return () => {};
    }
};
