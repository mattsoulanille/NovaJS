import { Either, isLeft, right } from 'fp-ts/lib/Either.js';
import { current, isDraft } from 'immer';
import * as t from 'io-ts';
import { Errors } from 'io-ts';
import { Component, ComponentData, UnknownComponent } from '../component.js';
import { map } from '../datatypes/map.js';
import { Entity } from '../entity.js';
import { EcsEvent, EventData, UnknownEvent } from '../events.js';
import { Plugin } from '../plugin.js';
import { Resource } from '../resource.js';

interface ComponentTypeMap<K extends Component<any>>
    extends Map<K, t.Type<ComponentData<K>, unknown, unknown>> {
    get<Data>(key: Component<Data>): t.Type<Data, unknown, unknown> | undefined;
    set<Data>(key: Component<Data>, val: t.Type<Data, unknown, unknown>): this;
}

interface EventTypeMap<K extends EcsEvent<any>>
    extends Map<K, t.Type<EventData<K>, unknown, unknown>> {
    get<Data>(key: EcsEvent<Data>): t.Type<Data, unknown, unknown> | undefined;
    set<Data>(key: EcsEvent<Data>, val: t.Type<Data, unknown, unknown>): this;
}

export const EntityState = t.intersection([
    t.type({
        components: map(t.string /* Component Name */, t.unknown /* State */),
    }),
    t.partial({
        name: t.string
    })
]);

export type EntityState = t.TypeOf<typeof EntityState>;

function summarizeValue(value: unknown): string {
    if (value === undefined) {
        return 'undefined';
    }
    if (typeof value === 'string') {
        return JSON.stringify(value);
    }
    try {
        const json = JSON.stringify(value);
        if (json !== undefined) {
            return json.length > 200 ? `${json.slice(0, 200)}...` : json;
        }
    } catch {
        // Fall through to String(value).
    }
    return String(value);
}

export function formatIoTsErrors(errors: Errors): string[] {
    return errors.map(error => {
        const path = error.context
            .map(entry => entry.key)
            .filter(Boolean)
            .join('.');
        const expected = error.context[error.context.length - 1]?.type.name ?? 'unknown';
        const actual = summarizeValue((error as { value?: unknown; actual?: unknown }).value
            ?? (error as { value?: unknown; actual?: unknown }).actual);
        return `${path || '<root>'}: expected ${expected}, got ${actual}`;
    });
}

export class Serializer {
    readonly componentTypes: ComponentTypeMap<UnknownComponent> = new Map();
    readonly componentsByName = new Map<string, UnknownComponent>();
    readonly eventTypes: EventTypeMap<UnknownEvent> = new Map();
    readonly eventsByName = new Map<string, UnknownEvent>();

    // Capitalized because it's a runtime type.
    readonly Entity = new t.Type(
        'Entity',
        // `every`, not an initial-value-less `reduce`: reduce throws on
        // an empty array, so a component-less entity failed the guard
        // (#84).
        (u): u is Entity => u instanceof Object &&
            (u as Entity).components instanceof Map &&
            [...(u as Entity).components.keys()]
                .every(k => k instanceof Component),

        // Decode / deserialize entities.
        (i, context): Either<Errors, Entity> => {
            const maybeState = EntityState.validate(i, context);
            if (isLeft(maybeState)) {
                return maybeState;
            }
            const state = maybeState.right;
            const entity = new Entity(state.name);

            for (const [componentName, encodedData] of state.components) {
                const component = this.componentsByName.get(componentName);
                if (!component) {
                    continue;
                }
                const componentType = this.componentTypes.get(component);
                if (!componentType) {
                    continue;
                }

                const maybeData = componentType.decode(encodedData);
                if (isLeft(maybeData)) {
                    return maybeData;
                }
                const data = maybeData;
                entity.components.set(component, data.right);
            }

            return right(entity);
        },

        // Encode / serialize entities
        (entity) => {
            const entityState: EntityState = {
                components: new Map(),
                name: entity.name,
            };

            for (const [component, data] of entity.components) {
                const componentType = this.componentTypes.get(component);
                if (componentType) {
                    const encodedData = componentType.encode(
                        isDraft(data) ? current(data) : data
                    );
                    entityState.components.set(component.name, encodedData)
                }
            }

            return EntityState.encode(entityState);
        }
    )

    addComponent<Data>(component: Component<Data>,
        componentType: t.Type<Data, unknown, unknown>) {
        // Every restore and delta path resolves components by NAME
        // (decodeComponent), so two Components sharing a name would
        // silently attach wire data to whichever registered last.
        // Mirror addEvent's guard (#88). Re-registering the SAME
        // component (e.g. with a different codec) stays allowed.
        const existing = this.componentsByName.get(component.name);
        if (existing && existing !== component) {
            throw new Error(
                `A component with name ${component.name} is already registered`);
        }
        this.componentsByName.set(component.name, component as UnknownComponent);
        this.componentTypes.set(component, componentType);
    }

    addEvent<Data>(event: EcsEvent<Data>,
        eventType: t.Type<Data, unknown, unknown>) {
        if (!event.name) {
            throw new Error('Serialized events need a stable name');
        }
        const existingEvent = this.eventsByName.get(event.name);
        if (existingEvent && existingEvent !== event) {
            throw new Error(`An event with name ${event.name} is already registered`);
        }
        this.eventsByName.set(event.name, event as UnknownEvent);
        this.eventTypes.set(event, eventType);
    }

    encode(entity: Entity) {
        return this.Entity.encode(entity);
    }

    decode(state: unknown) {
        return this.Entity.decode(state);
    }

    hasComponent(component: UnknownComponent) {
        return this.componentTypes.has(component);
    }

    encodeComponent<Data>(component: Component<Data>, data: Data): unknown {
        const componentType = this.componentTypes.get(component);
        if (!componentType) {
            throw new Error(`No serializer type registered for component ${component.name}`);
        }
        return componentType.encode(isDraft(data) ? current(data) : data);
    }

    /**
     * Decodes a single component's data by component name. Returns undefined
     * if the component is not registered with this serializer.
     */
    decodeComponent(componentName: string, encoded: unknown):
        Either<Errors, [UnknownComponent, unknown]> | undefined {
        const component = this.componentsByName.get(componentName);
        if (!component) {
            return undefined;
        }
        const componentType = this.componentTypes.get(component);
        if (!componentType) {
            return undefined;
        }
        const maybeData = componentType.decode(encoded);
        if (isLeft(maybeData)) {
            return maybeData;
        }
        return right([component, maybeData.right]);
    }

    describeDecodeFailure(state: unknown, errors: Errors): string {
        const maybeState = EntityState.decode(state);
        if (isLeft(maybeState)) {
            return formatIoTsErrors(errors).join('; ');
        }

        const componentFailures: string[] = [];
        for (const [componentName, encodedData] of maybeState.right.components) {
            const component = this.componentsByName.get(componentName);
            const componentType = component && this.componentTypes.get(component);
            if (!componentType) {
                continue;
            }

            const maybeData = componentType.decode(encodedData);
            if (isLeft(maybeData)) {
                for (const message of formatIoTsErrors(maybeData.left)) {
                    componentFailures.push(`component ${componentName}: ${message}`);
                }
            }
        }

        if (componentFailures.length > 0) {
            return componentFailures.join('; ');
        }
        return formatIoTsErrors(errors).join('; ');
    }

    encodeEvent<Data>(event: EcsEvent<Data>, data: Data): unknown {
        const eventType = this.eventTypes.get(event);
        if (!eventType) {
            throw new Error(`No serializer type registered for event ${event.name ?? '<unnamed>'}`);
        }
        return eventType.encode(isDraft(data) ? current(data) : data);
    }

    decodeEvent<Data>(event: EcsEvent<Data>, state: unknown): Either<Errors, Data> {
        const eventType = this.eventTypes.get(event);
        if (!eventType) {
            throw new Error(`No serializer type registered for event ${event.name ?? '<unnamed>'}`);
        }
        return eventType.decode(state);
    }

    describeEventDecodeFailure<Data>(event: EcsEvent<Data>, state: unknown, errors: Errors): string {
        const eventType = this.eventTypes.get(event);
        if (!eventType) {
            return formatIoTsErrors(errors).join('; ');
        }

        const maybeData = eventType.decode(state);
        if (isLeft(maybeData)) {
            return formatIoTsErrors(maybeData.left).join('; ');
        }
        return formatIoTsErrors(errors).join('; ');
    }
}

export function passthroughType<Data>(name: string): t.Type<Data, unknown, unknown> {
    return new t.Type<Data, unknown, unknown>(
        name,
        (_u): _u is Data => true,
        (input) => right(input as Data),
        (data) => data,
    );
}

export const markerType = new t.Type<undefined, null, unknown>(
    'marker',
    (u): u is undefined => u === undefined,
    (input, context) => input == null ? right(undefined) : t.undefined.validate(input, context),
    () => null,
);

export type EncodedEntity = ReturnType<Serializer['Entity']['encode']>;
export const EncodedEntity: t.Type<EncodedEntity> = t.intersection([
    t.type({
        components: t.array(t.tuple([t.string, t.unknown])),
    }), t.partial({
        name: t.string,
    })
]);

export const SerializerResource =
    new Resource<Serializer>('SerializerResource');


export const SerializerPlugin: Plugin = {
    name: 'Serializer',
    build(world) {
        if (!world.resources.has(SerializerResource)) {
            world.resources.set(SerializerResource, new Serializer());
        }
    }
}
