import 'jasmine';
import { Component } from './component';
import { Query } from './query';
import { Resource } from './resource';
import { System } from './system';
import * as t from 'io-ts';
import { World } from './world';

const FOO_COMPONENT = new Component({
    type: t.type({ x: t.number }),
    getDelta(a) {
        return a;
    },
    applyDelta(data) {
        return data;
    }
});

const BAR_COMPONENT = new Component({
    type: t.type({ y: t.string }),
    getDelta(a) {
        return a;
    },
    applyDelta(data) {
        return data;
    }
});

const BAZ_RESOURCE = new Resource({
    name: 'baz',
    type: t.type({ z: t.array(t.string) }),
    getDelta(a) {
        return a;
    },
    applyDelta(data) {
        return data
    },
    multiplayer: true
})

const FOO_BAR_QUERY = new Query([FOO_COMPONENT, BAR_COMPONENT] as const);

const FOO_BAR_SYSTEM = new System({
    name: 'foobar',
    args: [FOO_COMPONENT, BAR_COMPONENT, BAZ_RESOURCE] as const,
    step: (foo, bar, baz) => {
        bar.y = bar.y + `${foo.x}`;
        foo.x = bar.y.length;
        baz.z.push(bar.y);
    }
});

describe('world', () => {
    let world: World;
    beforeEach(() => {
        world = new World();
    });

    it('throws an error if a system is added before its resources', () => {
        expect(() => world.addSystem(FOO_BAR_SYSTEM))
            .toThrowError('World is missing Resource(baz) needed for System(foobar)');
    });
});
