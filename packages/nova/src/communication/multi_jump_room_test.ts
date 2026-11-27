import 'jasmine';
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
import { makeSystem } from '../nova_plugin/make_system.js';
import { ControlledByComponent, PEER_LOCAL_COMPONENTS } from '../nova_plugin/player/index.js';
import {
    FuelComponent, FUEL_PER_JUMP, makeShip, OutfitsStateComponent,
    ShipPhysicsComponent,
} from '../nova_plugin/ship/index.js';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import {
    FinishJump, FinishJumpEvent, JUMP_DISTANCE, JumpComponent,
    JumpRouteComponent,
} from '../nova_plugin/travel/index.js';
import { RollbackRelay } from './rollback_relay.js';
import { RoomArchive } from './room_archive.js';
import { InputRecord } from './simulation_input.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';

/**
 * A multi-jump (oütf ModType 32) across real rooms: "A multi jump looks
 * just like a normal jump" (Matthew, 2026-11-27). The traveller leaves
 * Thessaly Reach with a two-hop route (Kestrel Drift, Vael Hollow) and an
 * outfit worth two hops (ModVal 2); a second player sits in Kestrel Drift, the
 * system passed through. One departure (one FinishJumpEvent, to Vael), one
 * fuel charge, the same on the peer and the archive and through a rollback
 * replay; the carried entity's multi-jump fields cross the wire; and the
 * room in Kestrel Drift never sees the traveller: no record of it is ever
 * logged there and its worlds never hold it.
 */
describe('a multi-jump across rooms', () => {
    const TRAVELLER = 'a';
    const BYSTANDER = 'b';
    const SHIP_A = 'ship a';
    const SHIP_B = 'ship b';
    const MULTI_JUMP_OUTFIT = 'test:multi-jump drive';

    interface Room {
        world: World;
        host: SimulationBridgeHost;
        client: SimulationBridgeClient;
        relay: RollbackRelay;
        archive: RoomArchive;
        finishJumps: FinishJump[];
        loggedAdds: Set<string>;
        step(ticks?: number): Promise<void>;
    }
    const rooms: Room[] = [];

    afterEach(() => {
        for (const room of rooms.splice(0)) {
            room.relay.close();
        }
    });

    async function makeRoom(systemId: string, peer: string): Promise<Room> {
        const gameData = await getSyntheticGameData();
        const comms = new Map([
            ['server', new MockCommunicator('server')],
            [peer, new MockCommunicator(peer)],
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
        world.resources.set(CommunicatorResource, comms.get(peer)!);
        const host = new SimulationBridgeHost(world, gameData);
        const client = new SimulationBridgeClient(host,
            world.resources.get(SerializerResource)!);
        const finishJumps: FinishJump[] = [];
        world.events.get(FinishJumpEvent).subscribe(({ data }) => {
            // A rollback re-emits an already-forwarded departure.
            if (!finishJumps.some(seen => seen.uuid === data.uuid)) {
                finishJumps.push(data);
            }
        });
        const loggedAdds = new Set<string>();
        const room: Room = {
            world, host, client, relay, archive, finishJumps, loggedAdds,
            async step(ticks = 1) {
                for (let i = 0; i < ticks; i++) {
                    host.step();
                    relay.advanceTicks(1);
                    // Every insertion the room ever logged (the log itself
                    // is trimmed behind the archive's baselines).
                    for (const record of relay.inputLog) {
                        for (const input of record.inputs) {
                            if (input.kind === 'addEntity') {
                                loggedAdds.add(input.uuid);
                            }
                        }
                    }
                    await archive!.update();
                    await new Promise(resolve => setImmediate(resolve));
                }
            },
        };
        rooms.push(room);
        return room;
    }

    async function makePlayerShip(peer: string, multiJump: number) {
        const gameData = await getSyntheticGameData();
        const ship = makeShip(await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
        if (multiJump > 0) {
            // The synthetic set has no ModType 32 oütf, so one is added
            // under an id nothing else asks for (the shared cache's other
            // entries are untouched). The outfit state rides the insertion
            // record, so every peer and the archive derive the same
            // physics from it.
            const base = getDefaultOutfitData();
            const outfit: OutfitData = {
                ...base, id: MULTI_JUMP_OUTFIT, name: 'Test Multi-Jump Drive',
                physics: { ...base.physics, multiJump },
            };
            gameData.data.Outfit.gotten[MULTI_JUMP_OUTFIT] = outfit;
            const outfits = new Map(ship.components.get(OutfitsStateComponent));
            outfits.set(MULTI_JUMP_OUTFIT, { count: 1 });
            ship.components.set(OutfitsStateComponent, outfits);
        }
        ship.components.set(ControlledByComponent, { peerId: peer });
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, -2 * JUMP_DISTANCE);
        movement.rotation = new Angle(0);
        movement.velocity = new Vector(0, 0);
        return ship;
    }

    it('departs once, arrives once in the last system, and is never seen '
        + 'in the system passed through', async () => {
            // The bystander, sitting in the system on the route.
            const passedThrough = await makeRoom(SYNTHETIC.systems.kestrel,
                BYSTANDER);
            const bystanderShip = await makePlayerShip(BYSTANDER, 0);
            await completeEntity(passedThrough.world, bystanderShip);
            await passedThrough.client.addEntity(SHIP_B, bystanderShip);
            await passedThrough.step(5);

            const origin = await makeRoom(SYNTHETIC.systems.thessaly,
                TRAVELLER);
            const traveller = await makePlayerShip(TRAVELLER, 2);
            await completeEntity(origin.world, traveller);
            await origin.client.addEntity(SHIP_A, traveller);
            await origin.step(5);
            origin.host.setPlayerJumpRoute(
                [SYNTHETIC.systems.kestrel, SYNTHETIC.systems.vael]);
            await origin.step(5);
            expect(origin.world.entities.get(SHIP_A)!
                .components.get(ShipPhysicsComponent)?.multiJump).toBe(2);
            const fuelBefore = origin.world.entities.get(SHIP_A)!
                .components.get(FuelComponent)!.current;
            origin.host.controlEvents(
                [{ action: 'hyperjump', state: 'start' }]);
            await origin.step();
            origin.host.controlEvents(
                [{ action: 'hyperjump', state: false }]);
            for (let i = 0; i < 1500 && origin.finishJumps.length === 0; i++) {
                await origin.step();
                await passedThrough.step();
            }
            await origin.step(30);
            await passedThrough.step(30);

            // ONE departure, straight to the last system.
            expect(origin.finishJumps.map(finish => finish.to))
                .toEqual([SYNTHETIC.systems.vael]);
            for (const world of [origin.world, origin.archive.archiveWorld!]) {
                expect(world.entities.has(SHIP_A)).toBeFalse();
            }
            expect(hashWorld(origin.archive.archiveWorld!,
                PEER_LOCAL_COMPONENTS).hash)
                .toBe(hashWorld(origin.world, PEER_LOCAL_COMPONENTS).hash);
            const rollback = (origin.host as unknown as {
                rollback: RollbackSimulation<InputRecord[]>,
            }).rollback;
            expect(rollback.rollbackTo(rollback.tick - 60)).toBeTrue();
            expect(hashWorld(origin.world, PEER_LOCAL_COMPONENTS).hash)
                .toBe(hashWorld(origin.archive.archiveWorld!,
                    PEER_LOCAL_COMPONENTS).hash);

            // The carried ship crosses the wire with its multi-jump.
            const destination = await makeRoom(SYNTHETIC.systems.vael,
                TRAVELLER);
            const decoded = destination.world.resources.get(SerializerResource)!
                .decode(origin.world.resources.get(SerializerResource)!
                    .encode(origin.finishJumps[0]!.entity));
            if (isLeft(decoded)) {
                throw new Error('the carried ship did not decode');
            }
            const carried: Entity = decoded.right;
            const carriedJump = carried.components.get(JumpComponent)!;
            expect(carriedJump.stage).toBe('arriving');
            expect(carriedJump.via).toEqual([SYNTHETIC.systems.kestrel]);
            // One jump's fuel for both systems.
            expect(carried.components.get(FuelComponent)!.current)
                .toBe(fuelBefore - FUEL_PER_JUMP);
            await destination.client.addEntity(SHIP_A, carried);
            await destination.step(40);
            for (const world of [destination.world,
                destination.archive.archiveWorld!]) {
                const arrived = world.entities.get(SHIP_A);
                expect(arrived).toBeDefined();
                expect(arrived!.components.has(JumpComponent)).toBeFalse();
                expect(arrived!.components.get(JumpRouteComponent)?.route)
                    .toEqual([]);
            }
            expect(destination.finishJumps.length).toBe(0);
            expect(hashWorld(destination.archive.archiveWorld!,
                PEER_LOCAL_COMPONENTS).hash)
                .toBe(hashWorld(destination.world, PEER_LOCAL_COMPONENTS).hash);

            // The system passed through never saw the traveller.
            await passedThrough.step(60);
            for (const world of [passedThrough.world,
                passedThrough.archive.archiveWorld!]) {
                expect(world.entities.has(SHIP_A)).toBeFalse();
                expect(world.entities.has(SHIP_B)).toBeTrue();
            }
            expect([...passedThrough.loggedAdds]).toEqual([SHIP_B]);
            expect([...destination.loggedAdds]).toEqual([SHIP_A]);
            expect(hashWorld(passedThrough.archive.archiveWorld!,
                PEER_LOCAL_COMPONENTS).hash)
                .toBe(hashWorld(passedThrough.world,
                    PEER_LOCAL_COMPONENTS).hash);
        }, 240_000);
});
