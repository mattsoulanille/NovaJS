import 'jasmine';
import { System } from '../system';
import { World } from '../world';
import { Time, TimePlugin, TimeResource, TimeSystem } from './time_plugin';

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
});
