import { current, Draft, Immutable, isDraft } from "immer";
import { Component, UnknownComponent } from "./component";
import { CallWithDraft, EntityState, State } from "./world";

export interface ReadonlyComponentMap extends ReadonlyMap<UnknownComponent, unknown> {
    get<Data>(component: Component<Data, any, any, any>): Data | undefined;
}

export interface ComponentMap extends Map<UnknownComponent, unknown> {
    get<Data>(component: Component<Data, any, any, any>): Data | undefined;
    set<Data>(component: Component<Data, any, any, any>, data: Data): this;
}

export class ComponentMapHandle implements Map<UnknownComponent, unknown> {
    constructor(private entityUuid: string,
        private callWithDraft: CallWithDraft,
        private addComponent: (component: Component<any, any, any, any>) => void,
        private entityChanged: (entity: Immutable<EntityState>) => void,
        private freeze: boolean) { }

    private getEntity(draft: Draft<State>) {
        const entity = draft.entities.get(this.entityUuid);
        if (!entity) {
            throw new Error(`Entity '${this.entityUuid}' not in the world`);
        }
        return entity;
    }

    clear(): void {
        this.callWithDraft(draft => {
            const entity = this.getEntity(draft);
            entity.components.clear();
        });
    }

    delete(key: Component<any, any, any, any>): boolean {
        return this.callWithDraft(draft => {
            const entity = this.getEntity(draft);
            const result = entity.components.delete(key);
            this.entityChanged(entity);
            return result;
        });
    }

    forEach(callbackfn: (value: unknown, key: UnknownComponent,
        map: Map<UnknownComponent, unknown>) => void, thisArg?: any): void {
        for (const [key, val] of this) {
            callbackfn.call(thisArg, val, key, this);
        }
    }

    get<Data>(key: Component<Data, any, any, any>): Data | undefined {
        return this.callWithDraft(draft => {
            const entity = this.getEntity(draft);
            const data = entity.components.get(key as UnknownComponent) as Data;
            // In the case of 
            if (this.freeze && isDraft(data)) {
                return current(data);
            } else {
                return data;
            }
        });
    }

    has(key: UnknownComponent): boolean {
        return this.callWithDraft(draft => {
            const entity = this.getEntity(draft);
            return entity.components.has(key);
        });
    }

    set<Data>(component: Component<Data, any, any, any>, data: Data): this {
        return this.callWithDraft(draft => {
            const entity = this.getEntity(draft);
            this.addComponent(component);
            entity.components.set(component as UnknownComponent, data);
            this.entityChanged(entity);
            return this;
        });
    }

    get size() {
        return this.callWithDraft(draft => {
            const entity = this.getEntity(draft);
            return entity.components.size;
        });
    }

    [Symbol.iterator](): IterableIterator<[UnknownComponent, unknown]> {
        return this.entries();
    }

    *entries(): IterableIterator<[UnknownComponent, unknown]> {
        for (const key of this.keys()) {
            yield [key, this.get(key)];
        }
    }

    *keys(): IterableIterator<UnknownComponent> {
        yield* this.callWithDraft(draft => {
            const entity = this.getEntity(draft);
            return [...entity.components.keys()];
        });
    }

    *values(): IterableIterator<unknown> {
        for (const key of this.keys()) {
            yield this.get(key);
        }
    }

    [Symbol.toStringTag]: string;
}
