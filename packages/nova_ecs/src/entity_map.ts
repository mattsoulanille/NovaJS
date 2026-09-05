import { UnknownComponent } from "./component.js";
import { Entity } from "./entity.js";
import { EventMap, SyncSubject } from "./event_map.js";


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
    /** Next `Entity.insertionOrder`; see that field. */
    private nextInsertionOrder = 0;

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
        // Likewise the only place insertionOrder is assigned. A
        // replacement inherits the position the Map keeps for its key;
        // a fresh uuid (or a deleted one re-inserted) is appended.
        const current = this.get(uuid);
        (entity as { insertionOrder: number }).insertionOrder =
            current !== undefined ? current.insertionOrder
                : this.nextInsertionOrder++;

        // Drop the previous subscriptions whenever there are any — also
        // when the SAME entity object is re-set: the record below is
        // overwritten either way, and subscriptions it no longer holds
        // would fire forever, duplicating every component event (#87).
        this.entityChangeUnsubscribe.get(uuid)?.unsubscribe();

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
        });

        // Every set — silent or not — emits setAlways, so forwarding
        // changeComponentAlways from here alone covers both cases.
        // (Forwarding it from the set subscriber too, as this used to,
        // made every non-silent component write emit it twice.)
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
