import { UnknownComponent } from "./component";
import { Entity } from "./entity";
import { EventMap, SyncSubject } from "./event_map";


export interface EntityMap extends Map<string, Entity> { }

export class EntityMapWithEvents extends EventMap<string, Entity> implements EntityMap {
    declare events: EventMap<string, Entity>['events'] & {
        addComponent: SyncSubject<[string, Entity, UnknownComponent]>,
        deleteComponent: SyncSubject<[string, Entity, UnknownComponent]>,
        changeComponent: SyncSubject<[string, Entity, UnknownComponent]>,
        // Always emits on a changed component, even if changed silently.
        // e.g. delta component sets silently to avoid triggering providers.
        changeComponentAlways: SyncSubject<[string, Entity, UnknownComponent]>,
    };

    private entityChangeUnsubscribe = new Map<string,
        { unsubscribe: () => void }>();

    constructor() {
        super();
        this.events.addComponent = new SyncSubject();
        this.events.deleteComponent = new SyncSubject();
        this.events.changeComponent = new SyncSubject();
        this.events.changeComponentAlways = new SyncSubject();
    }

    override set(uuid: string, entity: Entity) {
        // This is the only place where the entity's uuid should be set.
        // 'uuid' is marked as readonly to avoid accidentally setting it elsewhere.
        (entity as { uuid: string }).uuid = uuid;

        const current = this.get(uuid);
        if (current && current !== entity) {
            this.entityChangeUnsubscribe.get(uuid)?.unsubscribe();
        }

        const componentEvents = entity.components.events;

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
            this.events.changeComponentAlways.next([uuid, entity, component]);
        });

        const s4 = componentEvents.setAlways.subscribe(([component]) => {
            this.events.changeComponentAlways.next([uuid, entity, component]);
        });

        this.entityChangeUnsubscribe.set(uuid, {
            unsubscribe() {
                s1.unsubscribe();
                s2.unsubscribe();
                s3.unsubscribe();
                s4.unsubscribe();
            }
        });

        // Set the entity
        return super.set(uuid, entity);
    }

    override delete(key: string) {
        if (key === 'singleton') {
            throw new Error('Can not delete the singleton entity');
        }
        this.entityChangeUnsubscribe.get(key)?.unsubscribe();
        this.entityChangeUnsubscribe.delete(key);
        return super.delete(key);
    }

    override clear() {
        for (const { unsubscribe } of this.entityChangeUnsubscribe.values()) {
            unsubscribe();
        }
        super.clear();
    }
}
