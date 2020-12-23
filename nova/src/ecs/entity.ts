import produce, { enableMapSet, Immutable } from "immer";
import { BehaviorSubject } from "rxjs";
import { v4 } from "uuid";
import { Component } from "./component";

interface EntityArgs {
    multiplayer?: boolean;
    uuid?: string;
    name?: string;
}

export type ComponentsMap = Map<Component<unknown, unknown>, unknown>;
export type ComponentTypes = Set<Component<unknown, unknown>>;

// This is a handle for the entity that the world creates.
export class Entity {
    components: ComponentsMap = new Map();
    multiplayer: boolean;
    uuid?: string;
    name?: string;

    constructor(args?: EntityArgs) {
        this.multiplayer = args?.multiplayer ?? true;
        this.uuid = args?.uuid;
        this.name = args?.name;
    }

    addComponent<Data>(component: Component<Data, any>, data: Data): this {
        this.components.set(component as Component<unknown, unknown>, data);
        return this;
    }

    removeComponent(component: Component<any, any>) {
        this.components.delete(component);
        return this;
    }

    toString() {
        return `Entity(${this.name ?? this.uuid})`;
    }
}
