import { setDifference } from "../common/SetUtils";
import { TreeView, TreeType } from "../engine/TreeView";
import { MapKeys } from "novajs/nova/src/proto/protobufjs_bundle";

export function filterState<T extends TreeType>
    (state: TreeView<T>, include: (id: string) => boolean): TreeView<T> {

    const filtered = state.withoutChildren();

    for (const familyType of state.familyTypes) {
        const family = state.families[familyType];
        const filteredFamilyChildrenView =
            filtered.families[familyType];

        const toRemove: string[] = [];

        for (const [childId, child] of family) {
            if (include(childId)) {
                const filteredChild = filterState(child, include);
                filteredFamilyChildrenView.set(childId, filteredChild);
            } else {
                toRemove.push(childId);
            }
        }

        if (family.keySet?.keys) {
            filteredFamilyChildrenView.keySet = new MapKeys.KeySet();
            filteredFamilyChildrenView.keySet.keys = [...setDifference(
                new Set(family.keySet.keys), new Set(toRemove))];
        }
    }
    return filtered;
}
