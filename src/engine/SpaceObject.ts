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
    private id: string;

    constructor({ state }: { state: SpaceObjectState }) {
        this.id = state.id;
        this.movementType = state.movementType;
        this.position = new Position(
            state.position.x,
            state.position.y
        );

        this.velocity = new Vector(
            state.velocity.x,
            state.velocity.y
        );

        this.rotation = new Angle(state.rotation);
        this.setState(state);
    }

    getState(toGet: StateIndexer<SpaceObjectState> = {}): PartialState<SpaceObjectState> {
        return getStateFromGetters<SpaceObjectState>(toGet, {
            id: () => this.id,
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
