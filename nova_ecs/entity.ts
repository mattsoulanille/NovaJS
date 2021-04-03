import { immerable } from "immer";
import { Component, UnknownComponent } from "./component";
import { ComponentMap } from "./component_map";

export type ComponentTypes = Set<UnknownComponent>;

export interface Entity {
    components: ComponentMap,
    name?: string;
}

/**
 * A convenience class for creating Entities
 */
export class EntityBuilder {
    [immerable] = true;
    components: ComponentMap;
    name?: string;

    constructor(entity?: Entity) {
        this.components = new Map([...entity?.components ?? []]) as ComponentMap;
        this.name = entity?.name;
    }

    build(): Entity {
        return {
            components: this.components,
            name: this.name,
        };
    }

    addComponent<Data>(component: Component<Data>, data: Data): this {
        this.components.set(component as UnknownComponent, data);
        return this;
    }

    removeComponent(component: Component<any>): this {
        this.components.delete(component);
        return this;
    }

    setName(name: string): this {
        this.name = name;
        return this;
    }
}
