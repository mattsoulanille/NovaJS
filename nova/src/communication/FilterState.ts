import { setDifference } from "../common/SetUtils";
import { TreeView } from "../engine/TreeView";
import { MapKeys } from "novajs/nova/src/proto/protobufjs_bundle";

export function filterState<V, C extends string, T extends TreeView<V, C>>(state: T, include: (id: string) => boolean): T {
    const filtered = state.withoutChildren() as T;

    for (const familyType of state.familyTypes) {
        const familyChildrenView = state.families[familyType].getChildrenView();
        const filteredFamilyChildrenView =
            filtered.families[familyType].getChildrenView();

        const toRemove: string[] = [];

        for (const [childId, child] of familyChildrenView.children) {
            if (include(childId)) {
                const filteredChild = filterState(child, include);
                filteredFamilyChildrenView.children.set(childId, filteredChild);
            } else {
                toRemove.push(childId);
            }
        }

        if (familyChildrenView.keySet?.keys) {
            filteredFamilyChildrenView.keySet = new MapKeys.KeySet();
            filteredFamilyChildrenView.keySet.keys = [...setDifference(
                new Set(familyChildrenView.keySet.keys), new Set(toRemove))];
        }
    }
    return filtered;
}
