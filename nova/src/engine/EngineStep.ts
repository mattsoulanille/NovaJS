import { EngineState, Step } from "./State";
import { makeMapStepFunction } from "./StepMap";
import { systemStep } from "./SystemStep";


const stepSystems = makeMapStepFunction(systemStep);

export const engineStep: Step<EngineState> = ({ state, delta }) => {
    stepSystems({ state: state.systems, delta });
}
