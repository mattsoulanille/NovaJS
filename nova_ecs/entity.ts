import { BinSet, BinSetC } from "./bin_set";
import { Component, UnknownComponent } from "./component";
import { ComponentMap } from "./component_map";
import { EventMap } from "./event_map";
import { Query } from "./query";

export type ComponentTypes = Set<UnknownComponent>;

/**
 * An `Entity` has a unique `uuid` and a map of `Components`. A `System` runs on
 * the `Entity` if the entity has every component that the system requires.
 */
export class Entity {
    readonly components: ComponentMap;
    readonly componentsBinSet: BinSet<UnknownComponent>;
    public supportedQueries = new Map<Query, boolean>();

    /**
     * Construct a new Entity. A common pattern is to use the chaining api
     * ```
     * const entity = new Entity().addComponent(...);
     * ```
     * However, you can also add components to the components map directly.
     * ```
     * entity.components.set(...);
     * ```
     * Note that although uuid is readonly in this class, it will be reassigned
     * when the entity is added to a world.
     */
    constructor(public name?: string, components?: ComponentMap,
                public readonly uuid: string = '') {
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

    /**
     * Set a component to a given value. Can be chained.
     */
    addComponent<Data>(component: Component<Data>, data: Data): this {
        this.components.set(component as UnknownComponent, data);
        return this;
    }

    /**
     * Remove a component. Can be chained.
     */
    removeComponent(component: Component<any>): this {
        this.components.delete(component);
        return this;
    }

    /**
     * Set the entity's name. This is used for debugging.
     */
    setName(name: string): this {
        this.name = name;
        return this;
    }

    /**
     * Get a map of components keyed by their name instead of by references to
     * `Component`s. For debugging only and not performant.
     */
    get componentsByName() {
        return new Map([...this.components].map(([component, value]) =>
            [component.name, value] as const));
    }
}
