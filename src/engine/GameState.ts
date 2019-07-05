import * as t from "io-ts";
import { SystemState } from "./SystemState";

const GameState = t.type({
    systems: t.record(t.string, SystemState)
});

type GameState = t.TypeOf<typeof GameState>;

export { GameState }
