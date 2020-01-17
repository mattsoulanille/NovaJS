import * as t from "io-ts";
import { makeComparator, valueComparator } from "./Comparator";

const VectorState = t.type({
    x: t.number,
    y: t.number
});

type VectorState = t.TypeOf<typeof VectorState>;

const VectorComparator = makeComparator<VectorState>({
    x: valueComparator,
    y: valueComparator
});


const AngleState = t.number

type AngleState = t.TypeOf<typeof AngleState>;

export { VectorState, VectorComparator, AngleState }
