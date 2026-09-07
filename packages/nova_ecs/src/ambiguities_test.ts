import 'jasmine';
import { accessSetOf, findAmbiguities, formatAmbiguities, reportAmbiguities, sharedAccess } from './ambiguities.js';
import { Entities, GetArg, GetEntity, GetWorld, RunQuery, UUID } from './arg_types.js';
import { Component } from './component.js';
import { EcsEvent } from './events.js';
import { Optional } from './optional.js';
import { Query } from './query.js';
import { Resource } from './resource.js';
import { Marker, System } from './system.js';
import { World } from './world.js';

const A = new Component<number>('A');
const B = new Component<number>('B');
const C = new Component<number>('C');
const R = new Resource<number>('R');
const S = new Resource<number>('S');
const OtherEvent = new EcsEvent<undefined>('OtherEvent');

function system(name: string, args: readonly any[], extra: {
    before?: Marker[], after?: Marker[], events?: EcsEvent<any>[],
} = {}) {
    return new System({ name, args, step() { }, ...extra });
}

/** Names of the ambiguous pairs, `a<->b`. */
function pairs(systems: System[], markers: Marker[] = []) {
    return findAmbiguities([...markers, ...systems])
        .map(({ a, b }) => `${a.name}<->${b.name}`);
}

describe('accessSetOf', () => {
    it('collects components and resources, through queries and modifiers', () => {
        const access = accessSetOf([A, R, new Query([B, S] as const),
            Optional(C), UUID]);
        expect([...access.components].map(c => c.name).sort()).toEqual(['A', 'B', 'C']);
        expect([...access.resources].map(r => r.name).sort()).toEqual(['R', 'S']);
        expect(access.allComponents).toBeFalse();
        expect(access.everything).toBeFalse();
    });

    it('reads GetEntity as every component', () => {
        expect(accessSetOf([GetEntity]).allComponents).toBeTrue();
        expect(accessSetOf([GetEntity]).everything).toBeFalse();
    });

    it('reads the world-reaching args as everything', () => {
        for (const arg of [Entities, RunQuery, GetWorld, GetArg] as const) {
            expect(accessSetOf([arg]).everything).withContext(String(arg)).toBeTrue();
        }
    });

    it('trusts a modifier\'s declared reach in place of its raw GetArg', () => {
        // Optional(x) resolves x through GetArg; that is not "anything".
        expect(accessSetOf([Optional(A)]).everything).toBeFalse();
        expect(accessSetOf([Optional(R)]).resources.has(R)).toBeTrue();
    });
});

describe('sharedAccess', () => {
    it('names the shared components and resources, sorted', () => {
        expect(sharedAccess(accessSetOf([A, B, R]), accessSetOf([B, R, C])))
            .toEqual(['component:B', 'resource:R']);
        expect(sharedAccess(accessSetOf([A]), accessSetOf([B]))).toEqual([]);
    });

    it('pairs GetEntity with any component, and with another GetEntity', () => {
        expect(sharedAccess(accessSetOf([GetEntity]), accessSetOf([A, R])))
            .toEqual(['component:A']);
        expect(sharedAccess(accessSetOf([GetEntity]), accessSetOf([GetEntity])))
            .toEqual(['entity']);
        // GetEntity alone against a resource-only system: nothing in common.
        expect(sharedAccess(accessSetOf([GetEntity]), accessSetOf([R]))).toEqual([]);
    });

    it('reports * when one side reaches everything and the other anything', () => {
        expect(sharedAccess(accessSetOf([Entities]), accessSetOf([A]))).toEqual(['*']);
        expect(sharedAccess(accessSetOf([A]), accessSetOf([GetArg]))).toEqual(['*']);
        expect(sharedAccess(accessSetOf([Entities]), accessSetOf([UUID]))).toEqual([]);
    });
});

describe('findAmbiguities', () => {
    it('reports unordered pairs that share state, and only those', () => {
        const a = system('a', [A]);
        const b = system('b', [A, B]);
        const c = system('c', [C]);
        expect(pairs([c, b, a])).toEqual(['a<->b']);
    });

    it('is silent for pairs ordered by a declared edge, in either direction', () => {
        const a = system('a', [A]);
        expect(pairs([a, system('b', [A], { after: [a] })])).toEqual([]);
        expect(pairs([a, system('b', [A], { before: [a] })])).toEqual([]);
    });

    it('follows transitive paths, through markers too', () => {
        const a = system('a', [A]);
        const middle = new Marker({ name: 'middle', after: [a] });
        const b = system('b', [A], { after: [middle] });
        expect(pairs([a, b], [middle])).toEqual([]);
        // Without the marker registered, the path is gone.
        expect(pairs([a, b])).toEqual(['a<->b']);
    });

    it('ignores pairs that never respond to the same event', () => {
        const a = system('a', [A]);
        const b = system('b', [A], { events: [OtherEvent] });
        expect(pairs([a, b])).toEqual([]);
    });

    it('sorts pairs by name and describes what they share', () => {
        const z = system('z', [A, R]);
        const y = system('y', [R]);
        const x = system('x', [A]);
        const report = findAmbiguities([z, y, x]);
        expect(report.map(({ a, b, shared }) => [a.name, b.name, shared]))
            .toEqual([['x', 'z', ['component:A']], ['y', 'z', ['resource:R']]]);
        expect(formatAmbiguities(report)).toBe(
            'x <-> z: component:A\ny <-> z: resource:R\n2 ambiguous pair(s)');
        expect(formatAmbiguities([])).toBe('0 ambiguous pair(s)');
    });
});

describe('reportAmbiguities', () => {
    it('reads the world\'s registered systems and markers', () => {
        const world = new World('ambiguous');
        world.resources.set(R, 0);
        const a = system('a', [R]);
        const b = system('b', [R]);
        world.addSystem(a).addSystem(b);
        expect(reportAmbiguities(world).map(({ a, b }) => [a.name, b.name]))
            .toEqual([['a', 'b']]);
        const between = new Marker({ name: 'between', after: [a], before: [b] });
        world.addMarker(between);
        expect(reportAmbiguities(world)).toEqual([]);
    });
});
