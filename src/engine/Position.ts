import { Vector } from "./Vector";
import { mod } from "./Mod";

const BOUNDARY = 10000;

/*
function mod(x: number, y: number) {
    return ((x % y) + y) % y;
}
*/

function wrap(n: number): number {
    return mod((n + BOUNDARY), (BOUNDARY * 2)) - BOUNDARY;
}

class Position extends Vector {
    _x!: number;
    _y!: number;

    set x(val: number) {
        this._x = wrap(val);
    }
    get x() {
        return this._x;
    }
    set y(val: number) {
        this._y = wrap(val);
    }
    get y() {
        return this._y;
    }
}

export { Position, BOUNDARY }
