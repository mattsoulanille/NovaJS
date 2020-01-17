import * as t from "io-ts";

const WithUUID = t.type({
    uuid: t.string
});

type WithUUID = t.TypeOf<typeof WithUUID>;

export { WithUUID }
