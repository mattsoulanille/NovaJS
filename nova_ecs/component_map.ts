import { current, Draft, isDraft } from "immer";
import { Component, UnknownComponent } from "./component";
import { CallWithDraft, State } from "./world";

export interface ReadonlyComponentMap extends ReadonlyMap<UnknownComponent, unknown> {
    get<Data>(component: Component<Data, any, any, any>): Data | undefined;
}

export interface ComponentMap extends Map<UnknownComponent, unknown> {
    get<Data>(component: Component<Data, any, any, any>): Data | undefined;
    set<Data>(component: Component<Data, any, any, any>, data: Data): this;
    delete(component: Component<any, any, any, any>): boolean;
}

export class ComponentMapHandle implements ComponentMap {
    constructor(private entityUuid: string, private callWithDraft: CallWithDraft,
        // addComponnet adds a component as something the world knows about.
        // Doesn't add it to an entity.
        private addComponent: (component: Component<any, any, any, any>) => void) { }


    private getEntity(draft: Draft<State>) {
        const entity = draft.entities.get(this.entityUuid);
        if (!entity) {
            throw new Error(`Entity '${this.entityUuid}' not in the world`);
        }
        return entity;
    }

    clear(): void {
        this.callWithDraft(draft => {
            this.getEntity(draft).components.clear();
        });
    }

    delete(key: Component<any, any, any, any>): boolean {
        return this.callWithDraft(
            draft => this.getEntity(draft).components.delete(key));
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
            // Since this is used outside of a current step of the system, we need to
            // freeze the component's data so it isn't a proxy (which gets revoked
            // once callWithDraft is done.
            // TODO: Proxy this behind a draft editor so changes to it can edit the
            // draft?
            if (isDraft(data)) {
                return current(data);
            } else {
                return data;
            }
        });
    }

    has(key: UnknownComponent): boolean {
        return this.callWithDraft(
            draft => this.getEntity(draft).components.has(key))
    }

    set<Data>(component: Component<Data, any, any, any>, data: Data): this {
        return this.callWithDraft(draft => {
            this.addComponent(component);
            this.getEntity(draft)
                .components.set(component as UnknownComponent, data);
            return this;
        });
    }

    get size() {
        return this.callWithDraft(draft =>
            this.getEntity(draft).components.size);
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
        yield* this.callWithDraft(
            draft => [...this.getEntity(draft).components.keys()]);
    }

    *values(): IterableIterator<unknown> {
        for (const key of this.keys()) {
            yield this.get(key);
        }
    }

    [Symbol.toStringTag]: string;
}
