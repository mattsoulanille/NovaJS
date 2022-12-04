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
});

describe('phase', () => {
    it('the start divider occurs before the end divider', () => {
        const phase = new Phase({name: 'testPhase'});

        expect(phase.end.after).toContain(phase.start);
    });
    it('encapsulates sortables passed in \'contains\'', () => {
        const s1 = new System({name: 's1', args: [] as const, step: () => {}});
        const s2 = new Divider({name: 's2'});
        const contains = [s1, s2];

        const phase = new Phase({name: 'testPhase', contains});

        for (const s of contains) {
            expect(phase.start.before).toContain(s);
            expect(phase.start.after).not.toContain(s);
            expect(phase.end.before).not.toContain(s);
            expect(phase.end.after).toContain(s);
        }
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
            expect(systemSet.phase.start.before).toContain(system);
            expect(systemSet.phase.start.after).not.toContain(system);
            // End of the phase is after the systems.
            expect(systemSet.phase.end.before).not.toContain(system);
            expect(systemSet.phase.end.after).toContain(system);
        }
    });
});
