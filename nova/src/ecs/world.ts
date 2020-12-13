import v4 from "uuid/v4";
import { Component } from "./component";
import { Entity } from "./entity";
import { Query, QueryResults } from "./query";
import { Resource } from "./resource";
import { System } from "./system";

type ComponentDataPair<T> = [Component<T, unknown>, T];

// Returns true if a is a subset of b
function subset(a: Set<unknown>, b: Set<unknown>) {
    if (a.size > b.size) {
        return false;
    }

    for (const element of a) {
        if (!b.has(element)) {
            return false;
        }
    }
    return true;
}

export class World {
    private entities = new Map<string /* UUID */, Entity<Component<any, any>>>();
    private resources = new Map<Resource<unknown, unknown>, unknown>();
    private systems = new Set<System>();

    constructor() { }

    addEntity(components: Iterable<ComponentDataPair<unknown>>, multiplayer = true) {
        // TODO: Pass through UUIDs?
        const entity = new Entity(new Map(components), multiplayer, v4());
        this.entities.set(entity.uuid, entity);
    }

    addResource<Data, Delta>(resource: Resource<Data, Delta>, value: Data) {
        // TODO: Fix these types. Maybe pass resources in the World constructor?
        this.resources.set(resource as Resource<unknown, unknown>, value);
    }

    addSystem(system: System) {
        for (const resource of system.resources) {
            if (!this.resources.has(resource)) {
                throw new Error(
                    `World is missing ${resource} needed for ${system}`);
            }
        }
        this.systems.add(system);
    }

    step() {
        // TODO: Cache this info
        for (const system of this.systems) {
            for (const entity of this.getMatchingEntities(system.components)) {
                const args = system.args.map((arg) => {
                    if (arg instanceof Resource) {
                        if (!this.resources.has(arg)) {
                            throw new Error(`Missing resource ${arg}`);
                        }
                        return this.resources.get(arg);
                    } else if (arg instanceof Component) {
                        return entity.components.get(arg);
                    } else { // query
                        return this.fulfillQuery(arg);
                    }
                });

                // TODO: system.step accepts ...any[]. Fix this.
                system.step(...args);
            }
        }
    }

    private getMatchingEntities<C extends Component<any, any>>(components: Set<C>) {
        //Entity<C>[] {
        return [...this.entities.values()].filter(
            entity => subset(components, new Set(entity.components.keys())))
    }

    private fulfillQuery<C extends readonly Component<any, any>[]>(query: Query<C>): QueryResults<Query<C>> {
        const entities = this.getMatchingEntities(new Set(query.components));

        return entities.map(entity =>
            query.components.map(component => entity.components.get(component))
        ) as unknown as QueryResults<Query<C>>;
    }
}
