import { BinSet, BinSetC } from "./bin_set";
import { Component, UnknownComponent } from "./component";
import { ComponentMap } from "./component_map";
import { EventMap } from "./event_map";
import { Query } from "./query";

export type ComponentTypes = Set<UnknownComponent>;

export class Entity {
    readonly components: ComponentMap;
    readonly componentsBinSet: BinSet<UnknownComponent>;
    public supportedQueries = new Map<Query, boolean>();
    public readonly uuid: string = '';

    constructor(public name?: string, components?: ComponentMap) {
        this.components = new EventMap(components ?? []) as ComponentMap;

        this.componentsBinSet = BinSetC.of(new Set(this.components.keys()));

        const clearSupportedQueries = () => {
            this.supportedQueries.clear();
        }
        this.components.events.add.subscribe(clearSupportedQueries);
        this.components.events.add.subscribe(([component]) => {
            this.componentsBinSet.add(component);
        });

        this.components.events.delete.subscribe(clearSupportedQueries);
        this.components.events.delete.subscribe((deleted) => {
            for (const [component] of deleted) {
                this.componentsBinSet.delete(component);
            }
        });
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

    get componentsByName() {
        // For debugging only. Not performant.
        return new Map([...this.components].map(([component, value]) =>
            [component.name, value] as const));
    }
}
