import { right } from 'fp-ts/lib/Either.js';
import 'jasmine';
import { GetArg } from './arg_types.js';
import { Component } from './component.js';
import { ArgModifier } from './arg_modifier.js';
import { Optional } from './optional.js';
import { ReadOnly } from './read_only.js';
import { Query } from './query.js';
import { Resource } from './resource.js';
import { Without } from './without.js';


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

    // The staleness set drives component-indexed cache invalidation
    // (QueryCache): a component event only invalidates queries whose
    // referencedComponents contain that component. These pins guard
    // the correctness edge: components resolved through modifiers
    // affect results without affecting membership, so they MUST be in
    // the staleness set even though they are not in `components`.
    describe('referencedComponents', () => {
        it('includes required components', () => {
            const query = new Query([FOO_COMPONENT, BAR_COMPONENT] as const);
            expect(query.referencedComponents)
                .toEqual(new Set([FOO_COMPONENT, BAR_COMPONENT]));
        });

        it('includes the component wrapped by Optional', () => {
            // Optional(BAR) does not make BAR required, but a cached
            // result includes BAR's value (or undefined), so BAR
            // changes must invalidate it.
            const query = new Query(
                [FOO_COMPONENT, Optional(BAR_COMPONENT)] as const);
            expect(query.components).toEqual(new Set([FOO_COMPONENT]));
            expect(query.referencedComponents)
                .toEqual(new Set([FOO_COMPONENT, BAR_COMPONENT]));
        });

        it('includes the component inside a ReadOnly wrapper', () => {
            // ReadOnly is an annotation for the ambiguity report; the
            // wrapped arg is still resolved, and a modifier like
            // Optional caches its value, so its changes must
            // invalidate the cached result.
            const query = new Query(
                [FOO_COMPONENT, Optional(ReadOnly(BAR_COMPONENT))] as const);
            expect(query.components).toEqual(new Set([FOO_COMPONENT]));
            expect(query.referencedComponents)
                .toEqual(new Set([FOO_COMPONENT, BAR_COMPONENT]));
        });

        it('includes the component wrapped by Without', () => {
            // Without(BAR) resolves through Optional(BAR): adding BAR
            // to an entity must re-evaluate (and now exclude) it.
            const query = new Query(
                [FOO_COMPONENT, Without(BAR_COMPONENT)] as const);
            expect(query.referencedComponents)
                .toEqual(new Set([FOO_COMPONENT, BAR_COMPONENT]));
        });

        it('is unknown for a modifier holding an undeclared GetArg', () => {
            // A transform that can call getArg with anything must make
            // the cache conservatively invalidate on every component
            // event.
            const opaqueModifier = new ArgModifier({
                query: new Query([GetArg] as const),
                transform: getArg => right(getArg as any),
            });
            const query = new Query([FOO_COMPONENT, opaqueModifier] as const);
            expect(query.referencedComponents).toBeNull();
        });

        it('is not poisoned by a direct GetArg arg', () => {
            // As a direct system arg, GetArg fetches fresh values on
            // every call, so nothing stale is cached.
            const query = new Query([FOO_COMPONENT, GetArg] as const);
            expect(query.referencedComponents)
                .toEqual(new Set([FOO_COMPONENT]));
        });
    });
});
