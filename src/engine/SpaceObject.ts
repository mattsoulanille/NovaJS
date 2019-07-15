import { SpaceObjectState } from "./SpaceObjectState";
import { Vector } from "./Vector";
import { Stateful, RecursivePartial, StateIndexer, PartialState } from "./Stateful";
import { Steppable } from "./Steppable";
import { isEmptyObject } from "./EmptyObject";
import { ValuesToGetters, ValuesToSetters, getStateFromGetters, setStateFromSetters } from "./StateTraverser";
import { MovementType } from "./MovementType";



class SpaceObject implements Stateful<SpaceObjectState>, Steppable {
    private position: Vector;
    private velocity: Vector;
    private movementType: MovementType;
    private rotation: number; // Should this be its own class?
    private stateGetters: ValuesToGetters<SpaceObjectState>
    private stateSetters: ValuesToSetters<SpaceObjectState>

    constructor() {
        this.position = new Vector(0, 0);
        this.velocity = new Vector(0, 0);
        this.rotation = 0;
        this.movementType = "inertial"; // Temporary


        this.stateGetters = {
            movementType: () => this.movementType,
            position: () => this.position.getState(),
            velocity: () => this.velocity.getState(),
        };

        this.stateSetters = {
            movementType: (newVal) => { this.movementType = newVal },
            position: (newVal) => { this.position.setState(newVal) },
            velocity: (newVal) => { this.velocity.setState(newVal) }
        }
    }

    getState(toGet: StateIndexer<SpaceObjectState> = {}): PartialState<SpaceObjectState> {
        return getStateFromGetters(this.stateGetters, toGet);
    }

    setState(state: PartialState<SpaceObjectState>): StateIndexer<SpaceObjectState> {
        return setStateFromSetters<SpaceObjectState>(this.stateSetters, state);
    }

    step(_milliseconds: number): void {

    }



}



export { SpaceObject }
