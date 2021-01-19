import { Component, UnknownComponent } from "./component";
import { ComponentMap } from "./component_map";

interface EntityArgs {
    multiplayer?: boolean;
    uuid?: string;
    name?: string;
}

export type ComponentTypes = Set<UnknownComponent>;

export interface Entity {
    components: ComponentMap,
    multiplayer: boolean;
    uuid?: string;
    name?: string;
}

// This is a handle for the entity that the world creates.
export class EntityClass {
    components: ComponentMap = new Map();
    multiplayer: boolean;
    uuid?: string;
    name?: string;

    constructor(args?: EntityArgs) {
        this.multiplayer = args?.multiplayer ?? true;
        this.uuid = args?.uuid;
        this.name = args?.name;
    }

    addComponent<Data>(component: Component<Data, any, any, any>, data: Data): this {
        this.components.set(component as UnknownComponent, data);
        return this;
    }

    removeComponent(component: Component<any, any, any, any>) {
        this.components.delete(component);
        return this;
    }

    toString() {
        return `Entity(${this.name ?? this.uuid})`;
    }
}
