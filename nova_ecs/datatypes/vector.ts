import { isLeft, right } from 'fp-ts/lib/Either';
import { immerable } from 'immer';
import * as t from 'io-ts';
import { Angle } from './angle';

export const VectorLike = t.type({
    x: t.number,
    y: t.number,
});
export type VectorLike = t.TypeOf<typeof VectorLike>;

export const VectorType = new t.Type<Vector, VectorLike>(
    'Vector',
    (u): u is Vector => u instanceof Vector,
    (i, context) => {
        const maybeVector = VectorLike.validate(i, context);
        if (isLeft(maybeVector)) {
            return maybeVector;
        }
        return right(Vector.fromVectorLike(maybeVector.right));
    },
    VectorLike.encode
);

export class Vector implements VectorLike {
    [immerable] = true;
    readonly x: number;
    readonly y: number;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    static fromVectorLike(v: VectorLike) {
        return new Vector(v.x, v.y);
    }

    protected factory(x: number, y: number) {
        return new Vector(x, y);
    }

    private apply(other: VectorLike, f: (a: number, b: number) => number) {
        return this.factory(f(this.x, other.x), f(this.y, other.y));
    }

    add(other: VectorLike) {
        return this.apply(other, (a, b) => a + b);
    }

    subtract(other: VectorLike) {
        return this.apply(other, (a, b) => a - b);
    }

    rotate(radians: number) {
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const x = cos * this.x - sin * this.y;
        const y = sin * this.x + cos * this.y;
        return this.factory(x, y);
    }

    scale(scale: number) {
        return this.factory(this.x * scale, this.y * scale);
    }

    normalize(targetLength = 1) {
        const length = this.length;
        if (length === 0) {
            throw new Error("Divide by zero");
        }
        const ratio = targetLength / length;
        return this.scale(ratio);
    }

    get lengthSquared(): number {
        return this.x ** 2 + this.y ** 2;
    }

    get length(): number {
        return Math.sqrt(this.lengthSquared);
    }

    get unitVector() {
        const l = this.length;
        return new Vector(this.x / l, this.y / l);
    }

    lengthenBy(c: number) {
        const u = this.unitVector
        u.scale(c);
        return this.add(u);
    }

    shortenToLength(c: number) {
        const length = this.length;
        if (length > c) {
            return this.normalize(c);
        }
        return this;
    }

    // Remember that we use clock angles
    // with y inverted, which means
    // we are using the unit circle rotated 
    // clockwise pi/4. In these new coordinates,
    // x <- -y and y <- x
    get angle(): Angle {
        return new Angle(Math.atan2(this.x, -this.y));
    }
}
