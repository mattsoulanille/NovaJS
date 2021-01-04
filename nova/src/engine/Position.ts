import { mod } from "./Mod";
import { Vector, VectorLike } from "./Vector";

export const BOUNDARY = 10000;

function wrap(n: number): number {
    return mod((n + BOUNDARY), (BOUNDARY * 2)) - BOUNDARY;
}

export class Position extends Vector {
    static fromVectorLike(v: VectorLike) {
        return new Position(v.x, v.y);
    }

    constructor(x: number, y: number) {
        super(wrap(x), wrap(y));
    }

    protected factory(x: number, y: number) {
        return new Position(x, y);
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
