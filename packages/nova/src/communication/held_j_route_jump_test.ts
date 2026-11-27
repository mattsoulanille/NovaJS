import 'jasmine';
import { Subject } from 'rxjs';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { CommunicatorResource } from 'nova_ecs/plugins/multiplayer_plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { RollbackSimulation } from 'nova_ecs/plugins/rollback_plugin';
import { World } from 'nova_ecs/world';
import { isLeft } from 'fp-ts/lib/Either.js';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { ControlRouter, ControlRouteTargets } from '../client/control_routing.js';
import { ControlAction, ControlEvent } from '../nova_plugin/core/index.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { ControlledByComponent, PEER_LOCAL_COMPONENTS } from '../nova_plugin/player/index.js';
import { makeShip } from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import {
    ARRIVAL_JUMP_GRACE_MS, FinishJump, FinishJumpEvent, JUMP_DISTANCE,
    JumpComponent, JumpRouteComponent,
} from '../nova_plugin/travel/index.js';
import { RollbackRelay } from './rollback_relay.js';
import { RoomArchive } from './room_archive.js';
import { InputRecord } from './simulation_input.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';

/**
 * The held-j route jump (Matthew, 2026-11-23): "Sometimes, when jumping
 * along a route, if I un-press `j` before entering the next system, I'll
 * still jump again."
 *
 * Holding `j` chain-jumps along a route: a key held across a system
 * transition reaches the destination's simulation as its next
 * auto-repeat (client/control_routing.ts), and PlayerJumpControl
 * (nova_plugin/travel/jump_plugin.ts) starts the next hop on the first
 * tick a held key finds the arrived ship. The destination world goes
 * live, its ship already out of hyperspace, while the hyperspace flash
 * still covers the screen: a repeat in that window jumped a player who
 * let go before they could see the new system. The router now holds a
 * jump key's re-assert until the arrival is visible.
 *
 * Driven here end to end: the real router, a real bridge host per room,
 * real relays and archives, a two-hop route Thessaly -> Kestrel -> Vael.
 */
describe('the held-j route jump', () => {
    const PEER = 'a';
    const SHIP = 'ship a';
    const route = [SYNTHETIC.systems.kestrel, SYNTHETIC.systems.vael];

    interface Room {
        world: World;
        host: SimulationBridgeHost;
        client: SimulationBridgeClient;
        relay: RollbackRelay;
        archive: RoomArchive;
        finishJumps: FinishJump[];
        step(ticks?: number): Promise<void>;
    }
    const rooms: Room[] = [];

    afterEach(() => {
        for (const room of rooms.splice(0)) {
            room.relay.close();
        }
    });

    async function makeRoom(systemId: string): Promise<Room> {
        const gameData = await getSyntheticGameData();
        const comms = new Map([
            ['server', new MockCommunicator('server')],
            [PEER, new MockCommunicator(PEER)],
        ]);
        for (const comm of comms.values()) {
            comm.mockPeers = comms;
            comm.peers.current.next(new Set(comms.keys()));
        }
        let archive: RoomArchive | undefined;
        const relay = new RollbackRelay(comms.get('server')!, {
            autoClock: false,
            baseline: () => archive?.latest,
        });
        archive = new RoomArchive(relay, () => makeSystem(systemId, gameData,
            'node', { npcs: false }), { intervalTicks: 30, autoUpdate: false });
        const world = await makeSystem(systemId, gameData, 'worker',
            { npcs: false });
        world.resources.set(CommunicatorResource, comms.get(PEER)!);
        const host = new SimulationBridgeHost(world, gameData);
        const client = new SimulationBridgeClient(host,
            world.resources.get(SerializerResource)!);
        const finishJumps: FinishJump[] = [];
        world.events.get(FinishJumpEvent).subscribe(({ data }) => {
            // A rollback re-emits an already-forwarded departure; count
            // each ship's departure once.
            if (!finishJumps.some(seen => seen.uuid === data.uuid)) {
                finishJumps.push(data);
            }
        });
        const room: Room = {
            world, host, client, relay, archive, finishJumps,
            async step(ticks = 1) {
                for (let i = 0; i < ticks; i++) {
                    host.step();
                    relay.advanceTicks(1);
                    await archive!.update();
                    await new Promise(resolve => setImmediate(resolve));
                }
            },
        };
        rooms.push(room);
        return room;
    }

    const press = (state: ControlEvent['state']): ControlEvent[] =>
        [{ action: 'hyperjump' as ControlAction, state }];

    /** The room's bridge as the client's router sees it, one object per
     * room (the router tells systems apart by the bridge's identity). */
    const bridges = new Map<Room, NonNullable<ControlRouteTargets['bridge']>>();
    function bridgeOf(room: Room) {
        let bridge = bridges.get(room);
        if (!bridge) {
            bridge = {
                controlEvents: async (sim: ControlEvent[]) =>
                    room.host.controlEvents(sim),
            };
            bridges.set(room, bridge);
        }
        return bridge;
    }

    /** A fake page clock for the router (performance.now), in ms. */
    let now = 0;

    /** The client's router, aimed at a room's bridge (or at none). */
    function routeTo(router: ControlRouter, events: ControlEvent[],
        room: Room | undefined) {
        router.route(events, {
            consumeLocal: () => false,
            displayWorld: undefined,
            controlsSubject: new Subject<ControlEvent>(),
            bridge: room && bridgeOf(room),
            send: call => void call,
            now,
        });
    }

    /** One drawn client frame (the session's ticker): `hidden` while the
     * flash still covers the arrival. Advances the page clock a frame. */
    function frame(router: ControlRouter, room: Room, hidden: boolean) {
        now += 17;
        router.frame({
            bridge: bridgeOf(room),
            arrivalHidden: hidden,
            send: call => void call,
            now,
        });
    }

    /** Client frames, a simulation tick each, until the router has decided
     * the arrival (the first visible frame plus the decision delay). */
    async function showArrival(router: ControlRouter, room: Room) {
        for (let i = 0; i < 6; i++) {
            frame(router, room, false);
            await room.step();
        }
    }

    /**
     * Jumps out of Thessaly with `j` held and returns the destination room
     * with the carried ship inserted, as client/system_entry.ts does: the
     * departing entity crosses the bridge serialized, so only synced
     * components ride along.
     */
    async function departAndArrive(router: ControlRouter,
        { autoRepeat = true } = {}) {
        const origin = await makeRoom(SYNTHETIC.systems.thessaly);
        const gameData = await getSyntheticGameData();
        const ship = makeShip(await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
        ship.components.set(ControlledByComponent, { peerId: PEER });
        const movement = ship.components.get(MovementStateComponent)!;
        // Outside the no-jump zone, at rest.
        movement.position = new Position(0, -2 * JUMP_DISTANCE);
        movement.rotation = new Angle(0);
        movement.velocity = new Vector(0, 0);
        await completeEntity(origin.world, ship);
        await origin.client.addEntity(SHIP, ship);
        await origin.step(5);
        origin.host.setPlayerJumpRoute([...route]);
        await origin.step(5);
        // The origin's own arrival is long decided by the time the player
        // presses j.
        await showArrival(router, origin);
        routeTo(router, press('start'), origin);
        for (let i = 0; i < 1500 && origin.finishJumps.length === 0; i++) {
            // The key stays down: auto-repeat, which the router keeps
            // out of the input log (or none: a Mac stops repeating a key
            // once another one is pressed after it).
            if (autoRepeat) {
                routeTo(router, press('repeat'), origin);
            }
            await origin.step();
        }
        expect(origin.finishJumps.length)
            .withContext('the first jump departs').toBe(1);
        await origin.step(30);
        // Exactly one departure on every world of the origin room.
        for (const world of [origin.world, origin.archive.archiveWorld!]) {
            expect(world.entities.has(SHIP)).toBeFalse();
        }

        const destination = await makeRoom(SYNTHETIC.systems.kestrel);
        const fromSerializer = origin.world.resources.get(SerializerResource)!;
        const toSerializer = destination.world.resources.get(SerializerResource)!;
        const decoded = toSerializer.decode(
            fromSerializer.encode(origin.finishJumps[0]!.entity));
        if (isLeft(decoded)) {
            throw new Error('the carried ship did not decode');
        }
        const carried: Entity = decoded.right;
        await destination.client.addEntity(SHIP, carried);
        await destination.step(2);
        return { origin, destination };
    }

    function shipOf(world: World) {
        return world.entities.get(SHIP);
    }

    async function expectNoSecondJump(destination: Room) {
        await destination.step(300);
        expect(destination.finishJumps.length)
            .withContext('a jump out of the destination').toBe(0);
        for (const world of [destination.world,
            destination.archive.archiveWorld!]) {
            const ship = shipOf(world);
            expect(ship).withContext('the ship is still here').toBeDefined();
            expect(ship!.components.has(JumpComponent)).toBeFalse();
            // The next hop is still on the route, unflown.
            expect(ship!.components.get(JumpRouteComponent)?.route)
                .toEqual([SYNTHETIC.systems.vael]);
        }
        expect(hashWorld(destination.archive.archiveWorld!,
            PEER_LOCAL_COMPONENTS).hash)
            .toBe(hashWorld(destination.world, PEER_LOCAL_COMPONENTS).hash);
        // The rollback replay: restore 120 ticks back and resimulate the
        // same input records. Still exactly one jump, same state.
        const rollback = (destination.host as unknown as {
            rollback: RollbackSimulation<InputRecord[]>,
        }).rollback;
        const before = hashWorld(destination.world, PEER_LOCAL_COMPONENTS).hash;
        expect(rollback.rollbackTo(rollback.tick - 120)).toBeTrue();
        expect(hashWorld(destination.world, PEER_LOCAL_COMPONENTS).hash)
            .toBe(before);
        expect(shipOf(destination.world)!.components.has(JumpComponent))
            .toBeFalse();
    }

    /** The destination ship's next jump, on the peer and the archive. */
    async function expectSecondJump(destination: Room) {
        await destination.step(3);
        expect(shipOf(destination.world)?.components.get(JumpComponent)?.to)
            .withContext('the peer jumps on').toBe(SYNTHETIC.systems.vael);
        await destination.step(30);
        expect(shipOf(destination.archive.archiveWorld!)
            ?.components.get(JumpComponent)?.to)
            .withContext('the archive jumps on').toBe(SYNTHETIC.systems.vael);
        expect(hashWorld(destination.archive.archiveWorld!,
            PEER_LOCAL_COMPONENTS).hash)
            .toBe(hashWorld(destination.world, PEER_LOCAL_COMPONENTS).hash);
    }

    /** The arrival, hidden behind the flash for `frames` client frames
     * (a simulation tick each), with the key auto-repeating if `held`. */
    async function hiddenArrival(router: ControlRouter, destination: Room,
        frames: number, held: boolean) {
        for (let i = 0; i < frames; i++) {
            if (held) {
                routeTo(router, press('repeat'), destination);
            }
            frame(router, destination, true);
            await destination.step();
        }
    }

    function distanceOf(room: Room) {
        return shipOf(room.world)!.components.get(MovementStateComponent)!
            .position.length;
    }

    it('released mid-transit (no system live): exactly one jump, on every world, through a rollback replay', async () => {
        const router = new ControlRouter();
        const { destination } = await departAndArrive(router);
        // (The release happened while no system was live; routeTo with no
        // room is what the client does with it.)
        routeTo(router, press(false), undefined);
        await hiddenArrival(router, destination, 10, false);
        await showArrival(router, destination);
        await expectNoSecondJump(destination);
    }, 120_000);

    it('released after the destination went live but before it was visible: exactly one jump', async () => {
        const router = new ControlRouter();
        const { destination } = await departAndArrive(router);
        // The destination is live behind the flash; the key is still
        // down, so it auto-repeats, and is let go before the flash clears.
        await hiddenArrival(router, destination, 10, true);
        routeTo(router, press(false), destination);
        await destination.step();
        await showArrival(router, destination);
        await expectNoSecondJump(destination);
    }, 120_000);

    it('(the 2026-11-26 report) released during the arrival\'s long first frame: the repeats queued behind it do not jump', async () => {
        const router = new ControlRouter();
        const { destination } = await departAndArrive(router);
        await hiddenArrival(router, destination, 3, true);
        // The first frame that shows the system is a long one, and the
        // flash clears inside it. The key events the player made during
        // it (repeats, then the release, all while the screen was still
        // white) are dispatched behind it, onto a visible arrival.
        frame(router, destination, false);
        await destination.step();
        for (let i = 0; i < 5; i++) {
            routeTo(router, press('repeat'), destination);
        }
        routeTo(router, press(false), destination);
        await showArrival(router, destination);
        await expectNoSecondJump(destination);
    }, 120_000);

    it('a tap on the white screen does not carry into the next system', async () => {
        const router = new ControlRouter();
        const { destination } = await departAndArrive(router);
        routeTo(router, press(false), undefined);
        await hiddenArrival(router, destination, 2, false);
        routeTo(router, press('start'), destination);
        await hiddenArrival(router, destination, 2, false);
        routeTo(router, press(false), destination);
        await showArrival(router, destination);
        await expectNoSecondJump(destination);
    }, 120_000);

    it('held through the arrival: keeps chaining, as before', async () => {
        const router = new ControlRouter();
        const { destination } = await departAndArrive(router);
        await hiddenArrival(router, destination, 5, true);
        // The flash clears with the key still down: the router re-asserts
        // it, and the route's next hop starts.
        await showArrival(router, destination);
        await expectSecondJump(destination);
    }, 120_000);

    it('held through the arrival WITHOUT auto-repeat: still chains (the router follows the key itself)', async () => {
        const router = new ControlRouter();
        const { destination } = await departAndArrive(router,
            { autoRepeat: false });
        await hiddenArrival(router, destination, 5, false);
        await showArrival(router, destination);
        await expectSecondJump(destination);
    }, 120_000);

    it('pressed on the white screen and held: jumps once the arrival shows', async () => {
        const router = new ControlRouter();
        const { destination } = await departAndArrive(router);
        routeTo(router, press(false), undefined);
        await hiddenArrival(router, destination, 3, false);
        routeTo(router, press('start'), destination);
        await hiddenArrival(router, destination, 3, true);
        await showArrival(router, destination);
        await expectSecondJump(destination);
    }, 120_000);

    it('held through an arrival so slow to show that the ship has coasted into the no-jump zone: the arrival grace still chains', async () => {
        const router = new ControlRouter();
        const { destination } = await departAndArrive(router);
        // 1.5 s behind the flash: one second of flight takes the ship
        // inside the zone.
        await hiddenArrival(router, destination, 90, true);
        expect(distanceOf(destination)).toBeLessThan(JUMP_DISTANCE);
        await showArrival(router, destination);
        await expectSecondJump(destination);
    }, 120_000);

    it('past the arrival grace, the no-jump zone refuses a held key again', async () => {
        const router = new ControlRouter();
        const { destination } = await departAndArrive(router);
        await hiddenArrival(router, destination,
            Math.ceil(ARRIVAL_JUMP_GRACE_MS / 1000 * 60) + 10, true);
        expect(distanceOf(destination)).toBeLessThan(JUMP_DISTANCE);
        await showArrival(router, destination);
        await expectNoSecondJump(destination);
    }, 120_000);
});
