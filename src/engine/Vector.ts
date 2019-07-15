import * as t from "io-ts";
import { Stateful, StateIndexer, RecursivePartial } from "./Stateful";
import { VectorState } from "./VectorState";
import { isEmptyObject } from "./EmptyObject";


class Vector implements Stateful<VectorState>{

    x: number
    y: number

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    add(other: Vector) {
        this.x += other.x;
        this.y += other.y;
    }

    rotate(radians: number) {
        var cos = Math.cos(radians);
        var sin = Math.sin(radians);
        this.x = cos * this.x - sin * this.y;
        this.y = sin * this.x + cos * this.y;
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
}

const VectorType = t.type({ x: t.number, y: t.number });

export { Vector, VectorType }
