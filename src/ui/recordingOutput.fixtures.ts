import type { OutputContext } from "../contexts";

export const STUB_COLUMNS = 80;
export const STUB_ROWS = 24;

export function recordingOutput() {
    const written:string[] = [];
    const errors:string[] = [];
    const output:OutputContext = {
        write(text) { written.push(text); },
        writeError(text) { errors.push(text); },
        columns() { return STUB_COLUMNS; },
        rows() { return STUB_ROWS; },
        onResize() { return () => {}; }
    };
    return { output, written, errors };
}
