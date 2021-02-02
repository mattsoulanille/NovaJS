import { spaceObjectStep } from "./space_object/SpaceObjectStep";
import { Step, System } from "./State";
import { makeMapStepFunction } from "./StepMap";


const stepSpaceObjects = makeMapStepFunction(spaceObjectStep);

export const systemStep: Step<System> = function({ state, delta }) {
    stepSpaceObjects({ state: state.spaceObjects, delta });
}
