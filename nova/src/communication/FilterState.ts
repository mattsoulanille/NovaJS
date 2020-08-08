import { TreeView, TreeType } from "../engine/TreeView";
import { MapKeys } from "novajs/nova/src/proto/protobufjs_bundle";

export function filterState<T extends TreeType>
    (state: TreeView<T>, include: (id: string) => boolean): TreeView<T> {

    const filtered = state.withoutChildren();

    for (const familyType of state.familyTypes) {
        const family = state.families[familyType];
        const filteredFamilyChildrenView =
            filtered.families[familyType];

        for (const [childId, child] of family) {
            if (include(childId)) {
                const filteredChild = filterState(child, include);
                filteredFamilyChildrenView.set(childId, filteredChild);
            }
        }

        const keyDelta = family.getMapKeys().keyDelta;
        if (keyDelta) {
            const filteredDelta = new MapKeys.KeyDelta();
            filteredDelta.add = keyDelta.add?.filter(include) ?? [];
            filteredDelta.remove = keyDelta.remove?.filter(include) ?? [];
            filteredFamilyChildrenView.keyDelta = filteredDelta;
        }
    }
    return filtered;
}
