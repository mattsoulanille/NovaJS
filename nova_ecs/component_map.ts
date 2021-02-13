import { Draft } from "immer";
import { Component, UnknownComponent } from "./component";
import { MutableImmutableMapHandle } from "./mutable_immutable_map_handle";
import { currentIfDraft } from "./utils";
import { CallWithDraft, State } from "./world";

export interface ReadonlyComponentMap extends ReadonlyMap<UnknownComponent, unknown> {
    get<Data>(component: Component<Data, any, any, any>): Data | undefined;
}

export interface ComponentMap extends Map<UnknownComponent, unknown> {
    get<Data>(component: Component<Data, any, any, any>): Data | undefined;
    set<Data>(component: Component<Data, any, any, any>, data: Data): this;
    delete(component: Component<any, any, any, any>): boolean;
}

export class ComponentMapHandle
    extends MutableImmutableMapHandle<UnknownComponent, unknown>
    implements ComponentMap {

    constructor(private entityUuid: string, callWithDraft: CallWithDraft<State>,
        private addComponent: (component: Component<any, any, any, any>) => void) {
        super(new Map(), (callback) => callWithDraft(
            draft => callback(this.getEntityComponents(draft))),
            component => component.mutable,
            currentIfDraft);
    }

    private getEntityComponents(draft: Draft<State>) {
        const entity = draft.entities.get(this.entityUuid);
        if (!entity) {
            throw new Error(`Entity '${this.entityUuid}' not in the world`);
        }
        return entity.components;
    }

    get<Data>(component: Component<Data, any, any, any>): Data | undefined {
        return super.get(component as UnknownComponent) as Data;
    };

    set<Data>(component: Component<Data, any, any, any>, data: Data): this {
        this.addComponent(component);
        return super.set(component as UnknownComponent, data);
    };

    delete(component: Component<any, any, any, any>): boolean {
        return super.delete(component as UnknownComponent);
    };
}
