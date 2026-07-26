import { abortError } from "../abortError";
import type { OutputContext } from "../contexts";
import { disposeOnce } from "../disposeOnce";

export type RawLineSource = Readonly<{
    // Whether the terminal itself echoes the submitted line, which leaves the cursor on the row
    // below the prompt. A source that does not echo leaves it at the end of the prompt instead.
    echoesInput:boolean;
    // Calls back once with the next line the user submits; that callback may still arrive after the
    // read it belongs to was cancelled.
    ask(onLine:(line:string) => void):void;
    close():void;
}>;

export class PromptLineReader {
    private _disposed = false;
    private _source:RawLineSource|null = null;
    private _pending = new Set<AbortController>();
    private _reads = new Set<Promise<unknown>>();

    constructor(private _open:() => RawLineSource) {}

    read(prompt:string, out:OutputContext, signal?:AbortSignal):Promise<string> {
        if (this._disposed || signal?.aborted) {
            return Promise.reject(abortError());
        }
        const controller = new AbortController();
        this._pending.add(controller);
        const answer = new Promise<string>((resolve, reject) => {
            let settled = false;
            const settle = (finish:() => void) => {
                if (settled) return;
                settled = true;
                controller.signal.removeEventListener("abort", onReleased);
                signal?.removeEventListener("abort", onOwnerCancelled);
                finish();
            };
            // Teardown releases every pending read on its way out, so a release while disposing is
            // not the user letting go of the input.
            const onReleased = () => settle(() => reject(abortError({ inputReleased: !this._disposed })));
            const onOwnerCancelled = () => settle(() => reject(abortError()));
            controller.signal.addEventListener("abort", onReleased);
            signal?.addEventListener("abort", onOwnerCancelled);
            try {
                out.write(prompt);
                if (!this._source) {
                    this._source = this._open();
                }
                const source = this._source;
                source.ask(line => {
                    if (settled) return;
                    try {
                        // The terminal already advanced an echoed line; the carriage return keeps
                        // the owner channel at column zero without advancing through another row.
                        out.write(source.echoesInput ? "\r" : "\n");
                    } catch (e) {
                        settle(() => reject(e));
                        return;
                    }
                    settle(() => resolve(line));
                });
            } catch (e) {
                settle(() => reject(e));
            }
        });
        const read:Promise<string> = answer.finally(() => {
            this._pending.delete(controller);
            this._reads.delete(read);
        });
        this._reads.add(read);
        return read;
    }

    cancel():void {
        for (const controller of [...this._pending]) {
            controller.abort();
        }
    }

    dispose():Promise<void> {
        return this._dispose();
    }

    private _dispose = disposeOnce(async () => {
        this._disposed = true;
        this.cancel();
        await Promise.allSettled([...this._reads]);
        const source = this._source;
        this._source = null;
        if (source) {
            source.close();
        }
    });
}
