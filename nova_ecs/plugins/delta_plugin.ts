import { applyPatches, createDraft, Draft, enablePatches, finishDraft, isDraft, original, setAutoFreeze } from 'immer';
import { Objectish, Patch } from 'immer/dist/internal';
import * as t from 'io-ts';
import { set } from '../datatypes/set';
import { Component, UnknownComponent } from '../component';
import { map } from '../datatypes/map';
import { Entity } from '../entity';
import { Plugin } from '../plugin';
import { Resource } from '../resource';
import { isLeft } from 'fp-ts/lib/Either';
import { Serializer, SerializerPlugin, SerializerResource } from './serializer_plugin';
import { setDifference } from '../utils';


export interface OptionalComponentDelta<Data, Delta> {
    componentType: t.Type<Data, unknown, unknown>;
    deltaType?: t.Type<Delta, unknown, unknown>;
    getDelta?: (a: Data, b: Data, patches: Patch[]) => Delta | undefined;
    applyDelta?: (componentData: Data, delta: Delta) => Data | void;
}

export type ComponentDelta<Data, Delta> = {
    [K in keyof OptionalComponentDelta<Data, Delta>]-?:
    OptionalComponentDelta<Data, Delta>[K];
}

interface ComponentDeltaMap<K extends Component<any>>
    extends Map<K, ComponentDelta<unknown, unknown>> {
    get<Data>(key: Component<Data>): ComponentDelta<Data, unknown> | undefined;
    set<Data>(key: Component<Data>, val: ComponentDelta<Data, any>): this;
}

export const EntityDelta = t.partial({
    componentStates: map(t.string /* Component Name */, t.unknown /* State */),
    componentDeltas: map(t.string /* Component Name */, t.unknown /* Delta */),
    removeComponents: set(t.string /* Component Name */),
});

export type EntityDelta = t.TypeOf<typeof EntityDelta>;

enablePatches();
setAutoFreeze(false);

const DeltaComponent = new Component<{
    components: Set<UnknownComponent>,
}>('DeltaComponent');

export class DeltaMaker {
    readonly componentDeltas: ComponentDeltaMap<UnknownComponent> = new Map();

    constructor(private serializer: Serializer) { }

    addComponent<Data, Delta>(component: Component<Data>,
        componentDelta: OptionalComponentDelta<Data, Delta>) {
        this.serializer.addComponent(component, componentDelta.componentType);
        this.componentDeltas.set(component, {
            componentType: componentDelta.componentType,
            deltaType: componentDelta.deltaType ?? immerDeltaType,
            getDelta: componentDelta.getDelta ?? immerGetDelta,
            applyDelta: componentDelta.applyDelta ?? immerApplyDelta,
        });
    }

    /**
     * Removes the immer draftedness of an entity's components.
     */
    untrack(entity: Entity) {
        for (const [component, data] of entity.components) {
            if (isDraft(data)) {
                entity.components.set(component, finishDraft(data))
            }
        }
        entity.components.delete(DeltaComponent);
    }

    /**
     * Gets the changes that have been made to an entity since the last
     * call to `getDelta`. Uses Immer to track changes on components.
     */
    getDelta(entity: Entity): EntityDelta | undefined {
        const componentStates = new Map<string, unknown>();
        const componentDeltas = new Map<string, unknown>();

        if (!entity.components.has(DeltaComponent)) {
            entity.components.set(DeltaComponent, { components: new Set<UnknownComponent>() });
        }
        const deltaComponent = entity.components.get(DeltaComponent)!;

        for (const [component, data] of entity.components) {
            // Ignore unsupported components
            const componentDeltaFuncs = this.componentDeltas.get(component);
            if (!componentDeltaFuncs) {
                continue;
            }

            // An immer draft to be used in place of the component's data
            // for tracking changes between calls to getDelta.
            let newDraft: Draft<unknown>;

            if (!deltaComponent.components.has(component)) {
                // Use the full state for components we haven't seen before
                const componentType = this.serializer.componentTypes.get(component);
                if (!componentType) {
                    throw new Error(`Expected to have component type for ${component.name}`);
                }
                componentStates.set(component.name, componentType.encode(data));
                newDraft = createDraft(data as Objectish);
            } else {
                // Use deltas for the remaining components.
                const { getDelta, deltaType } = componentDeltaFuncs;

                if (isDraft(data)) {
                    // If it's not a draft, there's no delta.
                    const originalData = original(data);

                    let patches: Patch[] | undefined;
                    const currentData = finishDraft(data, (forwardPatches) => {
                        patches = forwardPatches
                    });
                    if (!patches) {
                        throw new Error('Got no patches when calling delta');
                    }

                    newDraft = createDraft(currentData as Objectish);
                    const delta = getDelta(originalData, currentData, patches);
                    if (delta) {
                        componentDeltas.set(component.name,
                            deltaType.encode(delta));
                    }
                } else {
                    newDraft = createDraft(data as Objectish);
                }
            }
            entity.components.set(component, newDraft);
        }

        const entityComponents = new Set(entity.components.keys());

        // Mark removed components as removed
        const removedComponents = new Set(
            [...setDifference(deltaComponent.components, entityComponents)]
                .map(component => component.name));
        // Update the components list
        deltaComponent.components = entityComponents;

        const entityDelta: EntityDelta = {};
        if (componentStates.size > 0) {
            entityDelta.componentStates = componentStates;
        }
        if (componentDeltas.size > 0) {
            entityDelta.componentDeltas = componentDeltas;
        }
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
            entity.components.set(component, decoded.right);
        }

        // Apply component deltas
        for (const [componentName, encodedDelta] of delta.componentDeltas ?? []) {
            const component = this.serializer.componentsByName.get(componentName);
            if (!component) {
                console.warn(`Missing component ${componentName}`);
                continue;
            }
            const componentDeltaFuncs = this.componentDeltas.get(component);
            if (!componentDeltaFuncs) {
                console.warn(`Missing component delta type for ${componentName}`);
                continue;
            }

            const { deltaType, applyDelta } = componentDeltaFuncs;

            const currentData = entity.components.get(component);
            if (!currentData) {
                // Cannot apply delta if the entity is missing the component.
                // Signal that the full state should be requested.
                missingComponents.add(component);
                continue;
            }

            const componentDelta = deltaType.decode(encodedDelta);
            if (isLeft(componentDelta)) {
                console.warn(`Failed to decode delta for component ${componentName}`);
                continue;
            }
            const newData = applyDelta(currentData, componentDelta.right);
            if (newData !== undefined) {
                entity.components.set(component, newData);
            }
        }

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
        world.addPlugin(SerializerPlugin);
        const serializer = world.resources.get(SerializerResource);
        if (!serializer) {
            throw new Error('Expected serializer resource to be present');
        }
        if (!world.resources.has(DeltaResource)) {
            world.resources.set(DeltaResource, new DeltaMaker(serializer));
        }
    }
}

const Patch = t.intersection([t.type({
    op: t.union([t.literal('replace'), t.literal('remove'), t.literal('add')]),
    path: t.array(t.union([t.string, t.number]))
}), t.partial({
    value: t.unknown,
})]);

export const immerDeltaType = t.array(Patch);

export function immerGetDelta<T>(_a: T, _b: T, patches: Patch[]) {
    if (patches.length > 0) {
        return patches;
    }
    return;
}

export function immerApplyDelta<T>(componentData: T, delta: Patch[]) {
    return applyPatches(componentData, delta) as T;
}
