import * as t from "io-ts";

// Stores set as a list
function SetType<C extends t.Mixed>(codec: C) {
    type EntryType = t.TypeOf<typeof codec>;
    return new t.Type<
        Set<EntryType>,
        EntryType[],
        unknown>(
            "Set",
            function(u: unknown): u is Set<EntryType> {
                if (u instanceof Set) {
                    for (let entry of u) {
                        if (!codec.is(entry)) {
                            return false;
                        }
                    }
                    return true;
                }
                else {
                    return false;
                }
            },
            function(input: unknown, context: t.Context) {
                // If it's already a set, don't try to decode it as a list
                if (input instanceof Set) {
                    for (let element of input) {
                        if (!codec.is(element)) {
                            return t.failure(`Expected element ${element} `
                                + `to be of type ${codec.name}`, context);
                        }
                    }
                    return t.success(input);
                }

                const decoded = t.array(codec).decode(input);
                if (decoded.isRight()) {
                    return t.success(new Set(decoded.value));
                }
                else {
                    return t.failure(decoded.value, context);
                }
            },
            function(toEncode: Set<EntryType>) {
                return [...toEncode];
            }

        )
}

export { SetType }

