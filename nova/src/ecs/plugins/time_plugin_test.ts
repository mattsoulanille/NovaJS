import 'jasmine';
import { System } from '../system';
import { World } from '../world';
import { TimePlugin, TimeResource, TimeSystem } from './time_plugin';

describe('time plugin', () => {
    it('ticks the time', () => {
        const clock = jasmine.clock();
        clock.install();

        clock.mockDate(new Date(100));

        const world = new World();
        world.addPlugin(TimePlugin);

        const times: Array<{ delta: number, time: number }> = [];
        // Runs once (on the singleton entity) since there's only one entity.
        const readClockSystem = new System({
            name: 'ReadClock',
            args: [TimeResource],
            step: (time) => {
                times.push({
                    delta: time.delta,
                    time: time.time,
                });
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
            { time: 100, delta: 0 },
            { time: 100, delta: 0 },
            { time: 150, delta: 50 },
            { time: 150, delta: 0 },
        ])
    });
});
