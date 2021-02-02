import { Draft } from "immer";
import { StateTreeMod } from "./StateTreeMod";
import { immerStepper } from "./ImmerStepper";
import { Position } from "./Position";
import { Vector } from "./Vector";

interface SpaceObjectState {
    position: Position;
    velocity: Vector;
}

function stateFactory(): SpaceObjectState {
    return {
        position: new Position(0, 0),
        velocity: new Vector(0, 0),
    }
}

function step({ time, state }: {
    time: number,
    state: Draft<SpaceObjectState>,
}) {
    state.position.add(state.velocity.scaled(time));
}

export const SpaceObjectMod: StateTreeMod = {
    name: "SpaceObjectMod",
    parents: new Set(),
    stateFactory,
    step: immerStepper(step),
}
