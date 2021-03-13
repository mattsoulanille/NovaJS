import { ComponentMap } from "./component_map";
import { Entity } from "./entity";
import { EventMap } from "./event_map";


export interface EntityMap extends Map<string, Entity> { }


export class EntityMapWrapped extends EventMap<string, Entity> {
    delete(key: string) {
        if (key === 'singleton') {
            throw new Error('Can not delete the singleton entity');
        }
        return super.delete(key);
    }
}
