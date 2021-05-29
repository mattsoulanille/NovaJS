import * as t from 'io-ts';
import { isLeft, right } from "fp-ts/lib/Either";
import { immerable } from 'immer';


const SEND_INTERVAL = 1000;

class Box<T> {
    [immerable] = true;
    changed = false;
    constructor(public wrappedVal: T) { }

    set val(t: T) {
        this.wrappedVal = t;
        this.changed = true;
    }
    get val() {
        return this.wrappedVal;
    }
}

export class Stat {
    [immerable] = true;
    lastSent = 0;
    private wrappedCurrent: Box<number>;
    private wrappedRecharge: Box<number>;
    private wrappedMax: Box<number>;

    constructor({ current, recharge, max }: {
        current: number,
        recharge: number,
        max: number,
    }) {
        this.wrappedCurrent = new Box(current);
        this.wrappedRecharge = new Box(recharge);
        this.wrappedMax = new Box(max);
    }

    step(delta: number) {
        this.wrappedCurrent.wrappedVal = Math.min(this.max,
            this.current + this.recharge * delta);
    }

    getDelta(): PartialStat | undefined {
        const delta: PartialStat = {};

        let changed = false;
        if (this.wrappedCurrent.changed) {
            delta.current = this.current;
            this.wrappedCurrent.changed = false;
            changed = true;
        }

        if (this.wrappedMax.changed) {
            delta.max = this.max;
            this.wrappedMax.changed = false;
            changed = true;
        }

        if (this.wrappedRecharge.changed) {
            delta.recharge = this.recharge;
            this.wrappedRecharge.changed = false;
            changed = true;
        }

        if (changed) {
            return delta;
        }
        return;
    }

    applyDelta(delta: PartialStat) {
        if (delta.current !== undefined) {
            this.wrappedCurrent.wrappedVal = delta.current;
        }

        if (delta.max !== undefined) {
            this.wrappedMax.wrappedVal = delta.max;
        }

        if (delta.recharge !== undefined) {
            this.wrappedRecharge.wrappedVal = delta.recharge;
        }
    }

    get current() {
        return this.wrappedCurrent.val;
    }
    set current(val: number) {
        this.wrappedCurrent.val = val;
    }

    get recharge() {
        return this.wrappedRecharge.val;
    }
    set recharge(val: number) {
        this.wrappedRecharge.val = val;
    }

    get max() {
        return this.wrappedMax.val;
    }
    set max(val: number) {
        this.wrappedMax.val = val;
    }
}

const StatContents = {
    current: t.number,
    recharge: t.number,
    max: t.number,
};

const statState = t.type(StatContents);
export const stat = new t.Type('Stat',
    (u): u is Stat => u instanceof Stat,
    (i, context) => {
        const decoded = statState.validate(i, context);
        if (isLeft(decoded)) {
            return decoded;
        }
        return right(new Stat(decoded.right));
    },
    (stat) => (statState.encode({
        current: stat.current,
        max: stat.max,
        recharge: stat.recharge,
    }))
);

export const PartialStat = t.partial(StatContents);
export type PartialStat = t.TypeOf<typeof PartialStat>;

export function getStatDelta(_a: Stat, b: Stat): PartialStat | undefined {
    const now = new Date().getTime();
    if (b.lastSent + SEND_INTERVAL < now) {
        b.lastSent = now;
        return b.getDelta();
    }
    return undefined;
}

export function applyStatDelta(stat: Stat, delta: PartialStat) {
    stat.applyDelta(delta);
}
