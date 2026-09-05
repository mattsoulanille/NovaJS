import { BinSet, BinSetC } from "./bin_set.js";
import { Component, UnknownComponent } from "./component.js";
import { ComponentMap } from "./component_map.js";
import { EventMap } from "./event_map.js";

export type ComponentTypes = Set<UnknownComponent>;

/**
 * An `Entity` has a unique `uuid` and a map of `Components`. A `System` runs on
 * the `Entity` if the entity has every component that the system requires.
 */
export class Entity {
    readonly components: ComponentMap;
    readonly componentsBinSet: BinSet<UnknownComponent>;
    /**
     * Position of this entity in its world's entity map, as a
     * monotonically increasing sequence assigned by
     * `EntityMapWithEvents.set` (like `uuid`, never set elsewhere): a
     * uuid's first insertion takes the next number, a replacement under
     * an existing uuid inherits the previous entity's (a Map keeps the
     * key's position), and a delete + re-insert takes a fresh one (the
     * Map appends). Query results are iterated in this order, so
     * per-entity system order is a function of world state alone —
     * not of the order in which entities gained a query's components
     * (#41). Snapshot restore re-inserts entities in world order, so
     * a rolled-back or late-joined world reproduces the same relative
     * sequence.
     */
    readonly insertionOrder: number = -1;

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

        this.components.events.add.subscribe(([component]) => {
            this.componentsBinSet.add(component);
        });

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
