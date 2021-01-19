import { Draft } from "immer";
import { CommandsInterface, State } from "./world";

export function makeCommands(draft: Draft<State>): CommandsInterface {
    return {
        addEntity: (entity) => {
            return this.addEntityToDraft(entity, false, (callback) => {
                return callback(draft);
            });
        },
        removeEntity: (entityOrUuid) => {
            return this.removeEntityFromDraft(entityOrUuid, (callback) => {
                return callback(draft);
            });
        },
        components: this.nameComponentMap
    }
}

