import { right } from 'fp-ts/lib/Either';
import 'jasmine';
import { Component } from './component';
import { ArgModifier } from './arg_modifier';
import { Query } from './query';
import { Resource } from './resource';


const FOO_COMPONENT = new Component<{ x: number }>('foo');
const BAR_COMPONENT = new Component<{ y: string }>('bar');
const BAZ_RESOURCE = new Resource<{ z: string[] }>('baz');


describe('query', () => {
    it('computes required components', () => {
        const query = new Query([FOO_COMPONENT, BAR_COMPONENT] as const);
        expect(query.components).toEqual(new Set([FOO_COMPONENT, BAR_COMPONENT]));
    });

    it('does not include components from nested queries', () => {
        // Nested queries are evaluated separately and only resolve to
        // the entities they match. A match is not necessary for the original
        // query to be supported.
        const nestedQuery = new Query([FOO_COMPONENT, BAR_COMPONENT] as const);
        const query = new Query([BAR_COMPONENT, nestedQuery] as const);
        expect(query.components).toEqual(new Set([BAR_COMPONENT]));
    });

    it('sets components', () => {
        const query = new Query([FOO_COMPONENT, BAR_COMPONENT, BAZ_RESOURCE] as const);
        expect(query.components).toEqual(new Set([FOO_COMPONENT, BAR_COMPONENT]));
    });

    it('sets resources', () => {
        const query = new Query([FOO_COMPONENT, BAR_COMPONENT, BAZ_RESOURCE] as const);
        expect(query.resources).toEqual(new Set([BAZ_RESOURCE]));
    });

    it('includes components and resources from modifiers', () => {
        const exampleModifier = new ArgModifier({
            query: new Query([FOO_COMPONENT, BAZ_RESOURCE] as const),
            transform: (foo, _baz) => {
                return right(foo as any);
            }
        });

        const query = new Query([exampleModifier, BAR_COMPONENT] as const);

        expect(query.components).toEqual(new Set([FOO_COMPONENT, BAR_COMPONENT]));
        expect(query.resources).toEqual(new Set([BAZ_RESOURCE]));
    });
});
