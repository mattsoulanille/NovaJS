import { Immutable } from "immer";
import { v4 } from "uuid";
import { Component } from "./component";
import { ComponentMap, ComponentMapHandle } from "./component_map";
import { Entity } from "./entity";
import { CallWithDraft, EntityState } from "./world";


export interface EntityHandle {
    uuid: string;
    components: ComponentMap;
}

export type EntityWithUuid = Entity & { uuid: string };

export interface EntityMap extends Map<string, Entity> { }

export class EntityMapHandle implements EntityMap {
    constructor(private callWithDraft: CallWithDraft,
        // addComponnet adds a component as something the world knows about.
        // Doesn't add it to an entity.
        private addComponent: (component: Component<any, any, any, any>) => void,
        private entityChanged: (entity: Immutable<EntityState>) => void,
        private removedEntity: (entity: Immutable<EntityState>) => void,
        private freeze: boolean) { }

    clear(): void {
        this.callWithDraft(draft => {
            draft.entities.clear();
        });
    }

    delete(key: string): boolean {
        if (key === 'singleton') {
            throw new Error('Can not delete the singleton entity');
        }
        return this.callWithDraft(draft => {
            const toDelete = draft.entities.get(key);
            if (!toDelete) {
                return false;
            }
            const deleted = draft.entities.delete(key);
            if (deleted) {
                this.removedEntity(toDelete);
            }
            return deleted;
        });
    }

    forEach(callbackfn: (value: Entity, key: string,
        map: Map<string, Entity>) => void, thisArg?: any): void {
        for (const [key, val] of this) {
            callbackfn.call(thisArg, val, key, this);
        }
    }

    get(uuid: string): EntityWithUuid | undefined {
        return this.callWithDraft(draft => {
            const entity = draft.entities.get(uuid);
            if (!entity) {
                console.log('no entity');
                return undefined;
            }
            return {
                uuid,
                components: new ComponentMapHandle(uuid,
                    this.callWithDraft,
                    this.addComponent,
                    this.entityChanged,
                    this.freeze),
                multiplayer: entity.multiplayer,
                name: entity.name,
            }
        })
    }

    has(key: string): boolean {
        return this.callWithDraft(draft =>
            draft.entities.has(key)
        );
    }

    add(entity: Entity) {
        const uuid = entity.uuid ?? v4();
        this.set(uuid, entity);
        return this.get(uuid);
    }

    set(uuid: string, entity: Entity): this {
        if (entity.uuid && entity.uuid !== uuid) {
            throw new Error(`Refusing to set key ${uuid} to entity with uuid ${entity.uuid}`);
        }

        for (const [component] of entity.components) {
            this.addComponent(component);
        }

        const entityState: EntityState = {
            components: entity.components,
            multiplayer: entity.multiplayer,
            uuid,
            name: entity.name
        };

        this.callWithDraft(draft => {
            draft.entities.set(uuid, entityState);
        });

        this.entityChanged(entityState);
        return this;
    }

    get size(): number {
        return this.callWithDraft(draft => {
            return draft.entities.size;
        });
    }

    [Symbol.iterator](): IterableIterator<[string, EntityWithUuid]> {
        return this.entries();
    }

    *entries(): IterableIterator<[string, EntityWithUuid]> {
        for (const key of this.keys()) {
            yield [key, this.get(key)!];
        }
    }

    *keys(): IterableIterator<string> {
        yield* this.callWithDraft(draft => {
            return [...draft.entities.keys()];
        });
    }

    *values(): IterableIterator<EntityWithUuid> {
        for (const key of this.keys()) {
            yield this.get(key)!;
        }
    }

    [Symbol.toStringTag]: string;
}
