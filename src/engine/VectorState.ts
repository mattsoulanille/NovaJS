import * as t from "io-ts";

const VectorState = t.type({
    x: t.number,
    y: t.number
});

type VectorState = t.TypeOf<typeof VectorState>;


export { VectorState }
