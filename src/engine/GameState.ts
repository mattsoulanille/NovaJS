import * as t from "io-ts";
import { SystemState, SystemComparator } from "./SystemState";
import { makeComparator, makeRecordComparator } from "./Comparator";

const GameState = t.type({
    systems: t.record(t.string, SystemState)
});

type GameState = t.TypeOf<typeof GameState>;

const GameStateComparator = makeComparator<GameState>({
    systems: makeRecordComparator(SystemComparator)
});

export { GameState, GameStateComparator }
