import { Steppable } from "./Steppable";
import { Vector } from "./Vector";
import { Angle } from "./Vector";
import { Position } from "./Position";
import { Stateful } from "./Stateful";
import { SpaceObjectState } from "novajs/nova/src/proto/space_object_state_pb";


export class SpaceObject implements Stateful<SpaceObjectState>, Steppable {
    private position: Position = new Position(0, 0);
    private velocity: Vector = new Vector(0, 0);

    private movementType:
        SpaceObjectState.MovementTypeMap[keyof SpaceObjectState.MovementTypeMap]
        = SpaceObjectState.MovementType.INERTIAL;

    private rotation: Angle = new Angle(0);
    private turning: number = 0;
    private turnBack: boolean = false;
    private acceleration: number = 0;
    private accelerating: number = 0;
    turnRate: number = 0;
    maxVelocity: number = 0;

    constructor(state?: SpaceObjectState) {
        if (state) {
            this.setState(state);
        }
    }

    getState(): SpaceObjectState {
        const state = new SpaceObjectState();
        state.setMovementtype(this.movementType);
        state.setPosition(this.position.getState());
        state.setVelocity(this.velocity.getState());
        state.setMaxvelocity(this.maxVelocity);
        state.setRotation(this.rotation.angle);
        state.setTurning(this.turning);
        state.setTurnback(this.turnBack);
        state.setTurnrate(this.turnRate);
        state.setAcceleration(this.acceleration);
        state.setAccelerating(this.accelerating);
        return state;
    }

    setState(state: SpaceObjectState) {
        this.movementType = state.getMovementtype();

        if (state.hasPosition()) {
            this.position.setState(state.getPosition()!);
        }
        if (state.hasVelocity()) {
            this.velocity.setState(state.getVelocity()!);
        }

        this.maxVelocity = state.getMaxvelocity();
        this.rotation.setState(state.getRotation());
        this.acceleration = state.getAcceleration();
        this.accelerating = state.getAccelerating();
        this.turning = state.getTurning();
        this.turnBack = state.getTurnback();
        this.turnRate = state.getTurnrate();
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
