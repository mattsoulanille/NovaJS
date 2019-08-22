import { MovementType } from "./MovementType";
import { SpaceObjectState, TurnDirection } from "./SpaceObjectState";
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
    private turning: TurnDirection;
    private id: string;
    private acceleration: number;
    private accelerating: number;
    turnRate: number;
    maxVelocity: number;

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

        this.maxVelocity = state.maxVelocity;

        this.rotation = new Angle(state.rotation);
        this.acceleration = state.acceleration;
        this.accelerating = state.accelerating;
        this.turning = state.turning;
        this.turnRate = state.turnRate;
        this.setState(state);
    }

    getState(toGet: StateIndexer<SpaceObjectState> = {}): PartialState<SpaceObjectState> {
        return getStateFromGetters<SpaceObjectState>(toGet, {
            id: () => this.id,
            movementType: () => this.movementType,
            position: () => this.position.getState(),
            velocity: () => this.velocity.getState(),
            maxVelocity: () => this.maxVelocity,
            rotation: () => this.rotation.getState(),
            turning: () => this.turning,
            turnRate: () => this.turnRate,
            acceleration: () => this.acceleration,
            accelerating: () => this.accelerating
        });
    }

    setState(state: PartialState<SpaceObjectState>): StateIndexer<SpaceObjectState> {
        return setStateFromSetters<SpaceObjectState>(state, {
            movementType: (newVal) => { this.movementType = newVal },
            position: (newVal) => this.position.setState(newVal),
            velocity: (newVal) => this.velocity.setState(newVal),
            maxVelocity: (newVal) => { this.maxVelocity = newVal },
            rotation: (newVal) => this.rotation.setState(newVal),
            turning: (newVal) => { this.turning = newVal },
            turnRate: (newVal) => { this.turnRate = newVal },
            acceleration: (newVal) => { this.acceleration = newVal },
            accelerating: (newVal) => { this.accelerating = newVal }
        });
    }

    step(milliseconds: number): void {

        const seconds = milliseconds / 1000;

        let turning: number;
        if (this.turning === "back") {
            turning = 0;
        }
        else {
            turning = this.turning;
        }

        this.rotation.add(turning * this.turnRate * seconds)
        if (this.accelerating > 0) {
            const delta = this.rotation.getUnitVector();
            delta.scaleToLength(
                this.accelerating
                * this.acceleration
                * seconds);

            this.velocity.add(delta);
        }

        this.velocity.shortenToLength(this.maxVelocity);

        this.position.add(Vector.scale(this.velocity, seconds));
    }
}



export { SpaceObject };
