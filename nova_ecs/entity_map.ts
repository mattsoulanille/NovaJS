import { ComponentMap } from "./component_map";
import { Entity } from "./entity";
import { EventMap, SyncSubject } from "./event_map";


export interface EntityMap extends Map<string, Entity> { }

export class EntityMapWrapped extends EventMap<string, Entity> {
    events!: EventMap<string, Entity>['events'] & {
        change: SyncSubject<[string, Entity]>
    };

    private entityChangeUnsubscribe = new Map<string,
        { unsubscribe: () => void }>();

    constructor() {
        super();
        this.events.change = new SyncSubject();
    }


    set(uuid: string, entity: Entity) {
        const current = this.get(uuid);
        if (current && current !== entity) {
            this.entityChangeUnsubscribe.get(uuid)?.unsubscribe();
        }

        // Set components to an EventMap
        const componentsEventMap = new EventMap(entity.components);
        const componentEvents = componentsEventMap.events;
        entity.components = componentsEventMap as ComponentMap;

        // Subscribe to changes from the entity
        const reportChange = () => {
            this.events.change.next([uuid, entity]);
        }

        const s1 = componentEvents.add.subscribe(reportChange);
        const s2 = componentEvents.delete.subscribe(reportChange);

        this.entityChangeUnsubscribe.set(uuid, {
            unsubscribe() {
                s1.unsubscribe();
                s2.unsubscribe();
            }
        });

        // Set the entity
        return super.set(uuid, entity);
    }

    delete(key: string) {
        if (key === 'singleton') {
            throw new Error('Can not delete the singleton entity');
        }
        this.entityChangeUnsubscribe.get(key)?.unsubscribe();
        return super.delete(key);
    }

    clear() {
        for (const { unsubscribe } of this.entityChangeUnsubscribe.values()) {
            unsubscribe();
        }
        super.clear();
    }
}
