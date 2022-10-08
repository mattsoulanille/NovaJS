import { Either, isLeft, right } from 'fp-ts/Either';
import * as t from 'io-ts';
import { Errors } from 'io-ts';
import { Component, ComponentData, UnknownComponent } from '../component';
import { map } from '../datatypes/map';
import { Entity } from '../entity';
import { Plugin } from '../plugin';
import { Resource } from '../resource';

interface ComponentTypeMap<K extends Component<any>>
    extends Map<K, t.Type<ComponentData<K>, unknown, unknown>> {
    get<Data>(key: Component<Data>): t.Type<Data, unknown, unknown> | undefined;
    set<Data>(key: Component<Data>, val: t.Type<Data, unknown, unknown>): this;
}

export const EntityState = t.intersection([
    t.type({
        components: t.array(t.tuple([t.string /* Component Name */, t.unknown /* State */])),
    }),
    t.partial({
        name: t.string
    })
]);

export type EntityState = t.TypeOf<typeof EntityState>;

export class Serializer {
    readonly componentTypes: ComponentTypeMap<UnknownComponent> = new Map();
    readonly componentsByName = new Map<string, UnknownComponent>();

    // Capitalized because it's a runtime type.
    readonly Entity = new t.Type(
        'Entity',
        (u): u is Entity => u instanceof Object &&
            (u as Entity).components instanceof Map &&
            [...(u as Entity).components.keys()]
                .map(k => k instanceof Component)
                .reduce((a, b) => a && b),

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
                components: [],
                name: entity.name,
            };

            for (const [component, data] of entity.components) {
                const componentType = this.componentTypes.get(component);
                if (componentType) {
                    const encodedData = componentType.encode(data);
                    entityState.components.push([component.name, encodedData])
                }
            }

            return EntityState.encode(entityState);
        }
    )

    addComponent<Data>(component: Component<Data>,
        componentType: t.Type<Data, unknown, unknown>) {
        this.componentsByName.set(component.name, component as UnknownComponent);
        this.componentTypes.set(component, componentType);
    }

    encode(entity: Entity) {
        return this.Entity.encode(entity);
    }

    decode(state: unknown) {
        return this.Entity.decode(state);
    }
}

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
