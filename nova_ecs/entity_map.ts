import { Component } from "./component";
import { ComponentMapHandle } from "./component_map";
import { Entity } from "./entity";
import { CallWithDraft } from "./world";

export interface EntityMap extends Map<string, Entity> { }

export class EntityMapHandle implements EntityMap {
    constructor(private mutableEntities: EntityMap,
        private callWithDraft: CallWithDraft,
        // addComponnet adds a component as something the world knows about.
        // Doesn't add it to an entity.
        private addComponent: (component: Component<any, any, any, any>) => void) { }

    clear(): void {
        this.mutableEntities.clear();
        this.callWithDraft(draft => {
            draft.entities.clear();
        });
    }

    delete(uuid: string): boolean {
        if (uuid === 'singleton') {
            throw new Error('Can not delete the singleton entity');
        }
        return this.callWithDraft(draft => draft.entities.delete(uuid));
    }

    forEach(callbackfn: (value: Entity, key: string,
        map: Map<string, Entity>) => void, thisArg?: any): void {
        for (const [key, val] of this) {
            callbackfn.call(thisArg, val, key, this);
        }
    }

    get(uuid: string): Entity | undefined {
        return this.callWithDraft(draft => {
            const entity = draft.entities.get(uuid);
            if (!entity) {
                return undefined;
            }
            return {
                components: new ComponentMapHandle(uuid,
                    this.callWithDraft, this.addComponent),
                multiplayer: entity.multiplayer,
                name: entity.name,
            }
        });
    }

    has(key: string): boolean {
        return this.callWithDraft(draft =>
            draft.entities.has(key)
        );
    }

    set(uuid: string, entity: Entity): this {
        for (const [component] of entity.components) {
            this.addComponent(component);
        }

        this.callWithDraft(draft => {
            draft.entities.set(uuid, entity);
        });

        return this;
    }

    get size(): number {
        return this.callWithDraft(draft => draft.entities.size);
    }

    [Symbol.iterator](): IterableIterator<[string, Entity]> {
        return this.entries();
    }

    *entries(): IterableIterator<[string, Entity]> {
        for (const key of this.keys()) {
            yield [key, this.get(key)!];
        }
    }

    *keys(): IterableIterator<string> {
        yield* this.callWithDraft(draft => {
            return [...draft.entities.keys()];
        });
    }

    *values(): IterableIterator<Entity> {
        for (const key of this.keys()) {
            yield this.get(key)!;
        }
    }

    [Symbol.toStringTag]: string;
}
