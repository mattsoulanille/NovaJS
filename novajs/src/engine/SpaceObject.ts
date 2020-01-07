import { MovementType } from "./MovementType";
import { SpaceObjectState, TurnDirection } from "./SpaceObjectState";
import { PartialState, Stateful, StateIndexer } from "./Stateful";
import { getStateFromGetters, setStateFromSetters } from "./StateTraverser";
import { Steppable } from "./Steppable";
import { Vector } from "./Vector";
import { Angle } from "./Vector";
import { Position } from "./Position";



class SpaceObject implements Stateful<SpaceObjectState>, Steppable {
    private position: Position;
    private velocity: Vector;
    private movementType: MovementType;
    private rotation: Angle;
    private turning: TurnDirection;
    private turnBack: boolean;
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
        this.turnBack = state.turnBack;
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
            turnBack: () => this.turnBack,
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
            turnBack: (newVal) => { this.turnBack = newVal },
            turnRate: (newVal) => { this.turnRate = newVal },
            acceleration: (newVal) => { this.acceleration = newVal },
            accelerating: (newVal) => { this.accelerating = newVal }
        });
    }

    private turnToDirection(seconds: number, target: Angle) {
        // We change this.turning because we need
        // the display to render the turning direction.
        let difference = this.rotation.distanceTo(target);

        // If we would turn past
        // the target direction,
        // just go to the target direction
        if (this.turnRate * seconds
            > Math.abs(difference)) {
            this.turning = 0;
            this.rotation.angle = target.angle;
        }
        else if (difference > 0) {
            this.turning = 1;
        }
        else {
            this.turning = -1;
        }

        this.rotation.add(this.turning * this.turnRate * seconds)

    }

    private doInertialControls(seconds: number) {
        // Turning
        if (this.turnBack) {
            if (this.velocity.getLength() > 0) {
                let reverseAngle = this.velocity.getAngle();
                reverseAngle.add(Math.PI);
                this.turnToDirection(seconds, reverseAngle);
            }
        }
        else {
            this.rotation.add(
                this.turning
                * this.turnRate
                * seconds);
        }

        // Acceleration
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


    step(milliseconds: number): void {
        const seconds = milliseconds / 1000;
        this.doInertialControls(seconds);
    }
}



export { SpaceObject };
