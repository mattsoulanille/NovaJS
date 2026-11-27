import 'jasmine';
import { SerializerPlugin } from 'nova_ecs/plugins/serializer_plugin';
import { TimePlugin } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { SimulationBridgeHost } from './simulation_bridge_host.js';

/**
 * The worker's half of the performance telemetry
 * (SimulationBridgeHost.perfCounters, client/perf_telemetry.ts): what
 * stepping and snapshotting cost per window. Timing only, beside the
 * simulation.
 */
describe('SimulationBridgeHost.perfCounters', () => {
    async function makeHost() {
        const world = new World('perf counters');
        await world.addPlugin(SerializerPlugin);
        await world.addPlugin(TimePlugin);
        return new SimulationBridgeHost(world, {} as never);
    }

    it('counts step calls, ticks and snapshots, then starts over', async () => {
        const host = await makeHost();
        host.step(3);
        host.step(2);
        host.snapshot();
        const first = host.perfCounters();
        expect(first.stepCalls).toBe(2);
        expect(first.ticks).toBe(5);
        expect(first.snapshotCalls).toBe(1);
        expect(first.stepMs).toBeGreaterThanOrEqual(0);
        expect(first.stepCallMaxMs).toBeLessThanOrEqual(first.stepMs);
        expect(first.windowMs).toBeGreaterThanOrEqual(0);
        expect(first.rollbacks).toBe(0);

        const second = host.perfCounters();
        expect(second.stepCalls).toBe(0);
        expect(second.ticks).toBe(0);
        expect(second.snapshotCalls).toBe(0);
        expect(second.stepMs).toBe(0);
        expect(Object.keys(second.events)).toEqual([]);
    });

    it('tallies rollback events per window', async () => {
        const host = await makeHost();
        host.step(10);
        host.perfCounters();
        host.rewind(5);
        const window = host.perfCounters();
        expect(window.events['rewind']).toBe(1);
        expect(host.perfCounters().events['rewind']).toBeUndefined();
        // status() keeps its lifetime tally regardless.
        expect(host.status().rollbackEvents?.['rewind']).toBe(1);
    });

    it('does not change what the simulation does', async () => {
        const a = await makeHost();
        const b = await makeHost();
        a.step(4);
        a.perfCounters();
        a.step(4);
        b.step(8);
        expect(a.status().tick).toBe(b.status().tick);
        expect(a.entityHashes()).toEqual(b.entityHashes());
    });
});
