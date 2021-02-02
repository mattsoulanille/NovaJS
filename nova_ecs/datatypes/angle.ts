import { isLeft, right } from 'fp-ts/lib/Either';
import * as t from 'io-ts';
import { Vector } from './vector';

const TWO_PI = 2 * Math.PI;

export const AngleLike = t.type({
    angle: t.number,
});

export const AngleType = new t.Type<Angle, AngleLike>(
    'Angle',
    (u): u is Angle => u instanceof Angle,
    (i, context) => {
        const maybeAngle = AngleLike.validate(i, context);
        if (isLeft(maybeAngle)) {
            return maybeAngle;
        }
        return right(Angle.fromAngleLike(maybeAngle.right));
    },
    AngleLike.encode
);

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
