export function interceptAbortListenerRemoval(onRemove:() => void):() => void {
    const NativeAbortController = globalThis.AbortController;
    class InterceptingAbortController extends NativeAbortController {
        constructor() {
            super();
            const removeEventListener = this.signal.removeEventListener.bind(this.signal);
            (this.signal as { removeEventListener:AbortSignal["removeEventListener"] }).removeEventListener = (type, listener, options) => {
                removeEventListener(type, listener, options);
                onRemove();
            };
        }
    }
    globalThis.AbortController = InterceptingAbortController;
    return () => {
        globalThis.AbortController = NativeAbortController;
    };
}
