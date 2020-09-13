import { Engine, Step } from "./State";
import { makeMapStepFunction } from "./StepMap";
import { systemStep } from "./SystemStep";


const stepSystems = makeMapStepFunction(systemStep);

export const engineStep: Step<Engine> = ({ state, delta }) => {
    stepSystems({ state: state.systems, delta });
}
