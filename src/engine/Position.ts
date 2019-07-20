import { Vector } from "./Vector";

const BOUNDARY = 5000;

function mod(x: number, y: number) {
    return ((x % y) + y) % y;
}

class Position extends Vector {
    _x!: number;
    _y!: number;

    set x(val: number) {
        this._x = mod(val, BOUNDARY);
    }
    get x() {
        return this._x;
    }
    set y(val: number) {
        this._y = mod(val, BOUNDARY);
    }
    get y() {
        return this._y;
    }
}

export { Position, BOUNDARY }
