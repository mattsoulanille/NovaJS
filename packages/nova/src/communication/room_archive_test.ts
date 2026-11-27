import 'jasmine';
import { World } from 'nova_ecs/world';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { CommunicatorResource } from 'nova_ecs/plugins/multiplayer_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { makeSystem } from '../nova_plugin/make_system.js';
import { ControlledByComponent, PEER_LOCAL_COMPONENTS } from '../nova_plugin/player/index.js';
import { makeShip } from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import { RollbackRelay } from './rollback_relay.js';
import { RoomArchive } from './room_archive.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { applyInputRecords, InputRecord, loadInputRecordsGameData } from './simulation_input.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';

// The archive's periodic update builds the room's world lazily via
// makeSystem, whose genesis loads reject when game data stays
// unloadable (#60). The interval callback must catch that: an
// unhandled rejection kills the server process under Node's default
// --unhandled-rejections=throw, taking every room's relay with it.
describe('RoomArchive periodic update', () => {
    // Enough for a rejecting makeWorld: update never reaches the relay
    // before construction fails, and a fresh world at tick 0 has
    // nothing to step to.
    const relay = { tick: 0, inputLog: [], trimLog() { } } as unknown as RollbackRelay;
    let archive: RoomArchive | undefined;

    beforeEach(() => {
        jasmine.clock().install();
    });

    afterEach(() => {
        archive?.close();
        archive = undefined;
        jasmine.clock().uninstall();
    });

    /** Lets the rejection propagate through update()'s await chain. */
    async function settle() {
        for (let i = 0; i < 10; i++) {
            await Promise.resolve();
        }
        await new Promise(resolve => setImmediate(resolve));
    }

    it('logs a failed world build instead of leaking an unhandled rejection', async () => {
        const error = spyOn(console, 'error');
        archive = new RoomArchive(relay, () => Promise.reject(
            new Error('Failed to load düde nova:128 after 3 attempts')),
            { name: 'nova:128' });

        jasmine.clock().tick(1000);
        await settle();

        // Jasmine fails the running spec on an unhandled rejection,
        // so reaching this line at all is the guard; the log is the
        // observable trace. With no world yet, the archive is at tick 0.
        expect(error).toHaveBeenCalledWith(jasmine.stringMatching(
            /Archive nova:128 update failed at tick 0: .*düde nova:128/));
        expect(archive.archiveWorld).toBeUndefined();
    });

    it('retries construction on the next tick after a failed build', async () => {
        spyOn(console, 'error');
        let attempts = 0;
        archive = new RoomArchive(relay, async () => {
            attempts++;
            if (attempts === 1) {
                throw new Error('transient');
            }
            return new World('archive');
        });

        jasmine.clock().tick(1000);
        await settle();
        expect(attempts).toBe(1);
        expect(archive.archiveWorld).toBeUndefined();

        jasmine.clock().tick(1000);
        await settle();
        expect(attempts).toBe(2);
        expect(archive.archiveWorld).toBeDefined();
    });
});

/**
 * The archive's periodic update ran as `void this.update()`: one
 * rejection — a record this world could not stage, a plug-in system
 * throwing on construction — was an unhandled rejection, which exits
 * the server process under Node's default --unhandled-rejections=throw.
 * Against a real relay, and listening for the stray rejection itself.
 */
describe('RoomArchive', () => {
    it('a failing periodic update is reported, never an unhandled rejection',
        async () => {
            const server = new MockCommunicator('server');
            const relay = new RollbackRelay(server, { autoClock: false });
            const unhandled: unknown[] = [];
            const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
            process.on('unhandledRejection', onUnhandled);
            const errors = spyOn(console, 'error');
            // Real timers are not mocked: let the promise chain of a
            // failed update settle completely between intervals.
            const settle = () => new Promise(resolve => setImmediate(resolve));
            jasmine.clock().install();
            let attempts = 0;
            const archive = new RoomArchive(relay, async () => {
                attempts++;
                throw new Error('makeSystem exploded');
            }, { name: 'nova:130' });
            try {
                // Two intervals: the first failure must not stop the
                // second attempt either.
                jasmine.clock().tick(1001);
                await settle();
                jasmine.clock().tick(1001);
                await settle();
            } finally {
                archive.close();
                jasmine.clock().uninstall();
            }
            // Let any stray rejection surface before asserting.
            await new Promise(resolve => setTimeout(resolve, 5));
            process.off('unhandledRejection', onUnhandled);
            relay.close();
            expect(attempts).toBe(2);
            expect(unhandled).toEqual([]);
            expect(errors).toHaveBeenCalledTimes(2);
        });
});

/**
 * The archive's update yields to the event loop every few ticks (it
 * shares the server's one loop with every room's relay; a busy 2x room's
 * catch-up blocked it for hundreds of ms a second). Yielding must change
 * nothing about the world it computes: these step a real system with a
 * player's inputs and compare against one synchronous pass over the
 * same log — the old update loop, inlined.
 */
describe('RoomArchive chunked update', () => {
    let comms: Map<string, MockCommunicator>;
    let relay: RollbackRelay;
    const archives: RoomArchive[] = [];

    beforeEach(() => {
        comms = new Map([
            ['server', new MockCommunicator('server')],
            ['a', new MockCommunicator('a')],
        ]);
        for (const comm of comms.values()) {
            comm.mockPeers = comms;
            comm.peers.current.next(new Set(comms.keys()));
        }
        relay = new RollbackRelay(comms.get('server')!,
            { autoClock: false, roomSeed: 0x5eed });
    });

    afterEach(() => {
        for (const archive of archives.splice(0)) {
            archive.close();
        }
        relay.close();
    });

    async function systemId() {
        const ids = await (await getSyntheticGameData()).ids;
        return [...ids.System].sort()[0]!;
    }

    /** The archive's world: NPC traffic on, so every tick moves things. */
    async function makeArchiveWorld() {
        return makeSystem(await systemId(), await getSyntheticGameData(),
            'node', { npcs: true });
    }

    /** A flying peer whose records feed the relay's log. */
    async function makeFlyingPeer() {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(await systemId(), gameData, 'worker',
            { npcs: false });
        world.resources.set(CommunicatorResource, comms.get('a')!);
        const host = new SimulationBridgeHost(world, gameData);
        const client = new SimulationBridgeClient(host,
            world.resources.get(SerializerResource)!);
        const ids = await gameData.ids;
        const ship = makeShip(await gameData.data.Ship.get([...ids.Ship].sort()[0]!));
        ship.components.set(ControlledByComponent, { peerId: 'a' });
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(100, 50);
        movement.rotation = new Angle(1);
        movement.velocity = new Vector(0, 0);
        await completeEntity(world, ship);
        await client.addEntity('ship a', ship);
        return host;
    }

    /** Advances the relay and the peer together, playing `inputs`. */
    function play(host: SimulationBridgeHost, ticks: number,
        inputs: Map<number, Parameters<SimulationBridgeHost['controlEvents']>[0]>) {
        for (let i = 0; i < ticks; i++) {
            relay.advanceTicks(1);
            const events = inputs.get(relay.tick);
            if (events) {
                host.controlEvents(events);
            }
            host.step();
        }
    }

    const frame = (world: World) => world.resources.get(TimeResource)!.frame;

    it('reaches the same world and checkpoint hashes as one synchronous pass, '
        + 'with records logged while it yields', async () => {
        const host = await makeFlyingPeer();
        play(host, 200, new Map([
            [5, [{ action: 'accelerate', state: 'start' }]],
            [40, [{ action: 'turnLeft', state: 'start' }]],
            [75, [{ action: 'turnLeft', state: false }]],
            [130, [{ action: 'accelerate', state: false }]],
        ]));
        const archive = new RoomArchive(relay, makeArchiveWorld,
            { autoUpdate: false });
        archives.push(archive);
        await archive.update();  // builds the world, then steps to 200
        expect(archive.tick).toBe(200);
        play(host, 100, new Map());

        // The second update runs from 200 to 300 in chunks. At each
        // yield the room carries on: the relay's clock moves and the
        // peer plays an input, logged for a tick after 300 — it must
        // wait for the next update, not slip into this one.
        const seenMidUpdate: number[] = [];
        let midUpdateInputs = [
            [{ action: 'turnRight', state: 'start' }],
            [{ action: 'turnRight', state: false }],
            [{ action: 'accelerate', state: 'start' }],
        ] as Parameters<SimulationBridgeHost['controlEvents']>[0][];
        let updating = true;
        const onYield = () => {
            if (!updating) {
                return;
            }
            seenMidUpdate.push(archive.tick);
            const events = midUpdateInputs.shift();
            if (events) {
                host.controlEvents(events);
            }
            relay.advanceTicks(3);
            host.step(3);
            setImmediate(onYield);
        };
        const update = archive.update();
        setImmediate(onYield);
        await update;
        updating = false;
        expect(archive.tick).toBe(300);
        // It did yield, mid-catch-up.
        expect(seenMidUpdate.some(tick => tick > 200 && tick < 300)).toBeTrue();
        const midUpdateRecords = relay.inputLog.filter(record =>
            record.peerId === 'a' && record.tick > 300);
        expect(midUpdateRecords.length).toBeGreaterThan(0);
        await archive.update();
        const target = relay.tick;
        expect(target).toBeGreaterThan(300);
        expect(archive.tick).toBe(target);

        // The same log in one synchronous pass (the update loop as it was
        // before the chunking), hashing the same checkpoints.
        const log: InputRecord[] = [...relay.inputLog];
        const reference = await makeArchiveWorld();
        await loadInputRecordsGameData(reference, log);
        const byTick = new Map<number, InputRecord[]>();
        for (const record of log) {
            byTick.set(record.tick, [...byTick.get(record.tick) ?? [], record]);
        }
        const referenceHashes = new Map<number, string>();
        while (frame(reference) < target) {
            const records = byTick.get(frame(reference) + 1);
            if (records) {
                applyInputRecords(reference, records);
            }
            reference.step();
            if (frame(reference) % 60 === 0) {
                referenceHashes.set(frame(reference),
                    hashWorld(reference, PEER_LOCAL_COMPONENTS).hash);
            }
        }
        expect(referenceHashes.size).toBeGreaterThanOrEqual(5);
        for (const [tick, hash] of referenceHashes) {
            expect(`${tick}: ${archive.hashAt(tick)}`).toEqual(`${tick}: ${hash}`);
        }
        expect(hashWorld(archive.archiveWorld!, PEER_LOCAL_COMPONENTS).hash)
            .toEqual(hashWorld(reference, PEER_LOCAL_COMPONENTS).hash);
        // The peer's ship is in both, flying on the mid-update inputs.
        expect(archive.archiveWorld!.entities.has('ship a')).toBeTrue();
    }, 240_000);

    it('stops at the next yield when closed mid-update, and stays stopped',
        async () => {
            const archive = new RoomArchive(relay, makeArchiveWorld,
                { autoUpdate: false, intervalTicks: 60 });
            archives.push(archive);
            await archive.update();
            relay.advanceTicks(200);
            const update = archive.update();
            // Close at the first yield that finds it stepping.
            const closeOnceStepping = () => {
                if (archive.tick > 0) {
                    archive.close();
                } else {
                    setImmediate(closeOnceStepping);
                }
            };
            setImmediate(closeOnceStepping);
            await update;
            const stoppedAt = archive.tick;
            expect(stoppedAt).toBeGreaterThan(0);
            expect(stoppedAt).toBeLessThan(200);
            // No baseline from the abandoned catch-up, and no more steps.
            expect(archive.latest).toBeUndefined();
            await archive.update();
            expect(archive.tick).toBe(stoppedAt);
        }, 240_000);
});
