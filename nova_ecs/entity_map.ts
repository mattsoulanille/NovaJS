import { UnknownComponent } from "./component";
import { ComponentMap } from "./component_map";
import { Entity } from "./entity";
import { EventMap, SyncSubject } from "./event_map";


export interface EntityMap extends Map<string, Entity> { }

export class EntityMapWrapped extends EventMap<string, Entity> implements EntityMap {
    declare events: EventMap<string, Entity>['events'] & {
        addComponent: SyncSubject<[string, Entity, UnknownComponent]>,
        deleteComponent: SyncSubject<[string, Entity, UnknownComponent]>,
        changeComponent: SyncSubject<[string, Entity, UnknownComponent]>,
    };

    private entityChangeUnsubscribe = new Map<string,
        { unsubscribe: () => void }>();

    constructor() {
        super();
        this.events.addComponent = new SyncSubject();
        this.events.deleteComponent = new SyncSubject();
        this.events.changeComponent = new SyncSubject();
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

        const s1 = componentEvents.add.subscribe(([component]) => {
            this.events.addComponent.next([uuid, entity, component]);
        });
        const s2 = componentEvents.delete.subscribe((components) => {
            for (const [component] of components) {
                this.events.deleteComponent.next([uuid, entity, component]);
            }
        });
        const s3 = componentEvents.set.subscribe(([component]) => {
            this.events.changeComponent.next([uuid, entity, component]);
        });

        this.entityChangeUnsubscribe.set(uuid, {
            unsubscribe() {
                s1.unsubscribe();
                s2.unsubscribe();
                s3.unsubscribe();
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
