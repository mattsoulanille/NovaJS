import { MapKeys } from "novajs/nova/src/proto/protobufjs_bundle";
import { setDifference } from "../common/SetUtils";
import { compareChildren, compareFamilies, TreeType, TreeView } from "../engine/TreeView";

/**
 * Extracts changes that were marked on 
 * a state and unmarks them.
 */
export function getChanges<T extends TreeType>
    (state: TreeView<T>, newState: TreeView<T>): TreeView<T> | null {

    let changes: TreeView<T>;
    if (newState.changed) {
        changes = newState.withoutChildren();
        changes.changed = true;
    } else {
        changes = newState.factory();
    }

    // Update keys
    let hadKeyChanges = false
    compareFamilies(state, newState, (family, newFamily, familyType) => {
        const changesFamily = changes.families[familyType];
        changesFamily.keyDelta =
            getKeyDelta(family.keySet, newFamily.keySet);
        if (changesFamily.keyDelta.add?.length ||
            changesFamily.keyDelta.remove?.length) {
            hadKeyChanges = true;
        }
    });

    let hadChildChanges = false;
    compareChildren(state, newState,
        (child, newChild, familyType, childId) => {

            const family = changes.families[familyType];
            if (!newChild) {
                return; // Keys delta has already been computed
            }

            if (!child) {
                family.set(childId, newChild);
                hadChildChanges = true;
            } else {
                const childChanges = getChanges(child, newChild);
                if (childChanges) {
                    hadChildChanges = true;
                    family.set(childId, childChanges);
                }
            }
        });

    if (changes.changed || hadChildChanges || hadKeyChanges) {
        return changes;
    }

    return null;
}


function getKeyDelta(keys: MapKeys.IKeySet = {}, newKeys: MapKeys.IKeySet = {}) {
    const keysSet = new Set(keys.keys);
    const newKeysSet = new Set(newKeys.keys);
    const keysDelta = new MapKeys.KeyDelta();
    keysDelta.add = [...setDifference(newKeysSet, keysSet)];
    keysDelta.remove = [...setDifference(keysSet, newKeysSet)];
    return keysDelta;
}
