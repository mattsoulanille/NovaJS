import { System } from "./system";
import * as t from 'io-ts';
import { Resource } from "./resource";
import { Singleton } from "./singleton";

export const TimeResource = new Resource({
    name: 'time',
    type: t.type({
        delta: t.number,
        time: t.number
    }),
    getDelta: () => undefined,
    applyDelta: () => undefined,
});

// Should be a singleton system.
export const TimeSystem = new System({
    name: 'time',
    args: [TimeResource, Singleton] as const,
    step: (time) => {
        // TODO: performance.now for node?
        const now = new Date().getTime();
        time.delta = now - time.time;
        time.time = now;
    }
});
