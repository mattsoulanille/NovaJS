import 'jasmine';
import { Component } from './component';
import { Entity } from './entity';
import { FirstAvailable } from './first_available';
import { System } from './system';
import { World } from './world';


const FooComponent = new Component<{ x: number }>('foo');
const BarComponent = new Component<{ y: string }>('bar');

describe('first available', () => {
    it('returns the first available component', () => {
        const world = new World();

        const fooOnly = new Entity()
            .addComponent(FooComponent, { x: 123 });

        const barOnly = new Entity()
            .addComponent(BarComponent, { y: 'hello' });

        const hasBoth = new Entity()
            .addComponent(FooComponent, { x: 456 })
            .addComponent(BarComponent, { y: 'should not be added' });

        const values = new Set<string | number>();
        const fooBarSystem = new System({
            name: 'fooBarSystem',
            args: [FirstAvailable([FooComponent, BarComponent])],
            step(fooOrBar) {
                if ('x' in fooOrBar) {
                    values.add(fooOrBar.x);
                } else {
                    values.add(fooOrBar.y);
                }
            }
        });

        world.addSystem(fooBarSystem);
        world.entities.set('fooOnly', fooOnly);
        world.entities.set('barOnly', barOnly);
        world.entities.set('hasBoth', hasBoth);

        world.step();
        expect(values).toEqual(new Set([123, 456, 'hello']));
    })
});
