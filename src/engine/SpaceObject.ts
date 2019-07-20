import { MovementType } from "./MovementType";
import { SpaceObjectState } from "./SpaceObjectState";
import { PartialState, Stateful, StateIndexer } from "./Stateful";
import { getStateFromGetters, setStateFromSetters } from "./StateTraverser";
import { Steppable } from "./Steppable";
import { Vector } from "./Vector";
import { Angle } from "./Angle";
import { Position } from "./Position";



class SpaceObject implements Stateful<SpaceObjectState>, Steppable {
    private position: Position;
    private velocity: Vector;
    private movementType: MovementType;
    private rotation: Angle;

    constructor() {
        this.movementType = "inertial"; // Temporary
        this.position = new Position(0, 0);
        this.velocity = new Vector(0, 0);
        this.rotation = new Angle(0);
    }

    getState(toGet: StateIndexer<SpaceObjectState> = {}): PartialState<SpaceObjectState> {
        return getStateFromGetters<SpaceObjectState>(toGet, {
            movementType: () => this.movementType,
            position: () => this.position.getState(),
            velocity: () => this.velocity.getState(),
            rotation: () => this.rotation.getState(),
        });
    }

    setState(state: PartialState<SpaceObjectState>): StateIndexer<SpaceObjectState> {
        return setStateFromSetters<SpaceObjectState>(state, {
            movementType: (newVal) => { this.movementType = newVal },
            position: (newVal) => this.position.setState(newVal),
            velocity: (newVal) => this.velocity.setState(newVal),
            rotation: (newVal) => this.rotation.setState(newVal),
        });
    }

    step(milliseconds: number): void {
        this.position.add(Vector.scale(this.velocity, milliseconds / 1000));
    }
}



export { SpaceObject };
