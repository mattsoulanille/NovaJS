import * as t from 'io-ts';
import { set } from '../datatypes/set';
import { Component, UnknownComponent } from '../component';
import { map } from '../datatypes/map';
import { Entity } from '../entity';
import { Plugin } from '../plugin';
import { Resource } from '../resource';
import { isLeft } from 'fp-ts/Either';
import { Serializer, SerializerPlugin, SerializerResource } from './serializer_plugin';
import { setDifference } from '../utils';
import { EventMap } from '../event_map';
import { iterMaps } from './iter_maps';
import equal from 'fast-deep-equal';

export interface OptionalComponentDelta<Data> {//, Delta> {
    componentType: t.Type<Data, unknown, unknown>;
    // deltaType?: t.Type<Delta, unknown, unknown>;
    // getDelta?: (a: Data, b: Data) => Delta | undefined;
    // applyDelta?: (componentData: Data, delta: Delta) => Data | void;
}

export type ComponentDelta<Data> = {
    [K in keyof OptionalComponentDelta<Data>]-?:
    OptionalComponentDelta<Data>[K];
}

interface ComponentDeltaMap<K extends Component<any>>
    extends Map<K, ComponentDelta<unknown>> {
    get<Data>(key: Component<Data>): ComponentDelta<Data> | undefined;
    set<Data>(key: Component<Data>, val: ComponentDelta<Data>): this;
}

export const EntityDelta = t.partial({
    componentStates: map(t.string /* Component Name */, t.unknown /* State */),
    componentDeltas: map(t.string /* Component Name */, t.unknown /* Delta */),
    removeComponents: set(t.string /* Component Name */),
});

export type EntityDelta = t.TypeOf<typeof EntityDelta>;

const DeltaComponent = new Component<{
    components: Map<UnknownComponent, unknown>,
}>('DeltaComponent');

export class DeltaMaker {
    readonly componentDeltas: ComponentDeltaMap<UnknownComponent> = new Map();

    constructor(private serializer: Serializer) { }

    addComponent<Data>(component: Component<Data>,
        componentDelta: OptionalComponentDelta<Data>) {
        this.serializer.addComponent(component, componentDelta.componentType);
        this.componentDeltas.set(component, {
            componentType: componentDelta.componentType,
            // deltaType: componentDelta.deltaType ?? immerDeltaType,
            // getDelta: componentDelta.getDelta ?? immerGetDelta,
            // applyDelta: componentDelta.applyDelta ?? immerApplyDelta,
        });
    }

    // /**
    //  * Removes the immer draftedness of an entity's components.
    //  */
    // untrack(entity: Entity) {
    //     for (const [component, data] of entity.components) {
    //         if (isDraft(data)) {
    //             entity.components.set(component, finishDraft(data))
    //         }
    //     }
    //     entity.components.delete(DeltaComponent);
    // }

    /**
     * Compute the delta between `entity1` and `entity2` such that applying it
     * to `entity1` would make `entity1` have the same state as `entity2`.
     *
     * Current implementation sends each full component that has changed (and
     * add / remove commands). It does not send partials of components.
     */
    getDelta(entity1: Entity, entity2: Entity): EntityDelta | undefined {
        const componentStates = new Map<string, unknown>();
        //const componentDeltas = new Map<string, unknown>();
        const removedComponents = new Set<string>();
        for (const [component, data1, data2] of
             iterMaps(entity1.components, entity2.components)) {

            // Ignore unsupported components
            const componentDeltaFuncs = this.componentDeltas.get(component);
            if (!componentDeltaFuncs) {
                continue;
            }

            if (!entity2.components.has(component)) {
                // TODO: Change io-ts encoding to do component.name for you?
                removedComponents.add(component.name);
                continue;
            }

            if (!equal(data1, data2)) {
                // TODO: Change io-ts encoding to do component.name for you?
                componentStates.set(component.name, data2);
            }
        }
        
        // const entityComponents = new Set(entity.components.keys());

        // // Mark removed components as removed
        // const deltaComponentSet = new Set([...deltaComponent.components.keys()])
        // const removedComponents = new Set(
        //     [...setDifference(deltaComponentSet, entityComponents)]
        //         .map(component => component.name));
        // // Update the components list
        // deltaComponent.components = new Map(entity.components);

        const entityDelta: EntityDelta = {};
        if (componentStates.size > 0) {
            entityDelta.componentStates = componentStates;
        }
        // if (componentDeltas.size > 0) {
        //     entityDelta.componentDeltas = componentDeltas;
        // }
        if (removedComponents.size > 0) {
            entityDelta.removeComponents = removedComponents;
        }

        if (Object.keys(entityDelta).length > 0) {
            // TODO: Encode this here???
            return entityDelta;
        }
        return;
    }

    /**
     * Apply a delta to an entity. Returns the set of components that
     * the delta had but the entity was missing.
     */
    applyDelta(entity: Entity, delta: EntityDelta): Set<UnknownComponent> {
        const missingComponents: Set<UnknownComponent> = new Set();

        // Create new components from states
        for (const [componentName, componentState] of delta.componentStates ?? []) {
            const component = this.serializer.componentsByName.get(componentName);
            if (!component) {
                console.warn(`Missing component ${componentName}`);
                continue;
            }
            const componentType = this.serializer.componentTypes.get(component);
            if (!componentType) {
                console.warn(`Missing component type for ${componentName}`);
                continue;
            }
            const decoded = componentType.decode(componentState);
            if (isLeft(decoded)) {
                console.warn(`Failed to decode component ${componentName}`, decoded.left);
                continue;
            }
            // Use set instead of setSilent because this is a new component.
            entity.components.set(component, decoded.right);
        }

        // Apply component deltas
        // for (const [componentName, encodedDelta] of delta.componentDeltas ?? []) {
        //     const component = this.serializer.componentsByName.get(componentName);
        //     if (!component) {
        //         console.warn(`Missing component ${componentName}`);
        //         continue;
        //     }
        //     const componentDeltaFuncs = this.componentDeltas.get(component);
        //     if (!componentDeltaFuncs) {
        //         console.warn(`Missing component delta type for ${componentName}`);
        //         continue;
        //     }

        //     const { deltaType, applyDelta } = componentDeltaFuncs;

        //     const currentData = entity.components.get(component);
        //     if (!currentData) {
        //         // Cannot apply delta if the entity is missing the component.
        //         // Signal that the full state should be requested.
        //         missingComponents.add(component);
        //         continue;
        //     }

        //     const componentDelta = deltaType.decode(encodedDelta);
        //     if (isLeft(componentDelta)) {
        //         console.warn(`Failed to decode delta for component ${componentName}`);
        //         continue;
        //     }
        //     const newData = applyDelta(currentData, componentDelta.right);
        //     if (newData !== undefined) {
        //         // Use setSilent because this is an existing component.
        //         (entity.components as EventMap<UnknownComponent, unknown>)
        //             .set(component, newData, true /* Silent */);
        //     }
        // }

        // Remove components
        for (const componentName of delta.removeComponents ?? []) {
            const component = this.serializer.componentsByName.get(componentName);
            if (!component) {
                console.warn(`Missing component ${component}`);
                continue;
            }
            entity.components.delete(component);
        }

        return missingComponents;
    }
}

export const DeltaResource =
    new Resource<DeltaMaker>('DeltaResource');

export const DeltaPlugin: Plugin = {
    name: 'Delta',
    build(world) {
        if (!world.resources.has(SerializerResource)) {
            world.addPlugin(SerializerPlugin);
        }
        const serializer = world.resources.get(SerializerResource);
        if (!serializer) {
            throw new Error('Expected serializer resource to be present');
        }
        if (!world.resources.has(DeltaResource)) {
            world.resources.set(DeltaResource, new DeltaMaker(serializer));
        }
    }
}

// const Patch = t.intersection([t.type({
//     op: t.union([t.literal('replace'), t.literal('remove'), t.literal('add')]),
//     path: t.array(t.union([t.string, t.number]))
// }), t.partial({
//     value: t.unknown,
// })]);

// export const immerDeltaType = t.array(Patch);

// export function immerGetDelta<T>(_a: T, _b: T, patches: Patch[]) {
//     if (patches.length > 0) {
//         return patches;
//     }
//     return;
// }

// export function immerApplyDelta<T>(componentData: T, delta: Patch[]) {
//     return applyPatches(componentData, delta) as T;
// }
