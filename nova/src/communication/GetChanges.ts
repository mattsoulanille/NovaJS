import { compareChildren, compareFamilies, TreeType, TreeView } from "../engine/TreeView";
import { getKeyDelta } from "./getKeyDelta";

/**
 * Extracts changes that were marked on 
 * a state and unmarks them.
 */
export function getChanges<T extends TreeType>
    (state: TreeView<T>, newState: TreeView<T>): TreeView<T> | null {

    let changes: TreeView<T>;
    if (newState.changed) {
        changes = newState.withoutChildren();
    } else {
        changes = newState.factory();
        // Don't set changes.changed because
        // in this case, `changes` only exists to
        // hold its childrens' changes.
    }

    let hadKeyChanges = false;
    compareFamilies(state, newState, (family, newFamily, familyType) => {
        const changesFamily = changes.families[familyType];
        const familyKeys = family.getMapKeys();
        const newFamilyKeys = newFamily.getMapKeys();
        if (familyKeys.keyDelta || newFamilyKeys.keyDelta) {
            console.warn(`getChanges given state with key delta`);
        }
        changesFamily.keyDelta =
            getKeyDelta(familyKeys.keySet, newFamilyKeys.keySet)

        if (changesFamily.keyDelta?.add?.length ||
            changesFamily.keyDelta?.remove?.length) {
            hadKeyChanges = true;
        }
    });

    let hadChildChanges = false;
    compareChildren(state, newState,
        (child, newChild, familyType, childId) => {
            const family = changes.families[familyType];
            if (!newChild) {
                // The next state does not have this key, so
                // this delta should indicate it will be removed.
                // That's done by keyDelta, though, so there's
                // nothing to do here.
                return;
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
