export function removeSpawnedProcessListener<ExitListener, ErrorListener>(
    event:"exit"|"error",
    listener:ExitListener|ErrorListener,
    exitListeners:ExitListener[],
    errorListeners:ErrorListener[]
):void {
    if (event === "exit") {
        const index = exitListeners.indexOf(listener as ExitListener);
        if (index !== -1) exitListeners.splice(index, 1);
        return;
    }
    const index = errorListeners.indexOf(listener as ErrorListener);
    if (index !== -1) errorListeners.splice(index, 1);
}
