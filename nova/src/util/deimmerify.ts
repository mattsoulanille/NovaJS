import { Entity } from "nova_ecs/entity";
import { currentIfDraft } from "nova_ecs/utils";

export function deImmerify(entity: Entity) {
    for (const [component, value] of entity.components) {
        entity.components.set(component, currentIfDraft(value));
    }
}
