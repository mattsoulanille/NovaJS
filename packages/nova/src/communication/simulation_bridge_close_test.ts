import 'jasmine';
import { Serializer } from 'nova_ecs/plugins/serializer_plugin';
import {
    AsyncSimulationBridgeClient,
    SimulationBridgeClosedError,
} from './async_simulation_bridge_client.js';
import { AsyncSimulationBridgeHostApi } from './simulation_bridge_api.js';

/**
 * Regression coverage for the transit hang (hypergate black screen /
 * two-window jump white screen): closing a bridge terminates its
 * worker, and a comlink call that is in flight at that moment NEVER
 * settles — the terminated worker cannot reply. The browser's frame
 * pump awaited such a call (step/snapshot on the origin system's
 * bridge, raced by jumpTo's close), stayed "in flight" forever, and so
 * never stepped the destination system: the arriving ship's insertion
 * record was never stamped or published, and the traveler existed
 * nowhere. close() must settle every in-flight and future call.
 */
describe('AsyncSimulationBridgeClient close', () => {
    /** A host whose calls hang forever, like a terminated worker. */
    function makeHangingHost(): AsyncSimulationBridgeHostApi {
        const never = () => new Promise<never>(() => { });
        return {
            controlEvents: never,
            analogControl: never,
            setTarget: never,
            step: never,
            snapshot: never,
            addEntity: never,
            removeEntity: never,
            setPlayerJumpRoute: never,
            spawnNpc: never,
            rewind: never,
            resync: never,
            status: never,
            entityHashes: never,
        } as unknown as AsyncSimulationBridgeHostApi;
    }

    const fakeSerializer = { encode: (e: unknown) => e } as unknown as Serializer;

    it('settles calls that are in flight when close() runs', async () => {
        const client = new AsyncSimulationBridgeClient(
            makeHangingHost(), fakeSerializer);
        const inFlight = client.step(60);
        const alsoInFlight = client.snapshot();
        await client.close();
        await expectAsync(inFlight).toBeRejectedWithError(
            SimulationBridgeClosedError, 'Simulation bridge closed');
        await expectAsync(alsoInFlight).toBeRejectedWithError(
            SimulationBridgeClosedError, 'Simulation bridge closed');
    });

    it('rejects calls issued after close()', async () => {
        const client = new AsyncSimulationBridgeClient(
            makeHangingHost(), fakeSerializer);
        await client.close();
        await expectAsync(client.step()).toBeRejectedWithError(
            SimulationBridgeClosedError, 'Simulation bridge closed');
        await expectAsync(client.removeEntity('uuid')).toBeRejectedWithError(
            SimulationBridgeClosedError, 'Simulation bridge closed');
    });

    it('runs the close implementation exactly as before', async () => {
        let closed = 0;
        const client = new AsyncSimulationBridgeClient(
            makeHangingHost(), fakeSerializer, () => { closed++; });
        await client.close();
        expect(closed).toBe(1);
    });

    it('does not wedge a pump-shaped loop that raced the close', async () => {
        // The browser's pump: one frame at a time, guarded by an
        // in-flight flag. Before the fix, a frame awaiting the old
        // bridge when jumpTo closed it kept the flag set forever and
        // no later frame ever ran.
        const oldBridge = new AsyncSimulationBridgeClient(
            makeHangingHost(), fakeSerializer);
        let inFlight = false;
        let framesCompleted = 0;
        async function pumpFrame(bridge: AsyncSimulationBridgeClient) {
            if (inFlight) {
                return;
            }
            inFlight = true;
            try {
                await bridge.step(1);
            } catch (e) {
                if (!(e instanceof SimulationBridgeClosedError)) {
                    throw e;
                }
            } finally {
                inFlight = false;
                framesCompleted++;
            }
        }
        const wedgedFrame = pumpFrame(oldBridge);
        // The transit tears the old bridge down mid-frame.
        await oldBridge.close();
        await wedgedFrame;
        expect(inFlight).toBeFalse();
        expect(framesCompleted).toBe(1);
    });

    it('passes through results from a live host', async () => {
        const host = {
            ...makeHangingHost(),
            status: async () => ({ tick: 7, desyncCount: 0 }),
        } as unknown as AsyncSimulationBridgeHostApi;
        const client = new AsyncSimulationBridgeClient(host, fakeSerializer);
        expect((await client.status()).tick).toBe(7);
    });
});
