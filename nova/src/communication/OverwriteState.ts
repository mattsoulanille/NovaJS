import { TreeView, compareChildren, compareFamilies } from "../engine/TreeView";
import { setDifference, setUnion, setIntersection } from "../common/SetUtils";
import { MapKeys } from "novajs/nova/src/proto/protobufjs_bundle";



/**
 * Overwrites one state on top of another. 
 */
export function overwriteState<V, C extends string, T extends TreeView<V, C>>(state: T, overwriteWith: T) {

    Object.assign(state.value, overwriteWith.withoutChildren().value);

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
                    family.children.delete(key);
                }
            }

            const add = keyDelta.add;
            if (add) {
                const keys = new Set(family.keySet?.keys ?? []);
                family.keySet = family.keySet ?? new MapKeys.KeySet();
                const addSet = new Set(add);
                family.keySet.keys = [...setUnion(keys, addSet)];
                for (const key of addSet) {
                    family.children.set(key, family.childFactory());
                }
            }
        }
    });

    // Update existing objects
    compareChildren<V, C, T>(state, overwriteWith, (child, overwriteChild, familyType, childId) => {
        const familyChildrenView = state.families[familyType].getChildrenView();
        if (!child) {
            //console.warn(`child ${childId} missing`);
            child = familyChildrenView.childFactory();
            familyChildrenView.children.set(childId, child);
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
