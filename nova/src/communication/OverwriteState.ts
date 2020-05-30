import { MapKeys } from "novajs/nova/src/proto/protobufjs_bundle";
import { setDifference, setUnion } from "../common/SetUtils";
import { compareChildren, compareFamilies, TreeType, TreeView } from "../engine/TreeView";


/**
 * Overwrites one state on top of another. 
 */
export function overwriteState<T extends TreeType>
    (state: TreeView<T>, overwriteWith: TreeView<T>) {

    // TODO: Fix this it's broken.
    // Object.assign(state.protobuf,
    //     overwriteWith.withoutChildren().protobuf);

    state.shallowCopyFrom(overwriteWith)

    // Handle adding and removing objects
    compareFamilies(state, overwriteWith, (family, overwriteFamily) => {
        let keyDelta: MapKeys.IKeyDelta | undefined;
        if (overwriteFamily.keySet) {
            //family.keySet = overwriteFamily.keySet;
            keyDelta = getDelta(family.keySet ?? { keys: [] },
                overwriteFamily.keySet);
        } else if (overwriteFamily.keyDelta) {
            keyDelta = overwriteFamily.keyDelta;
        }

        if (keyDelta) {
            const remove = keyDelta.remove;
            if (remove) {
                const keys = new Set(family.keySet?.keys ?? []);
                family.keySet = family.keySet ?? new MapKeys.KeySet();
                const removeSet = new Set(remove);
                family.keySet.keys = [...setDifference(keys, removeSet)];
                for (const key of removeSet) {
                    family.delete(key);
                }
            }

            const add = keyDelta.add;
            if (add) {
                const keys = new Set(family.keySet?.keys ?? []);
                family.keySet = family.keySet ?? new MapKeys.KeySet();
                const addSet = new Set(add);
                family.keySet.keys = [...setUnion(keys, addSet)];
                for (const key of addSet) {
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

function getDelta(keys: MapKeys.IKeySet, newKeys: MapKeys.IKeySet): MapKeys.KeyDelta {
    const keysSet = new Set(keys.keys ?? []);
    const newKeysSet = new Set(newKeys.keys ?? []);

    const add = setDifference(newKeysSet, keysSet);
    const remove = setDifference(keysSet, newKeysSet);
    return new MapKeys.KeyDelta({
        add: [...add],
        remove: [...remove]
    })
}
