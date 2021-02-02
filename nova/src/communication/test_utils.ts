export type Callbacks = { [event: string]: ((...args: unknown[]) => unknown)[] };
export type On = (event: string, cb: (...args: any[]) => unknown) => any;
export function trackOn(): [Callbacks, On] {
    let callbacks: Callbacks = {}

    function on(event: string, cb: (...args: unknown[]) => unknown) {

        if (!callbacks[event]) {
            callbacks[event] = [];
        }
        callbacks[event].push(cb);
    }
    return [callbacks, on]
}
