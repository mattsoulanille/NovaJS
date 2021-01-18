import * as t from 'io-ts';
import 'jasmine';
import { Component } from './component';
import { Entity } from './entity';
import { Query } from './query';
import { Resource } from './resource';
import { System } from './system';

const FOO_COMPONENT = new Component({
    name: 'foo',
    type: t.type({ x: t.number }),
    getDelta(a) {
        return a;
    },
    applyDelta() { },
});

const BAR_COMPONENT = new Component({
    name: 'bar',
    type: t.type({ y: t.string }),
    getDelta(a) {
        return a;
    },
    applyDelta() { },
});

const BAZ_RESOURCE = new Resource({
    name: 'baz',
    type: t.type({ z: t.array(t.string) }),
    getDelta(a) {
        return a;
    },
    applyDelta() { },
    multiplayer: true
})

const XYZZY_COMPONENT = new Component({
    name: 'xyzzy',
    type: t.type({ z: t.string }),
    getDelta(a) {
        return a;
    },
    applyDelta() { }
});

const FOO_XYZZY_QUERY = new Query([FOO_COMPONENT, XYZZY_COMPONENT] as const);

describe('system', () => {
    const testSystem = new System({
        name: 'TestSystem',
        args: [FOO_COMPONENT, BAR_COMPONENT, FOO_XYZZY_QUERY, BAZ_RESOURCE] as const,
        step: (foo, bar, a, baz) => {
            bar.y = foo.x.toString();
            for (let f of a) {
                baz.z.push(f[1].z)
            }
        }
    });

    it('sets components', () => {
        expect(testSystem.components).toEqual(new Set([
            FOO_COMPONENT, BAR_COMPONENT
        ]));
    });

    it('sets resources', () => {
        expect(testSystem.resources).toEqual(new Set([
            BAZ_RESOURCE
        ]));
    });

    it('sets queries', () => {
        expect(testSystem.queries).toEqual(new Set([
            FOO_XYZZY_QUERY
        ]));
    });

    it('supports any entity that has all its required components', () => {
        const entity = new Entity()
            .addComponent(FOO_COMPONENT, { x: 123 })
            .addComponent(BAR_COMPONENT, { y: 'foobar' });

        expect(testSystem.supportsEntity(entity)).toBeTrue();
    });
});
