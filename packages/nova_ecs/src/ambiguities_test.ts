import 'jasmine';
import { accessSetOf, findAmbiguities, formatAmbiguities, reportAmbiguities, sharedAccess } from './ambiguities.js';
import { Emit, EmitNow, Entities, GetArg, GetEntity, GetWorld, RunQuery, SetComponent, UUID } from './arg_types.js';
import { Component } from './component.js';
import { EcsEvent, StepEvent } from './events.js';
import { Optional } from './optional.js';
import { ReadOnly } from './read_only.js';
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

    it('reads SetComponent(x) as a write to x only', () => {
        const access = accessSetOf([SetComponent(A)]);
        expect([...access.components]).toEqual([A]);
        expect(access.allComponents).toBeFalse();
        expect(access.everything).toBeFalse();
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

describe('ReadOnly', () => {
    it('marks the arg read-only without changing what it reaches', () => {
        const access = accessSetOf([ReadOnly(A), ReadOnly(R)]);
        expect([...access.components]).toEqual([A]);
        expect([...access.resources]).toEqual([R]);
        expect(access.readComponents).toEqual(new Set([A]));
        expect(access.readResources).toEqual(new Set([R]));
    });

    it('passes through queries and modifiers', () => {
        const access = accessSetOf(
            [ReadOnly(new Query([A, R] as const)), ReadOnly(Optional(B))]);
        expect(access.readComponents).toEqual(new Set([A, B]));
        expect(access.readResources).toEqual(new Set([R]));
    });

    it('lets a write arg cancel the read-only mark', () => {
        // The same component declared both ways is a write.
        const access = accessSetOf([ReadOnly(A), A]);
        expect(access.readComponents).toEqual(new Set());
        expect(access.components).toEqual(new Set([A]));
    });

    it('cancels the read-only mark whichever order the args come in', () => {
        // The mark means "reached ONLY through a ReadOnly arg", so a
        // write arg must cancel it even when it comes first. A
        // system that writes A and also reads it through ReadOnly(A)
        // is a writer of A, not a reader.
        for (const args of [[A, ReadOnly(A)], [ReadOnly(A), A]] as const) {
            const access = accessSetOf([...args]);
            expect(access.readComponents).withContext(String(args))
                .toEqual(new Set());
            expect(access.components).withContext(String(args))
                .toEqual(new Set([A]));
        }
        for (const args of [[R, ReadOnly(R)], [ReadOnly(R), R]] as const) {
            const access = accessSetOf([...args]);
            expect(access.readResources).withContext(String(args))
                .toEqual(new Set());
            expect(access.resources).withContext(String(args))
                .toEqual(new Set([R]));
        }
    });

    it('pairs a writer that also reads through ReadOnly with a pure reader', () => {
        // The order-independent shape of the cancellation above, at
        // the level the report acts on: the write is observable to a
        // pure reader, so the pair needs a pin.
        const writer = system('writer', [A, ReadOnly(A)]);
        const reader = system('reader', [ReadOnly(A)]);
        expect(pairs([writer, reader])).toEqual(['reader<->writer']);
    });

    it('does not mark the world-reaching args read-only', () => {
        // The report cannot check what the system does with the
        // entity or world object these hand out.
        expect(accessSetOf([ReadOnly(Entities)]).everything).toBeTrue();
        expect(accessSetOf([ReadOnly(GetEntity)]).allComponents).toBeTrue();
        expect(accessSetOf([ReadOnly(GetEntity)]).readComponents.size)
            .toBe(0);
    });

    it('does not mark SetComponent read-only, and lets it cancel the mark', () => {
        // SetComponent(x) IS the write to x: wrapping it in ReadOnly
        // cannot make it a read, and a system that also reads x through
        // ReadOnly(x) is a writer of x, whichever order the args come in.
        const wrapped = accessSetOf([ReadOnly(SetComponent(A))]);
        expect(wrapped.components).toEqual(new Set([A]));
        expect(wrapped.readComponents.size).toBe(0);
        for (const args of [[ReadOnly(A), SetComponent(A)],
                            [SetComponent(A), ReadOnly(A)]] as const) {
            const access = accessSetOf([...args]);
            expect(access.readComponents).withContext(String(args))
                .toEqual(new Set());
            expect(access.components).withContext(String(args))
                .toEqual(new Set([A]));
        }
        expect(sharedAccess(accessSetOf([SetComponent(A)]),
            accessSetOf([ReadOnly(A)]))).toEqual(['component:A']);
    });

    it('does not mark Emit / EmitNow read-only', () => {
        // Emitting IS the write: two emitters share the event queue,
        // whose FIFO order is their relative order, so the annotation
        // cannot make a pair of emitters unshared.
        for (const emit of [Emit, EmitNow]) {
            const access = accessSetOf([ReadOnly(emit)]);
            expect(access.resources).withContext(String(emit))
                .toEqual(new Set([emit]));
            expect(access.readResources.size).withContext(String(emit))
                .toBe(0);
            expect(sharedAccess(accessSetOf([ReadOnly(emit)]),
                accessSetOf([ReadOnly(emit)]))).withContext(String(emit))
                .toEqual([`resource:${emit.name}`]);
        }
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

    it('pairs SetComponent(x) with a reader or writer of x, and nothing else', () => {
        expect(sharedAccess(accessSetOf([SetComponent(A)]), accessSetOf([A])))
            .toEqual(['component:A']);
        expect(sharedAccess(accessSetOf([SetComponent(A)]), accessSetOf([SetComponent(A)])))
            .toEqual(['component:A']);
        expect(sharedAccess(accessSetOf([SetComponent(A)]), accessSetOf([B, R])))
            .toEqual([]);
        // Unlike GetEntity, a SetComponent does not pair with the entity as
        // a whole: another SetComponent(B) on the same entity is disjoint.
        expect(sharedAccess(accessSetOf([SetComponent(A)]), accessSetOf([SetComponent(B)])))
            .toEqual([]);
    });

    it('reports * when one side reaches everything and the other anything', () => {
        expect(sharedAccess(accessSetOf([Entities]), accessSetOf([A]))).toEqual(['*']);
        expect(sharedAccess(accessSetOf([A]), accessSetOf([GetArg]))).toEqual(['*']);
        expect(sharedAccess(accessSetOf([Entities]), accessSetOf([UUID]))).toEqual([]);
    });

    it('ignores read/read sharing of components and resources', () => {
        expect(sharedAccess(accessSetOf([ReadOnly(A), ReadOnly(R)]),
            accessSetOf([ReadOnly(A), ReadOnly(R)]))).toEqual([]);
        // One side reading what the other side WRITES is still shared.
        expect(sharedAccess(accessSetOf([ReadOnly(A)]), accessSetOf([A])))
            .toEqual(['component:A']);
        expect(sharedAccess(accessSetOf([A]), accessSetOf([ReadOnly(A)])))
            .toEqual(['component:A']);
        expect(sharedAccess(accessSetOf([ReadOnly(R)]), accessSetOf([R])))
            .toEqual(['resource:R']);
        // A write arg cancels the read-only mark on the same side.
        expect(sharedAccess(accessSetOf([ReadOnly(A), A]),
            accessSetOf([ReadOnly(A)]))).toEqual(['component:A']);
    });

    it('ignores read/read sharing through GetEntity', () => {
        // GetEntity is never read-only: the system holds the whole
        // entity object, and the report cannot check what it does
        // with it.
        expect(sharedAccess(accessSetOf([ReadOnly(GetEntity)]),
            accessSetOf([ReadOnly(GetEntity)]))).toEqual(['entity']);
        expect(sharedAccess(accessSetOf([ReadOnly(GetEntity)]),
            accessSetOf([A]))).toEqual(['component:A']);
    });

    it('keeps a read-only world-reaching arg an ambiguity', () => {
        // ReadOnly(Entities) promises not to write the map, but the
        // map is mutable and reaches every entity: the report cannot
        // check that promise arg by arg, so it stays conservative.
        expect(sharedAccess(accessSetOf([ReadOnly(Entities)]),
            accessSetOf([ReadOnly(A)]))).toEqual(['*']);
        expect(sharedAccess(accessSetOf([ReadOnly(Entities)]),
            accessSetOf([A]))).toEqual(['*']);
    });
});

describe('findAmbiguities', () => {
    it('reports unordered pairs that share state, and only those', () => {
        const a = system('a', [A]);
        const b = system('b', [A, B]);
        const c = system('c', [C]);
        expect(pairs([c, b, a])).toEqual(['a<->b']);
    });

    it('does not report pairs that only read the same state', () => {
        const a = system('a', [ReadOnly(A), ReadOnly(R)]);
        const b = system('b', [ReadOnly(A)]);
        const c = system('c', [ReadOnly(A), A]);
        // a and b both merely read A: unobservable order. c writes A,
        // so it stays ambiguous with both readers.
        expect(pairs([c, b, a])).toEqual(['a<->c', 'b<->c']);
    });

    it('is silent for pairs ordered by a declared edge, in either direction', () => {
        const a = system('a', [A]);
        expect(pairs([a, system('b', [A], { after: [a] })])).toEqual([]);
        expect(pairs([a, system('b', [A], { before: [a] })])).toEqual([]);
    });

    it('counts a SetComponent(provided) provider against readers of what it touches, and only those', () => {
        // The Provide shape: Optional(provided), SetComponent(provided),
        // Optional(StepEvent), ...args. Readers of the provided component
        // or of a factory input still share state with it…
        const provider = system('provider',
            [Optional(A), SetComponent(A), Optional(StepEvent), B]);
        expect(pairs([provider, system('reader', [A])]))
            .toEqual(['provider<->reader']);
        expect(pairs([provider, system('writer', [B])]))
            .toEqual(['provider<->writer']);
        // …but a system that merely runs on the same entity no longer does
        // (with GetEntity here, this pair would share the whole entity).
        expect(pairs([provider, system('unrelated', [C])])).toEqual([]);
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

    it('does not report two systems that only read the same resource', () => {
        const world = new World('read-only');
        world.resources.set(R, 0);
        world.addSystem(system('a', [ReadOnly(R)]))
            .addSystem(system('b', [ReadOnly(R)]));
        expect(reportAmbiguities(world)).toEqual([]);
    });
});
