import 'jasmine';
import * as t from 'io-ts';
import { Component } from './component';
import { Query } from './query';
import { Resource } from './resource';
import { System } from './system';

const FOO_COMPONENT = new Component({
    type: t.type({ x: t.number }),
    getDelta(a) {
        return a;
    },
    applyDelta() { },
});

const BAR_COMPONENT = new Component({
    type: t.type({ y: t.string }),
    getDelta(a) {
        return a;
    },
    applyDelta() { },
});

const BAZ_RESOURCE = new Resource({
    type: t.type({ z: t.array(t.string) }),
    getDelta(a) {
        return a;
    },
    applyDelta() { },
    multiplayer: true
})

const XYZZY_COMPONENT = new Component({
    type: t.type({ z: t.string }),
    getDelta(a) {
        return a;
    },
    applyDelta() { }
});


const FOO_XYZZY_QUERY = new Query([FOO_COMPONENT, XYZZY_COMPONENT] as const);

describe('system', () => {
    const testSystem = new System({
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

    it('sets allComponents as the union of components and query components', () => {
        expect(testSystem.allComponents).toEqual(new Set([
            FOO_COMPONENT,
            BAR_COMPONENT,
            XYZZY_COMPONENT
        ]));
    });
});
