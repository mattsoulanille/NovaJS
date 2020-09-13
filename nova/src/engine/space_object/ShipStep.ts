import { SpaceObject, Step } from "../State";

export const shipStep: Step<SpaceObject> = function({ state }) {
    // noop for now
    return state;
}
