export interface BaseData {
    name: string;
    id: string;
    /**
     * The namespace half of `id`. NOT the plug-in that wrote the resource:
     * a plug-in resource that OVERRIDES a stock one keeps the stock id (and
     * so `prefix: "nova"`), because that is the id every numeric reference
     * in the data resolves to. See `writerPrefix` for the other question.
     */
    prefix: string;
    /**
     * The plug-in that actually WROTE this resource ("nova" for stock data,
     * a Plug-ins entry's namespace otherwise) — which is NOT `prefix`
     * whenever a plug-in overrides a stock resource, since the override
     * keeps the stock id.
     *
     * This is the namespace a bare resource NUMBER inside this resource's
     * own scripting is scoped to. Extra Outfits overrides stock oütf 197
     * (the Afterburner) and gives it Availability `!o548`, naming its own
     * Afterburner 2nd Generation; `prefix` says "nova", so resolving 548
     * against it looks for a stock outfit 548 that does not exist and the
     * term is silently always-false. `writerPrefix` says "extra-outfits",
     * which resolves it correctly (mission_logic's resolveNumberedResource:
     * stock's `n` if there is one, else the writer's own).
     */
    writerPrefix: string;
}

export function getDefaultBaseData(): BaseData {
    return {
        name: "default",
        id: "default",
        prefix: "default",
        writerPrefix: "default",
    }
}
