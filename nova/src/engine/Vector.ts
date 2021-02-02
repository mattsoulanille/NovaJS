import { immerable } from "immer";

export type VectorLike = { x: number, y: number };

const TWO_PI = 2 * Math.PI;
export class Vector implements VectorLike {
    [immerable] = true;
    protected wrappedX!: number;
    protected wrappedY!: number;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    // Setters and getters are used so space_object/Position.ts
    // can override the setters on x and y.
    set x(x: number) {
        this.wrappedX = x;
    }
    get x() {
        return this.wrappedX;
    }

    set y(y: number) {
        this.wrappedY = y;
    }
    get y() {
        return this.wrappedY;
    }

    static fromVectorLike(v: VectorLike) {
        return new Vector(v.x, v.y);
    }

    add(other: VectorLike) {
        this.x += other.x;
        this.y += other.y;
        return this;
    }

    subtract(other: VectorLike) {
        this.x -= other.x;
        this.y -= other.y;
        return this;
    }

    static minus(a: VectorLike, b: VectorLike) {
        return new Vector(a.x - b.x, a.y - b.y);
    }

    rotate(radians: number) {
        var cos = Math.cos(radians);
        var sin = Math.sin(radians);
        this.x = cos * this.x - sin * this.y;
        this.y = sin * this.x + cos * this.y;
        return this;
    }

    scaled(scale: number) {
        return new Vector(this.x * scale, this.y * scale);
    }

    scale(scale: number) {
        this.x *= scale;
        this.y *= scale;
        return this;
    }

    normalize(targetLength = 1) {
        const length = this.length;
        if (length === 0) {
            throw new Error("Divide by zero");
        }
        const ratio = targetLength / length;
        this.scale(ratio);
        return this;
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
        this.add(u);
        return this;
    }

    shortenToLength(c: number) {
        const length = this.length;
        if (length > c) {
            this.normalize(c);
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


export interface AngleLike {
    angle: number
}

export class Angle {
    private wrappedAngle!: number
    constructor(angle: number) {
        this.angle = angle;
    }

    // Returns a number in [-pi, pi)
    private static mod(val: number) {
        val = ((val % TWO_PI) + TWO_PI) % TWO_PI;
        if (val >= Math.PI) {
            val -= TWO_PI;
        }
        return val;

    }

    set angle(val: number) {
        this.wrappedAngle = Angle.mod(val);
    }

    get angle() {
        return this.wrappedAngle;
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

    static minus(a: AngleLike, b: AngleLike): Angle {
        return new Angle(a.angle - b.angle);
    }

    // What you would need to add to this angle
    // to turn it into the other angle
    distanceTo(other: AngleLike) {
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
}
