import 'jasmine';
import { Component } from './component';
import { Query } from './query';
import { Resource } from './resource';
import { Divider, Phase, System, SystemSet } from './system';

const FOO_COMPONENT = new Component<{ x: number }>('foo');
const BAR_COMPONENT = new Component<{ y: string }>('bar');
const XYZZY_COMPONENT = new Component<{ z: string }>('xyzzy');
const BAZ_RESOURCE = new Resource<{ z: string[] }>('baz');
const FOO_XYZZY_QUERY = new Query([FOO_COMPONENT, XYZZY_COMPONENT] as const);

describe('divider', () => {
    it('throws if something is listed in both the before and after sets', () => {
        const d1 = new Divider({name: 'd1'});
        expect(() => {
            const d2 = new Divider({name: 'd2', before: [d1], after: [d1]});
        }).toThrowError(/.*d1.*are listed in both.*before.*after.*d2/);
    });

    it('throws if something incompatible is listed in the during set', () => {
        const d1 = new Divider({name: 'd1'});
        expect(() => {
            const d2 = new Divider({name: 'd2', during: [d1]});
        }).toThrowError(/.*d1.*are listed in both.*before.*after.*d2/);
    });
});

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

    it('sets up the \'before\' set', () => {
        const divider = new Divider();
        const system = new System({
            name: 'test',
            args: [] as const,
            step: () => {},
            before: [divider],
        });

        expect(system.before).toContain(divider);
    });

    it('sets up the \'after\' set', () => {
        const divider = new Divider();
        const system = new System({
            name: 'test',
            args: [] as const,
            step: () => {},
            after: [divider],
        });

        expect(system.after).toContain(divider);
    });

    it('sets up the \'before\' and \'after\' sets from \'during\'', () => {
        const phase = new Phase({name: 'testPhase'});
        const system = new System({
            name: 'test',
            args: [] as const,
            step: () => {},
            during: [phase],
        });

        expect(system.before).toContain(phase.endMarker);
        expect(system.after).toContain(phase.startMarker);
    });
});

describe('phase', () => {
    it('the start divider occurs before the end divider', () => {
        const phase = new Phase({name: 'testPhase'});

        expect(phase.endMarker.after).toContain(phase.startMarker);
    });

    it('encapsulates sortables passed in \'contains\'', () => {
        const s1 = new System({name: 's1', args: [] as const, step: () => {}});
        const s2 = new Divider({name: 's2'});
        const contains = [s1, s2];

        const phase = new Phase({name: 'testPhase', contains});

        for (const s of contains) {
            expect(phase.startMarker.before).toContain(s);
            expect(phase.startMarker.after).not.toContain(s);
            expect(phase.endMarker.before).not.toContain(s);
            expect(phase.endMarker.after).toContain(s);
        }
    });

    it('can be used in the \'during\' field of a divider', () => {
        const phase = new Phase({name: 'testPhase'});
        const divider = new Divider({name: 'testDivider', during: [phase]});

        expect(divider.before).toContain(phase.endMarker);
        expect(divider.after).toContain(phase.startMarker);
    });

    it('can be used in the \'during\' field of another phase', () => {
        const outerPhase = new Phase({name: 'outerPhase'});
        const innerPhase = new Phase({name: 'innerPhase', during: [outerPhase]});

        expect(innerPhase.startMarker.after).toContain(outerPhase.startMarker);
        expect(innerPhase.startMarker.after).not.toContain(outerPhase.endMarker);
        expect(innerPhase.startMarker.before).not.toContain(outerPhase.startMarker);

        expect(innerPhase.endMarker.after).not.toContain(outerPhase.endMarker);
        expect(innerPhase.endMarker.before).not.toContain(outerPhase.startMarker);
        expect(innerPhase.endMarker.before).toContain(outerPhase.endMarker);
    });

    it('can \'contain\' other phases', () => {
        const innerPhase = new Phase({name: 'innerPhase'});
        const outerPhase = new Phase({name: 'outerPhase', contains: [innerPhase]});

        expect(outerPhase.startMarker.before).toContain(innerPhase.startMarker);
        expect(outerPhase.startMarker.before).not.toContain(innerPhase.endMarker);
        expect(outerPhase.startMarker.after).not.toContain(innerPhase.startMarker);
        expect(outerPhase.startMarker.after).not.toContain(innerPhase.endMarker);

        expect(outerPhase.endMarker.after).toContain(innerPhase.endMarker);
        expect(outerPhase.endMarker.before).not.toContain(innerPhase.endMarker);
        expect(outerPhase.endMarker.before).not.toContain(innerPhase.startMarker);
    });
});

describe('systemSet', () => {
    it('creates a phase that encapsulates the given systems', () => {
        const s1 = new System({name: 's1', args: [] as const, step: () => {}});
        const s2 = new System({name: 's2', args: [] as const, step: () => {}});
        const s3 = new System({name: 's3', args: [] as const, step: () => {}});
        const systems = [s1, s2, s3];

        const systemSet = new SystemSet({
            name: 'testSystemSet',
            systems,
        });

        for (const system of systems) {
            // Start of the phase is before the systems.
            expect(systemSet.phase.startMarker.before).toContain(system);
            expect(systemSet.phase.startMarker.after).not.toContain(system);
            // End of the phase is after the systems.
            expect(systemSet.phase.endMarker.before).not.toContain(system);
            expect(systemSet.phase.endMarker.after).toContain(system);
        }
    });
});
