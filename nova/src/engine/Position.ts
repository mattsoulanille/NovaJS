import { Vector, VectorLike } from "./Vector";
import { mod } from "./Mod";
import { VectorState } from "novajs/nova/src/proto/vector_state_pb";

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

    static fromVectorLike(v: VectorLike) {
        return new Position(v.x, v.y);
    }

    static fromProto(v: VectorState) {
        return new Position(v.getX(), v.getY());
    }

    getClosestRelativeTo(other: Position) {
        let relativeToZero = Vector.minus(this, other);
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

/*
// Yields in order the closest values to
// target that are equivalent to zero
function* getZeroes(target: number) {

    yield wrap(target);

    let offsetCount: number;
    if (target > 0) {
        // Then the next closest one is
        // on the negative side
        offsetCount = 1;
    }
    else {
        offsetCount = 2;
    }

    while (true) {
        // Yield positive if even
        if (offsetCount % 2 === 0) {
            yield target
                - (BOUNDARY * 2)
                * (offsetCount / 2);
        }
        // Yield negative if odd
        else {
            yield target
                + (BOUNDARY * 2)
                * ((offsetCount + 1) / 2)
        }
        offsetCount++;
    }
}

*/
/*
// Yields points equivalent to (0, 0) in modspace
// in the rectangle defined by `start` and `length`
function* getOrigins(start: VectorLike, length: VectorLike) {

	// Closest origin to start in the
	// positive-x, positive-y direction
	let closestToStart = new Vector(
		mod(start.x, (BOUNDARY * 2))

		// start + ? = closest


}
*/
// Sorted by distance in the infinity norm (max of them)

export { Position, BOUNDARY }
