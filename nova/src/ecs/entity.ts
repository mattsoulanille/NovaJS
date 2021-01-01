import { Component, UnknownComponent } from "./component";

interface EntityArgs {
    multiplayer?: boolean;
    uuid?: string;
    name?: string;
}

export type ComponentsMap = Map<UnknownComponent, unknown>;
export type ComponentTypes = Set<UnknownComponent>;

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
