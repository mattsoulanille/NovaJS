import * as t from "io-ts";
import { Stateful, StateIndexer, PartialState } from "./Stateful";
import { AngleState } from "./AngleState";
import { Vector } from "./Vector";

const TWO_PI = 2 * Math.PI;

class Angle implements Stateful<AngleState> {
    private _angle!: number
    constructor(angle: number) {
        this.angle = angle
    }

    private static mod(val: number) {
        return ((val % TWO_PI) + TWO_PI) % TWO_PI;
    }

    set angle(val: number) {
        this._angle = Angle.mod(val);
    }

    get angle() {
        return this._angle;
    }

    add(other: Angle | number) {
        if (other instanceof Angle) {
            this.angle += other.angle;
        }
        else {
            this.angle += other
        }
    }

    subtract(other: Angle | number) {
        if (other instanceof Angle) {
            this.angle -= other.angle
        }
        else {
            this.angle -= other
        }
    }

    // Returns an angle in [-pi, pi)
    static minus(a: Angle, b: Angle) {
        let difference = Angle.mod(a.angle - b.angle);
        if (difference >= Math.PI) {
            difference -= TWO_PI;
        }
        return difference;
    }

    distanceTo(other: Angle) {
        return Angle.minus(this, other);
    }

    // Note that we use the clock unit circle
    // and window coordinates (+y is down)
    // instead of the standard one, so it's not
    // just x = cos(angle), y = sin(angle).
    // sin and cos are swapped.
    getUnitVector(): Vector {
        return new Vector(
            Math.sin(this.angle),
            -Math.cos(this.angle)
        );
    }

    getState(): PartialState<AngleState> {
        return this.angle;
    }
    setState(state: number): StateIndexer<AngleState> {
        this.angle = state;
        return {};
    }
}

const AngleType = t.number;

export { Angle, AngleType }
