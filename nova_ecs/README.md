# Nova ECS

Nova ECS is the [Entity Component System](https://en.wikipedia.org/wiki/Entity_component_system) that NovaJS uses. It is heavily inspired by [Bevy ECS](https://bevyengine.org/).

## What an ECS is
[Bevy](https://bevyengine.org/learn/book/getting-started/ecs/) and [Wikipedia](https://en.wikipedia.org/wiki/Entity_component_system) have good explainations, so this section is TODO(mattsoulanille).

### Entitiy
An Entity is a general purpose object that has a unique id and a number of components attached to it. In NovaJS, most things that show up on the screen are entities, including ships, projectiles, planets, and asteroids, but an entity does not need to correspond to something visible to the user. 

```ts
// entity.ts
export class Entity {
    components: ComponentMap,
    name?: string;
    ...
}
```

### Component
Components are data stored on an entity (in the `components` map).
```ts
// component.ts
class Component<Data> {
    readonly type?: t.Type<Data>;
    readonly name: string;
    constructor(name: string) {
        this.name = name;
    }

    toString() {
        return `Component(${this.name})`;
    }
}
```
As an example, this is how a `Position` component could be defined and added to an entity.
```ts
import {Entity} from 'nova_ecs/entity'
import {Component} from 'nova_ecs/component'

const testEntity = new Entity();

interface Position {
    x: number,
    y: number,
};

const PositionComponent = new Component<Position>('position');
testEntity.components.set(Position, {x: 123, y: 456});
```


### System
A system is a function that takes components as arguments and mutates them. 
```ts
// system.ts
class System<StepArgTypes extends readonly ArgTypes[] = readonly ArgTypes[]> {
    ...
    // Many of these parameters are optional. Only `name`, `args`, and `step` are required.
    constructor({ name, args, step, before, after, events }: SystemArgs<StepArgTypes>) {
        ...
    }
    ...
}
```

A system is run when the world (`world.ts`) is stepped. The world runs the system on the components of each entity that the system supports. In most cases, a system supports an entity if and only if the entity has all the components in the system's `args` parameter. As an example, here's a system that moves entities that have the `PositionComponent` component (from above) according to a `VelocityComponent`.

```ts
import {World} from 'nova_ecs/world';
import {Entity} from 'nova_ecs/entity';
import {Component} from 'nova_ecs/component';
import {System} from 'nova_ecs/system';

interface Position {x: number, y: number};
interface Velocity {dx: number, dy: number};

const PositionComponent = new Component<Position>('position');
const VelocityComponent = new Component<Velocity>('velocity');

const MoveSystem = new System({
    name: 'MoveSystem', 
    // `as const` is necessary for preserving type information of the list
    // Otherwise, the args to step would all have type `Position | Velocity`.
    args: [PositionComponent, VelocityComponent] as const,
    step(position, velocity) {
        // Types for `position` and `velocity` are automatically inferred from
        // the `args` list.
        position.x += velocity.dx;
        position.y += velocity.dy;
    }
});

const world = new World();
world.addSystem(MoveSystem);

const testEntity = new Entity()
    .addComponent(PositionComponent, {x: 0, y: 0})    // Chaining API, because writing 'testEntity.components.set(...)'
    .addComponent(VelocityComponent, {dx: 1, dy: 2}); // every time is a bit tiring.
world.entities.set('test entity uuid', testEntity);

// Step the world and run MoveSystem on testEntity once.
world.step();
console.log(testEntity.components.get(PositionComponent));
// {x: 1, y: 2}
```

Install the [`nova_ecs` node module](https://www.npmjs.com/package/nova_ecs) and copy-paste this into an `index.ts` file to see it in action.

### Resource
This documentation is TODO, but a resource is essentially a globally available component that's added to the world instead of to an entity. Similar to Bevy's [Resource](https://bevyengine.org/learn/book/getting-started/resources/).

### Query
This documentation is TODO. Similar to Bevy's Query. Everything uses it. `args` of `System` are actually just used to create a query.

### Modifier
This documentation is TODO. Allows doing more with queries than just requiring components. See `optional.ts` and `provider.ts` for example uses.

### Plugins
Docs TODO, but they essentially are just functions that the world calls with itself.
