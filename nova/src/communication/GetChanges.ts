import { MapKeys } from "novajs/nova/src/proto/protobufjs_bundle";
import { setDifference } from "../common/SetUtils";
import { TreeView, EngineView, compareChildren, compareFamilies } from "../engine/TreeView";

/**
 * Extracts changes that were marked on 
 * a state and unmarks them.
 */
export function getChanges<V, C extends string, T extends TreeView<V, C>>(state: T, newState: T): T | null {
    let changes: T;
    if (newState.changed) {
        changes = newState.withoutChildren() as T;
        changes.changed = true;
    } else {
        changes = newState.factory() as T;
    }

    // Update keys
    let hadKeyChanges = false
    compareFamilies<V, C, T>(state, newState, (family, newFamily, familyType) => {
        const changesFamilyChildrenView = changes.families[familyType].getChildrenView();
        changesFamilyChildrenView.keyDelta =
            getKeyDelta(family.keySet, newFamily.keySet);
        if (changesFamilyChildrenView.keyDelta.add?.length ||
            changesFamilyChildrenView.keyDelta.remove?.length) {
            hadKeyChanges = true;
        }
    });

    let hadChildChanges = false;
    compareChildren<V, C, T>(state, newState, (child, newChild, familyType, childId) => {
        const familyChildrenView = changes.families[familyType].getChildrenView();
        if (!newChild) {
            return; // Keys delta has already been computed
        }

        if (!child) {
            familyChildrenView.children.set(childId, newChild);
            hadChildChanges = true;
        } else {
            const childChanges = getChanges(child, newChild);
            if (childChanges) {
                hadChildChanges = true;
                familyChildrenView.children.set(childId, childChanges);
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
