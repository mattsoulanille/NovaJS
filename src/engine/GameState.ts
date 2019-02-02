import { SystemState } from "./SystemState";

type GameState = {
    systems: { [index: string]: SystemState }
};

export { GameState }