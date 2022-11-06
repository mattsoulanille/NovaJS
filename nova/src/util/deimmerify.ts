import { Entity } from "nova_ecs/entity";
import { current, Draft, isDraft } from "immer";

export function currentIfDraft<T>(val: T | Draft<T>): T {
    if (isDraft(val)) {
        return current(val) as T;
    }
    return val as T;
}

export function deImmerify(entity: Entity) {
    for (const [component, value] of entity.components) {
        entity.components.set(component, currentIfDraft(value));
    }
}
