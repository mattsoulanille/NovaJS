import 'jasmine';
import { World } from 'nova_ecs/world';
import {
    afterSimulationFrames, defaultSimulationTime, SimulationTimeResource,
} from './simulation_time.js';

/**
 * The comm dialog waits on this before reading the selected target, so a
 * number key pressed just ahead of 'y' is hailed rather than the stellar
 * selected before it (the "Philar" dialog under a "Pholar" Stellar
 * Navigation panel in Aurora, nova:603).
 */
describe('afterSimulationFrames', () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    function applyFrame(world: World, frame: number) {
        // applySimulationFrame sets a fresh Time object per frame.
        world.resources.set(SimulationTimeResource,
            { ...defaultSimulationTime(), frame, time: frame * 1000 / 60 });
    }

    it('waits for two frames to land, not one', async () => {
        const world = new World('after-frames');
        applyFrame(world, 1);
        let done = false;
        const waiting = afterSimulationFrames(world, 2, 10_000)
            .then(() => { done = true; });
        await sleep(20);
        expect(done).toBeFalse();
        applyFrame(world, 2);
        await sleep(20);
        expect(done).withContext('one frame is not enough').toBeFalse();
        applyFrame(world, 3);
        await waiting;
        expect(done).toBeTrue();
    });

    it('gives up after the timeout when no frame arrives', async () => {
        const world = new World('after-frames-stalled');
        const start = Date.now();
        await afterSimulationFrames(world, 2, 50);
        expect(Date.now() - start).toBeGreaterThanOrEqual(45);
    });
});
