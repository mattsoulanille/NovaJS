import 'jasmine';
import { System } from '../system.js';
import { World } from '../world.js';
import { Time, TimePlugin, TimeResource, TimeScaleResource, TimeSystem, useFixedTimestep } from './time_plugin.js';

describe('time plugin', () => {
    let clock: jasmine.Clock;
    beforeEach(() => {
        clock = jasmine.clock();
        clock.install();
    });
    afterEach(() => {
        clock.uninstall();
    });

    it('ticks the time', () => {
        clock.mockDate(new Date(100));

        const world = new World();
        world.addPlugin(TimePlugin);

        const times: Array<Time> = [];
        // Runs once (on the singleton entity) since there's only one entity.
        const readClockSystem = new System({
            name: 'ReadClock',
            args: [TimeResource],
            step: (time) => {
                times.push({ ...time });
            },
            after: new Set([TimeSystem]),
        });

        world.addSystem(readClockSystem);
        world.step();
        world.step();

        clock.tick(50);
        world.step();
        world.step();

        expect(times).toEqual([
            { time: 100, delta_ms: 0, delta_s: 0, frame: 1 },
            { time: 100, delta_ms: 0, delta_s: 0, frame: 2 },
            { time: 150, delta_ms: 50, delta_s: 0.05, frame: 3 },
            { time: 150, delta_ms: 0, delta_s: 0, frame: 4 },
        ])
    });

    it('scales wall-clock time monotonically when TimeScaleResource is set', () => {
        clock.mockDate(new Date(1000));

        const world = new World();
        world.addPlugin(TimePlugin);
        const scale = { scale: 1 };
        world.resources.set(TimeScaleResource, scale);

        const times: Array<Time> = [];
        world.addSystem(new System({
            name: 'ReadClock',
            args: [TimeResource],
            step: (time) => {
                times.push({ ...time });
            },
            after: new Set([TimeSystem]),
        }));

        // 1x: 50ms wall -> 50ms scaled
        clock.tick(50);
        world.step();

        // 2x: 50ms wall -> 100ms scaled
        scale.scale = 2;
        clock.tick(50);
        world.step();

        // Back to 1x: 50ms wall -> 50ms scaled, continuing monotonically (no backward jump!)
        scale.scale = 1;
        clock.tick(50);
        world.step();

        expect(times).toEqual([
            { time: 1050, delta_ms: 50, delta_s: 0.05, frame: 1 },
            { time: 1150, delta_ms: 100, delta_s: 0.1, frame: 2 },
            { time: 1200, delta_ms: 50, delta_s: 0.05, frame: 3 },
        ]);
    });

    it('ignores TimeScaleResource when using a fixed timestep', () => {
        clock.mockDate(new Date(1000));
        const world = new World();
        world.addPlugin(TimePlugin);
        useFixedTimestep(world, 16);
        world.resources.set(TimeScaleResource, { scale: 2 });

        clock.tick(50);
        world.step();
        expect(world.resources.get(TimeResource)).toEqual({
            time: 16, delta_ms: 16, delta_s: 0.016, frame: 1,
        });
    });
});
