import { Vector, VectorLike } from "./Vector";
import { mod } from "./Mod";
import { immerable } from "immer";

export const BOUNDARY = 10000;

function wrap(n: number): number {
    return mod((n + BOUNDARY), (BOUNDARY * 2)) - BOUNDARY;
}

export class Position extends Vector {
    [immerable] = true;
    set x(x: number) {
        this.wrappedX = wrap(x);
    }
    get x() {
        return this.wrappedX;
    }

    set y(y: number) {
        this.wrappedY = wrap(y);
    }
    get y() {
        return this.wrappedY;
    }

    static fromVectorLike(v: VectorLike) {
        return new Position(v.x, v.y);
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

Position.prototype[immerable] = true;
