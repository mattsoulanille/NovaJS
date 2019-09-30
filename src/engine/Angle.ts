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

    // Returns a number in [-pi, pi)
    static minus(a: Angle, b: Angle): number {
        let difference = Angle.mod(a.angle - b.angle);
        if (difference >= Math.PI) {
            difference -= TWO_PI;
        }
        return difference;
    }

    // What you would need to add to this angle
    // to turn it into the other angle
    distanceTo(other: Angle) {
        return Angle.minus(other, this);
    }

    // Remember that we use clock angles
    // with y inverted, which means
    // we are using the unit circle rotated 
    // clockwise pi/4. An angle x in this circle corresponds
    // to the coordinate cos(x - pi/4), sin(x - pi/4)
    // which is the same as cos, sin shifted pi/4
    // to the left, which becomes sin, -cos
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
