import 'jasmine';
import { Component } from './component';
import { Query } from './query';
import { Resource } from './resource';
import { System } from './system';

const FOO_COMPONENT = new Component<{ x: number }>('foo');
const BAR_COMPONENT = new Component<{ y: string }>('bar');
const XYZZY_COMPONENT = new Component<{ z: string }>('xyzzy');
const BAZ_RESOURCE = new Resource<{ z: string[] }>('baz');
const FOO_XYZZY_QUERY = new Query([FOO_COMPONENT, XYZZY_COMPONENT] as const);

describe('system', () => {
    it('creates a query for the given arguments', () => {
        const args = [FOO_COMPONENT, BAR_COMPONENT,
            FOO_XYZZY_QUERY, BAZ_RESOURCE] as const;

        const testSystem = new System({
            name: 'TestSystem',
            args,
            step: (foo, bar, a, baz) => {
                bar.y = foo.x.toString();
                for (let f of a) {
                    baz.z.push(f[1].z)
                }
            }
        });

        expect(testSystem.query.args).toEqual(args);
    });
});
