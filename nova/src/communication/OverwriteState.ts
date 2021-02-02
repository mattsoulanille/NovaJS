import { MapKeys } from "novajs/nova/src/proto/protobufjs_bundle";
import { setDifference } from "../common/SetUtils";
import { compareChildren, compareFamilies, TreeType, TreeView } from "../engine/TreeView";
import { getKeyDelta } from "./getKeyDelta";


/**
 * Overwrites one state on top of another. 
 */
export function overwriteState<T extends TreeType>
    (state: TreeView<T>, overwriteWith: TreeView<T>) {

    state.shallowCopyFrom(overwriteWith);

    // Handle adding and removing objects
    compareFamilies(state, overwriteWith, (family, overwriteFamily) => {
        let keyDelta: MapKeys.IKeyDelta | undefined;
        const overwriteKeys = overwriteFamily.getMapKeys();
        if (overwriteKeys.keySet) {
            keyDelta = getKeyDelta(family.getMapKeys().keySet ?? { keys: [] },
                overwriteFamily.getMapKeys().keySet ?? { keys: [] });
        } else if (overwriteFamily.keyDelta) {
            keyDelta = overwriteFamily.keyDelta;
        }

        if (keyDelta) {
            const remove = keyDelta.remove;
            if (remove) {
                for (const key of remove) {
                    family.delete(key);
                }
            }

            const add = keyDelta.add;
            if (add) {
                for (const key of add) {
                    family.set(key, family.childFactory());
                }
            }
        }
    });

    // Update existing objects
    compareChildren(state, overwriteWith, (child, overwriteChild, familyType, childId) => {
        const family = state.families[familyType];
        if (!child) {
            //console.warn(`child ${childId} missing`);
            child = family.childFactory();
            family.set(childId, child);
        }
        if (overwriteChild) {
            overwriteState(child, overwriteChild);
        }
    });

    return state;
}
