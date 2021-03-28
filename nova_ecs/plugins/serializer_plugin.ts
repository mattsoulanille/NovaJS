import { Either, isLeft, right } from 'fp-ts/lib/Either';
import * as t from 'io-ts';
import { Errors } from 'io-ts';
import { Component, ComponentData, UnknownComponent } from '../component';
import { map } from '../datatypes/map';
import { Entity } from '../entity';
import { Plugin } from '../plugin';
import { Resource } from '../resource';

interface ComponentTypeMap<K extends Component<any, any, any, any>>
    extends Map<K, t.Type<ComponentData<K>, unknown, unknown>> {
    get<Data>(key: Component<Data, any, any, any>): t.Type<Data, unknown, unknown> | undefined;
    set<Data>(key: Component<Data, any, any, any>, val: t.Type<Data, unknown, unknown>): this;
}


const EntityState = t.intersection([
    t.type({
        components: map(t.string /* Component Name */, t.unknown /* State */),
    }),
    t.partial({
        name: t.string
    })
]);

type EntityState = t.TypeOf<typeof EntityState>;

export class Serializer {
    readonly componentTypes: ComponentTypeMap<UnknownComponent> = new Map();
    readonly componentsByName = new Map<string, UnknownComponent>();

    // Capitalized because it's a runtime type.
    private readonly Entity = new t.Type(
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

            const entity: Entity = {
                components: new Map(),
                multiplayer: false,
                name: state.name,
            };

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
                    const encodedData = componentType.encode(data);
                    entityState.components.set(component.name, encodedData)
                }
            }

            return EntityState.encode(entityState);
        }
    )

    addComponent<Data>(component: Component<Data, any, any, any>,
        componentType: t.Type<Data, unknown, unknown>) {
        this.componentsByName.set(component.name, component as UnknownComponent);
        this.componentTypes.set(component, componentType);
    }

    encode(entity: Entity) {
        return this.Entity.encode(entity);
    }

    deocde(state: unknown) {
        return this.Entity.decode(state);
    }
}


export const SerializerResource =
    new Resource<Serializer>({ name: 'SerializerResource' });


export const SerializerPlugin: Plugin = {
    name: 'Serializer',
    build(world) {
        if (!world.resources.has(SerializerResource)) {
            world.resources.set(SerializerResource, new Serializer());
        }
    }
}
