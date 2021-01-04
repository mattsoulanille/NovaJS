import produce, { Draft } from "immer";

import { StateTreeDelta } from "../engine/StateTree";


function filter(draft: Draft<StateTreeDelta>, include: (uuid: string) => boolean, uuid: string): boolean {
    let included = include(uuid);
    if (!included) {
        // If the node itself is not included, don't include its mod deltas.
        delete draft.modDeltas;
    }

    for (const [childUUID, childDelta] of Object.entries(draft.childrenDeltas ?? {})) {

        // Whether or not to include the child. True iff the child or a descendant
        // is included as decided by the include function.        
        const includeChild = filter(childDelta, include, childUUID);
        included ||= includeChild;

        if (!includeChild) {
            delete draft.childrenDeltas?.[childUUID];
        }
    }

    return included;
}

export function filterDelta(delta: StateTreeDelta,
    include: (uuid: string) => boolean): StateTreeDelta {
    return produce(delta, draft => {
        filter(draft, include, 'root');
    });
}
