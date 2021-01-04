import * as t from 'io-ts';
export const VectorLike = t.type({
    x: t.number,
    y: t.number,
});

export type VectorLike = t.TypeOf<typeof VectorLike>;

const TWO_PI = 2 * Math.PI;
export class Vector implements VectorLike {
    x: number;
    y: number;

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

export const AngleLike = t.type({
    angle: t.number,
});

export type AngleLike = t.TypeOf<typeof AngleLike>;

export class Angle implements AngleLike {
    readonly angle: number;

    constructor(angle: number) {
        this.angle = Angle.mod(angle);
    }

    static fromAngleLike(angleLike: AngleLike) {
        return new Angle(angleLike.angle);
    }

    // Returns a number in [-pi, pi)
    private static mod(val: number) {
        val = ((val % TWO_PI) + TWO_PI) % TWO_PI;
        if (val >= Math.PI) {
            val -= TWO_PI;
        }
        return val;
    }

    add(other: Angle | number) {
        if (other instanceof Angle) {
            return new Angle(this.angle + other.angle);
        }
        else {
            return new Angle(this.angle + other);
        }
    }

    subtract(other: Angle | number) {
        if (other instanceof Angle) {
            return new Angle(this.angle - other.angle);
        }
        else {
            return new Angle(this.angle - other);
        }
    }

    static minus(a: AngleLike, b: AngleLike): Angle {
        return new Angle(a.angle - b.angle);
    }

    // What you would need to add to this angle
    // to turn it into the other angle
    distanceTo(other: Angle) {
        return other.subtract(this);
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
}
