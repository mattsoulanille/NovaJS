import * as t from "io-ts";
import { Stateful, StateIndexer, RecursivePartial } from "./Stateful";
import { VectorState } from "./VectorState";
import { isEmptyObject } from "./EmptyObject";
import { Angle } from "./Angle";


class Vector implements Stateful<VectorState>, VectorLike {

    x: number
    y: number

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    static fromVectorLike(v: VectorLike) {
        return new Vector(v.x, v.y);
    }

    add(other: VectorLike) {
        this.x += other.x;
        this.y += other.y;
    }

    static minus(a: VectorLike, b: VectorLike) {
        return new Vector(a.x - b.x, a.y - b.y);
    }

    subtract(other: VectorLike) {
        this.x -= other.x;
        this.y -= other.y;
    }

    rotate(radians: number) {
        var cos = Math.cos(radians);
        var sin = Math.sin(radians);
        this.x = cos * this.x - sin * this.y;
        this.y = sin * this.x + cos * this.y;
    }

    copy() {
        return new Vector(this.x, this.y);
    }

    static scale(vec: Vector, scale: number) {
        return new Vector(vec.x * scale, vec.y * scale);
    }

    scaleBy(scale: number) {
        this.x *= scale;
        this.y *= scale;
    }

    scaledBy(scale: number) {
        const v = this.copy();
        v.scaleBy(scale);
        return v;
    }

    // Possible divide by zero
    scaleToLength(targetLength: number) {
        const length = this.getLength();
        const ratio = targetLength / length;
        this.scaleBy(ratio);
    }

    getLengthSquared(): number {
        return this.x ** 2 + this.y ** 2;
    }

    getLength(): number {
        return Math.sqrt(this.getLengthSquared());
    }

    getUnitVector() {
        const l = this.getLength();
        return new Vector(this.x / l, this.y / l);
    }

    lengthenBy(c: number) {
        const u = this.getUnitVector();
        u.scaleBy(c);
        this.add(u);
    }

    shortenToLength(c: number) {
        const length = this.getLength();
        if (length > c) {
            this.scaleToLength(c);
        }
    }

    getState(_toGet: StateIndexer<VectorState> = {}): RecursivePartial<VectorState> {
        return {
            x: this.x,
            y: this.y
        }
    }

    setState({ x, y }: RecursivePartial<VectorState>): StateIndexer<VectorState> {
        if (x !== undefined) {
            this.x = x
        }
        if (y !== undefined) {
            this.y = y
        }
        return {};
    }

    // Remember that we use clock angles
    // with y inverted, which means
    // we are using the unit circle rotated 
    // clockwise pi/4. In these new coordinates,
    // x <- -y and y <- x
    getAngle(): Angle {
        return new Angle(Math.atan2(this.x, -this.y));
    }
}

const VectorType = t.type({ x: t.number, y: t.number });
type VectorLike = t.TypeOf<typeof VectorType>;

export { Vector, VectorType, VectorLike }
