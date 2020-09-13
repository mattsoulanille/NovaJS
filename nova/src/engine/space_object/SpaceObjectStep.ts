import { SpaceObject, Step } from "../State";
import { stateSpreader } from "../StateSpreader";
import { movement } from "./Movement";
import { shipStep } from "./ShipStep";


const shipNextState = stateSpreader([shipStep, movement]);

export const spaceObjectStep: Step<SpaceObject> = function(args) {
    // TODO: Add planets etc to this stepper.
    return shipNextState(args);
}

