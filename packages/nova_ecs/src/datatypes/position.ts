import { isLeft, right } from 'fp-ts/lib/Either.js';
import { immerable } from 'immer';
import * as t from 'io-ts';
import { mod } from './mod.js';
import { Vector, VectorLike } from './vector.js';

export const BOUNDARY = 10000;

/** The full toroidal world extent on each axis (positions wrap over this). */
export const WORLD_SIZE = BOUNDARY * 2;

function wrap(n: number): number {
    return mod((n + BOUNDARY), WORLD_SIZE) - BOUNDARY;
}

/**
 * A signed coordinate difference re-expressed as the shortest toroidal delta:
 * the value in `(-BOUNDARY, BOUNDARY]` that maps to the same wrapped point.
 * Branch-light (two comparisons) for the hot display paths that draw an
 * entity at the wrapped copy nearest the camera; correct whenever the inputs
 * are within one wrap of each other (|delta| < 3·BOUNDARY, which always holds
 * for two wrapped positions plus a viewport offset). Pure math — it never
 * touches or mutates any Position, so it is safe for display-only use.
 */
export function wrapNearestDelta(delta: number): number {
    if (delta > BOUNDARY) {
        return delta - WORLD_SIZE;
    }
    if (delta < -BOUNDARY) {
        return delta + WORLD_SIZE;
    }
    return delta;
}

export const PositionType = new t.Type<Position, VectorLike>(
    'Position',
    (u): u is Position => u instanceof Position,
    (i, context) => {
        const maybeVector = VectorLike.validate(i, context);
        if (isLeft(maybeVector)) {
            return maybeVector;
        }
        return right(Position.fromVectorLike(maybeVector.right));
    },
    VectorLike.encode
);

export class Position extends Vector {
    override [immerable] = true;
    static override fromVectorLike(v: VectorLike) {
        return new Position(v.x, v.y);
    }

    constructor(x: number, y: number) {
        super(wrap(x), wrap(y));
    }

    protected override factory(x: number, y: number): this {
        return new Position(x, y) as this;
    }

    getClosestRelativeTo(other: Position) {
        let relativeToZero = this.subtract(other);
        let xOffset = 0;
        let yOffset = 0;

        if (relativeToZero.x > BOUNDARY) {
            xOffset = 1;
        }
        else if (relativeToZero.x < -BOUNDARY) {
            xOffset = -1;
        }
        if (relativeToZero.y > BOUNDARY) {
            yOffset = 1;
        }
        else if (relativeToZero.y < -BOUNDARY) {
            yOffset = -1;
        }

        return new Position(
            this.x + xOffset * (BOUNDARY * 2),
            this.y + yOffset * (BOUNDARY * 2)
        )
    }
}
