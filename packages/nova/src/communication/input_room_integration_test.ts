import 'jasmine';
import { CommunicatorResource } from 'nova_ecs/plugins/multiplayer_plugin';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { makeShip } from '../nova_plugin/ship/make_ship.js';
import { makeNpc } from '../nova_plugin/npc/npc_plugin.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { completeEntity } from '../nova_plugin/spawn/entity_data_loader.js';
import { ControlledByComponent, PEER_LOCAL_COMPONENTS } from '../nova_plugin/player/ship_control.js';
import { ShipDataComponent } from '../nova_plugin/ship/ship_plugin.js';
import { TargetComponent } from '../nova_plugin/ship/target_component.js';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { Position } from 'nova_ecs/datatypes/position';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Vector } from 'nova_ecs/datatypes/vector';
import { DesyncInfo, RollbackRelay } from './rollback_relay.js';
import { RoomArchive } from './room_archive.js';
import { DesyncDump, InputRecord, unwrapRollbackMessage } from './rollback_protocol.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { getIntegrationGameData } from './simulation_test_fixture.js';

/**
 * The pure input-driven room, end to end with real bridge hosts and a
 * real relay (mock sockets): peers exchange only input records, and
 * their worlds converge to identical state.
 */
describe('Input-driven rooms', () => {
    let comms: Map<string, MockCommunicator>;
    let relay: RollbackRelay;

    beforeEach(() => {
        comms = new Map([
            ['server', new MockCommunicator('server')],
            ['a', new MockCommunicator('a')],
            ['b', new MockCommunicator('b')],
        ]);
        for (const comm of comms.values()) {
            comm.mockPeers = comms;
            comm.peers.current.next(new Set(comms.keys()));
        }
        relay = new RollbackRelay(comms.get('server')!, { autoClock: false });
    });

    afterEach(() => {
        relay.close();
    });

    // Most specs here are choreography-sensitive (pinned systems,
    // marginal dogfights), so peers default to npcs: false — the same
    // adaptation as pinning the bay-escort spec to an asteroid-free
    // system. Every world in a room (peers AND the archive) must agree
    // on the flag: it is genesis state. The NPC-traffic spec opts in.
    async function makePeer(peerId: string, systemId?: string,
        options?: ConstructorParameters<typeof SimulationBridgeHost>[2],
        HostClass: typeof SimulationBridgeHost = SimulationBridgeHost,
        npcs = false) {
        const gameData = await getIntegrationGameData();
        const ids = await gameData.ids;
        systemId ??= [...ids.System].sort()[0]!;
        const world = await makeSystem(systemId, gameData, 'worker', { npcs });
        world.resources.set(CommunicatorResource, comms.get(peerId)!);
        const host = new HostClass(world, gameData, options);
        const serializer = world.resources.get(
            (await import('nova_ecs/plugins/serializer_plugin')).SerializerResource)!;
        const client = new SimulationBridgeClient(host, serializer);
        return { world, host, client };
    }

    async function makePeerShip(peerId: string, world: World) {
        const gameData = await getIntegrationGameData();
        const ids = await gameData.ids;
        const shipData = await gameData.data.Ship.get([...ids.Ship].sort()[0]!);
        const ship = makeShip(shipData);
        ship.components.set(ControlledByComponent, { peerId });
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(peerId === 'a' ? 100 : -100, 50);
        movement.rotation = new Angle(1);
        movement.velocity = new Vector(0, 0);
        await completeEntity(world, ship);
        return ship;
    }

    it('converges two peers exchanging only input records', async () => {
        const peerA = await makePeer('a');
        const peerB = await makePeer('b');

        // Each peer inserts its own ship (an input record, relayed).
        // Ship a carries a STALE saved secondary selection (a weapon
        // its loadout does not own): looking it up must never create
        // a phantom WeaponsState entry — WeaponsState is a DefaultMap,
        // and a created-on-lookup entry is hashed state that survives
        // only on worlds that never wire-restore (the archive), the
        // archive-vs-everyone desync class.
        const shipA = await makePeerShip('a', peerA.world);
        const { ActiveSecondaryWeapon } =
            await import('../nova_plugin/combat/weapon_plugin.js');
        shipA.components.set(ActiveSecondaryWeapon,
            { secondary: 'bogus:999' });
        await peerA.client.addEntity('ship a', shipA);
        await peerB.client.addEntity('ship b', await makePeerShip('b', peerB.world));

        for (let tick = 1; tick <= 120; tick++) {
            if (tick === 10) {
                peerA.host.controlEvents([{ action: 'accelerate', state: 'start' }]);
            }
            if (tick === 20) {
                peerB.host.controlEvents([{ action: 'turnLeft', state: 'start' }]);
                peerB.host.controlEvents([{ action: 'firePrimary', state: 'start' }]);
            }
            peerA.host.step();
            peerB.host.step();
            // Insertion records integrate after async staging; real
            // clients await every step, so yield like they do.
            await new Promise(resolve => setImmediate(resolve));
        }
        // A few quiet ticks so the final records cross over.
        for (let i = 0; i < 5; i++) {
            peerA.host.step();
            peerB.host.step();
            await new Promise(resolve => setImmediate(resolve));
        }

        const hashA = hashWorld(peerA.world, PEER_LOCAL_COMPONENTS);
        const hashB = hashWorld(peerB.world, PEER_LOCAL_COMPONENTS);
        expect(hashA.hash).toEqual(hashB.hash);
        // The stale secondary created no phantom weapon entry.
        const { WeaponsStateComponent } =
            await import('../nova_plugin/ship/weapons_state.js');
        for (const peer of [peerA, peerB]) {
            const weapons = peer.world.entities.get('ship a')!
                .components.get(WeaponsStateComponent)!;
            expect(weapons.has('bogus:999')).toBeFalse();
        }
        // Both worlds contain both ships.
        expect(peerA.world.entities.has('ship a')).toBeTrue();
        expect(peerA.world.entities.has('ship b')).toBeTrue();
        expect(peerB.world.entities.has('ship a')).toBeTrue();
        expect(peerB.world.entities.has('ship b')).toBeTrue();
    }, 120_000);

    it('analog steering and explicit targets stay in lockstep across peers', async () => {
        const peerA = await makePeer('a');
        const peerB = await makePeer('b');
        await peerA.client.addEntity('ship a', await makePeerShip('a', peerA.world));
        await peerB.client.addEntity('ship b', await makePeerShip('b', peerB.world));

        for (let tick = 1; tick <= 120; tick++) {
            if (tick === 10) {
                // Pure analog steering: no digital control ever
                // touches this ship (the virtual-joystick case).
                peerA.host.analogControl({ heading: 0.75, throttle: 1 });
            }
            if (tick >= 20 && tick < 60 && tick % 2 === 0) {
                // Wiggle the stick with per-frame updates.
                peerA.host.analogControl({
                    heading: 0.75 + tick / 100,
                    throttle: (60 - tick) / 40,
                });
            }
            if (tick === 30) {
                // Tap-to-target plus firing on it.
                peerB.host.setTarget('ship a');
                peerB.host.controlEvents([
                    { action: 'firePrimary', state: 'start' }]);
            }
            if (tick === 70) {
                // Stick released: both axes back to digital control.
                peerA.host.analogControl({ heading: null, throttle: null });
            }
            peerA.host.step();
            peerB.host.step();
            await new Promise(resolve => setImmediate(resolve));
        }
        for (let i = 0; i < 5; i++) {
            peerA.host.step();
            peerB.host.step();
            await new Promise(resolve => setImmediate(resolve));
        }

        const hashA = hashWorld(peerA.world, PEER_LOCAL_COMPONENTS);
        const hashB = hashWorld(peerB.world, PEER_LOCAL_COMPONENTS);
        expect(hashA.hash).toEqual(hashB.hash);
        // The analog input actually flew A's ship somewhere.
        const movement = peerA.world.entities.get('ship a')!
            .components.get(MovementStateComponent)!;
        expect(movement.velocity.length).toBeGreaterThan(0);
        // The explicit target stuck, on both peers.
        expect(peerB.world.entities.get('ship b')!
            .components.get(TargetComponent)!.target).toEqual('ship a');
        expect(peerA.world.entities.get('ship b')!
            .components.get(TargetComponent)!.target).toEqual('ship a');
    }, 120_000);

    it('a late joiner reconstructs the world from the input log', async () => {
        const peerA = await makePeer('a');
        await peerA.client.addEntity('ship a', await makePeerShip('a', peerA.world));
        for (let tick = 1; tick <= 60; tick++) {
            if (tick === 5) {
                peerA.host.controlEvents([{ action: 'accelerate', state: 'start' }]);
            }
            peerA.host.step();
            relay.advanceTicks(1);
        }

        // B joins late: genesis + the relay's log reconstructs A's world.
        const peerB = await makePeer('b');
        const joined = await peerB.host.joinRoom();
        expect(joined).toBeTrue();

        // Align the worlds: the joiner extrapolates the relay clock
        // from wall time, so with the test's manual clock either side
        // may be ahead.
        {
            const { TimeResource } =
                await import('nova_ecs/plugins/time_plugin');
            const frame = (world: World) =>
                world.resources.get(TimeResource)!.frame;
            while (frame(peerA.world) !== frame(peerB.world)) {
                (frame(peerA.world) < frame(peerB.world) ? peerA : peerB)
                    .host.step();
            }
        }

        const hashA = hashWorld(peerA.world, PEER_LOCAL_COMPONENTS);
        const hashB = hashWorld(peerB.world, PEER_LOCAL_COMPONENTS);
        expect(hashB.hash).toEqual(hashA.hash);
        expect(peerB.world.entities.has('ship a')).toBeTrue();
    }, 120_000);

    it('a late joiner reconstructs from an archived baseline plus the log tail', async () => {
        // Replace the plain relay with one wired to a trailing archive
        // (short interval so the test stays quick).
        relay.close();
        let archive: RoomArchive | undefined;
        relay = new RollbackRelay(comms.get('server')!, {
            autoClock: false,
            baseline: () => archive?.latest,
        });
        const makeArchiveWorld = async () => {
            const gameData = await getIntegrationGameData();
            const ids = await gameData.ids;
            return makeSystem([...ids.System].sort()[0]!, gameData, 'node', { npcs: false });
        };
        archive = new RoomArchive(relay, makeArchiveWorld,
            { intervalTicks: 30, autoUpdate: false });

        const peerA = await makePeer('a');
        await peerA.client.addEntity('ship a', await makePeerShip('a', peerA.world));
        for (let tick = 1; tick <= 90; tick++) {
            if (tick === 5) {
                peerA.host.controlEvents(
                    [{ action: 'accelerate', state: 'start' }]);
            }
            peerA.host.step();
            relay.advanceTicks(1);
            if (tick % 10 === 0) {
                await archive.update();
            }
        }
        await archive.update();
        expect(archive.latest).toBeDefined();
        expect(archive.latest!.tick).toBeGreaterThanOrEqual(60);
        // The log before the *previous* baseline is gone (one interval
        // of extra log stays behind `latest` for desync incident
        // records): reconstruction can no longer start from genesis.
        expect(archive.previous).toBeDefined();
        expect(archive.previous!.tick).toBeLessThan(archive.latest!.tick);
        expect(relay.inputLog.every(
            record => record.tick > archive!.previous!.tick)).toBeTrue();

        const peerB = await makePeer('b');
        let baselineTick: number | undefined;
        comms.get('b')!.messages.subscribe(({ message }) => {
            const rollbackMessage = unwrapRollbackMessage(message);
            if (rollbackMessage?.kind === 'catchUp') {
                baselineTick = rollbackMessage.baseline?.tick;
            }
        });
        const joined = await peerB.host.joinRoom();
        expect(joined).toBeTrue();
        expect(baselineTick).toBe(archive.latest!.tick);

        {
            const { TimeResource } =
                await import('nova_ecs/plugins/time_plugin');
            const frame = (world: World) =>
                world.resources.get(TimeResource)!.frame;
            while (frame(peerA.world) !== frame(peerB.world)) {
                (frame(peerA.world) < frame(peerB.world) ? peerA : peerB)
                    .host.step();
            }
        }
        const hashA = hashWorld(peerA.world, PEER_LOCAL_COMPONENTS);
        const hashB = hashWorld(peerB.world, PEER_LOCAL_COMPONENTS);
        expect(hashB.hash).toEqual(hashA.hash);
        expect(peerB.world.entities.has('ship a')).toBeTrue();
    }, 240_000);

    it('the archive tracks a land, ship purchase, and relaunch', async () => {
        // The spaceport flow as the room sees it: removeEntity at
        // landing, then addEntity of a *different* ship on the same
        // uuid at departure. The archive must simulate it identically
        // to the peers (live, the archive diverged around this
        // sequence).
        relay.close();
        let archive: RoomArchive | undefined;
        relay = new RollbackRelay(comms.get('server')!, {
            autoClock: false,
            baseline: () => archive?.latest,
            referenceHash: tick => archive?.hashAt(tick),
        });
        const makeArchiveWorld = async () => {
            const gameData = await getIntegrationGameData();
            const ids = await gameData.ids;
            return makeSystem([...ids.System].sort()[0]!, gameData, 'node', { npcs: false });
        };
        archive = new RoomArchive(relay, makeArchiveWorld,
            { intervalTicks: 30, autoUpdate: false });

        const peerA = await makePeer('a');
        const peerB = await makePeer('b');
        await peerA.client.addEntity('ship a', await makePeerShip('a', peerA.world));

        const step = async (ticks: number) => {
            for (let i = 0; i < ticks; i++) {
                peerA.host.step();
                peerB.host.step();
                relay.advanceTicks(1);
                await new Promise(resolve => setImmediate(resolve));
            }
            await archive!.update();
        };

        await step(35);
        // Land: the ship leaves the simulation.
        peerA.client.removeEntity('ship a');
        await step(35);
        // Depart with a purchased ship: a fresh entity, same uuid.
        const gameData = await getIntegrationGameData();
        const carrierData = await gameData.data.Ship.get('nova:143');
        const carrier = makeShip(carrierData!);
        carrier.components.set(ControlledByComponent, { peerId: 'a' });
        await peerA.client.addEntity('ship a', carrier);
        await step(90);

        const hashArchive = hashWorld(archive.archiveWorld!, PEER_LOCAL_COMPONENTS);
        const hashA = hashWorld(peerA.world, PEER_LOCAL_COMPONENTS);
        const hashB = hashWorld(peerB.world, PEER_LOCAL_COMPONENTS);
        expect(hashB.hash).toEqual(hashA.hash);
        if (hashArchive.hash !== hashA.hash) {
            const { diffWorldHashes } = await import('nova_ecs/plugins/world_hash');
            fail('Archive diverged: '
                + diffWorldHashes(hashArchive, hashA).slice(0, 10).join('; '));
        }
    }, 240_000);

    it('combat and a player death stay in lockstep across peers and the archive', async () => {
        relay.close();
        let archive: RoomArchive | undefined;
        relay = new RollbackRelay(comms.get('server')!, {
            autoClock: false,
            baseline: () => archive?.latest,
            referenceHash: tick => archive?.hashAt(tick),
        });
        const makeArchiveWorld = async () => {
            const gameData = await getIntegrationGameData();
            const ids = await gameData.ids;
            return makeSystem([...ids.System].sort()[0]!, gameData, 'node', { npcs: false });
        };
        archive = new RoomArchive(relay, makeArchiveWorld,
            { intervalTicks: 60, autoUpdate: false });

        const peerA = await makePeer('a');
        const peerB = await makePeer('b');
        // A's controlled shuttle between two hostile carriers: it will
        // die (exercising the respawn path) amid full combat
        // (missiles, turret bolts, blasts) that every world — worker
        // peers and the node archive — must simulate identically.
        const ship = await makePeerShip('a', peerA.world);
        await peerA.client.addEntity('ship a', ship);
        const gameData = await getIntegrationGameData();
        // A Fed Carrier (missiles, turrets, bays) and a Raven (beams,
        // point defense — the live-session loadout that coincided with
        // an archive divergence) both in weapons range.
        for (const [i, [shipId, x]] of ([
            ['nova:143', -120], ['nova:164', 320],
        ] as const).entries()) {
            const npcData = await gameData.data.Ship.get(shipId);
            const npc = makeNpc(npcData!);
            const movement = npc.components.get(MovementStateComponent)!;
            movement.position = new Position(x, 50);
            movement.rotation = new Angle(i === 0 ? Math.PI / 2 : -Math.PI / 2);
            movement.velocity = new Vector(0, 0);
            await completeEntity(peerA.world, npc);
            await peerA.client.addEntity(`npc ${i}`, npc);
        }

        for (let tick = 1; tick <= 900; tick++) {
            peerA.host.step();
            peerB.host.step();
            relay.advanceTicks(1);
            if (tick % 30 === 0) {
                await archive.update();
            }
            await new Promise(resolve => setImmediate(resolve));
        }
        await archive.update();

        const hashA = hashWorld(peerA.world, PEER_LOCAL_COMPONENTS);
        const hashB = hashWorld(peerB.world, PEER_LOCAL_COMPONENTS);
        const hashArchive = hashWorld(archive.archiveWorld!, PEER_LOCAL_COMPONENTS);
        expect(hashB.hash).toEqual(hashA.hash);
        if (hashArchive.hash !== hashA.hash) {
            const { diffWorldHashes } = await import('nova_ecs/plugins/world_hash');
            fail('Archive diverged: '
                + diffWorldHashes(hashArchive, hashA).slice(0, 10).join('; '));
        }
        // The player ship died and respawned (teleport bumps the
        // counter) — on every world, not just its owner's.
        const shipA = peerA.world.entities.get('ship a');
        expect(shipA).toBeDefined();
        expect(shipA!.components.get(MovementStateComponent)!.teleportCount ?? 0)
            .toBeGreaterThan(0);
        expect(peerB.world.entities.has('ship a')).toBeTrue();
        expect(archive.archiveWorld!.entities.has('ship a')).toBeTrue();
    }, 240_000);

    it('bay escorts stay in lockstep across peers and the archive', async () => {
        // The live trigger for a persistent peers-vs-archive
        // divergence: a player cycling to their bay weapon and
        // launching escorts. Reproduce it through the real control
        // path with the archive stepping in its batched cadence.
        relay.close();
        let archive: RoomArchive | undefined;
        relay = new RollbackRelay(comms.get('server')!, {
            autoClock: false,
            baseline: () => archive?.latest,
            referenceHash: tick => archive?.hashAt(tick),
        });
        const makeArchiveWorld = async () => {
            const gameData = await getIntegrationGameData();
            return makeSystem('nova:226', gameData, 'node', { npcs: false });
        };
        archive = new RoomArchive(relay, makeArchiveWorld,
            { intervalTicks: 60, autoUpdate: false });

        // An asteroid-free system (Ver'ashan): this spec depends on a
        // marginal dogfight where at least one launched fighter
        // survives to fly home, and an asteroid field absorbing shots
        // tips that fight the other way.
        const peerA = await makePeer('a', 'nova:226');
        const peerB = await makePeer('b', 'nova:226');
        const gameData = await getIntegrationGameData();
        // A pilots a Fed Carrier (it has a fighter bay).
        const carrierData = await gameData.data.Ship.get('nova:143');
        // The raven mauls the carrier hard enough to push it below its
        // disable threshold mid-launch, and a DISABLED ship can't fire
        // its bay (ship disabling landed after this spec was written).
        // This spec is about escort lockstep, not attrition, so give
        // the carrier effectively indestructible armor THROUGH the ship
        // data (the armor Stat and disable threshold derive from it).
        // The custom ShipDataComponent is set before insertion, so it
        // rides the insertion record and every peer — and every
        // snapshot re-derivation — agrees.
        const toughCarrierData = {
            ...carrierData!,
            physics: { ...carrierData!.physics, armor: 1_000_000 },
        };
        const carrier = makeShip(toughCarrierData);
        carrier.components.set(ShipDataComponent, toughCarrierData);
        carrier.components.set(ControlledByComponent, { peerId: 'a' });
        const carrierMovement = carrier.components.get(MovementStateComponent)!;
        carrierMovement.position = new Position(0, 300);
        carrierMovement.rotation = new Angle(0);
        carrierMovement.velocity = new Vector(0, 0);
        await completeEntity(peerA.world, carrier);
        await peerA.client.addEntity('ship a', carrier);
        // The dogfight victim: a second Fed Carrier. (This spec once
        // used a Raven, but the tighter halved formation spacing parks
        // freshly launched fighters in the line of fire, and a Raven
        // one-shots each fighter before the next launches — no
        // survivor ever flies home. Carrier-vs-carrier keeps a real
        // dogfight while letting a couple of fighters live to return:
        // the same adaptation-not-weakening rule as pinning this spec
        // to an asteroid-free system.)
        const preyData = await gameData.data.Ship.get('nova:143');
        const prey = makeNpc(preyData!);
        const preyMovement = prey.components.get(MovementStateComponent)!;
        preyMovement.position = new Position(0, 800);
        preyMovement.rotation = new Angle(Math.PI);
        preyMovement.velocity = new Vector(0, 0);
        await completeEntity(peerA.world, prey);
        await peerA.client.addEntity('raven', prey);

        const step = async (ticks: number) => {
            for (let i = 0; i < ticks; i++) {
                peerA.host.step();
                peerB.host.step();
                relay.advanceTicks(1);
                if ((relay.tick % 30) === 0) {
                    await archive!.update();
                }
                await new Promise(resolve => setImmediate(resolve));
            }
        };

        // Populate the weapons map, acquire a target, cycle to the bay.
        // The target is set explicitly (the click/tap input record)
        // rather than with the 'r' key: 'r' takes the nearest HOSTILE
        // ship, and this spec's choreography needs the raven locked
        // whatever it thinks of the player.
        peerA.host.controlEvents([{ action: 'firePrimary', state: 'start' }]);
        await step(10);
        peerA.host.controlEvents([{ action: 'firePrimary', state: false }]);
        peerA.host.setTarget('raven');
        await step(5);
        const shipA = () => peerA.world.entities.get('ship a')!;
        const { ActiveSecondaryWeapon } =
            await import('../nova_plugin/combat/weapon_plugin.js');
        let foundBay = false;
        for (let cycle = 0; cycle < 8 && !foundBay; cycle++) {
            peerA.host.controlEvents([{ action: 'nextSecondary', state: 'start' }]);
            await step(3);
            const active = shipA().components.get(ActiveSecondaryWeapon);
            if (active?.secondary) {
                const weapon = await gameData.data.Weapon.get(active.secondary);
                foundBay = weapon?.type === 'BayWeaponData';
            }
        }
        expect(foundBay).toBeTrue();
        // Launch escorts. Fighters launch into FORMATION under the
        // escort-command framework (no auto-attack), so keep pressing
        // the attack command while the bay cycles: each press sends
        // every fighter launched so far at the player's target (the
        // raven), which fights back — the dogfight this spec's
        // choreography depends on.
        peerA.host.controlEvents([{ action: 'fireSecondary', state: 'start' }]);
        for (let volley = 0; volley < 6; volley++) {
            peerA.host.controlEvents([{ action: 'attack', state: 'start' }]);
            await step(2);
            peerA.host.controlEvents([{ action: 'attack', state: false }]);
            await step(64);
        }
        peerA.host.controlEvents([{ action: 'fireSecondary', state: false }]);
        await step(200);
        await archive.update();

        const bays = (world: World) =>
            [...world.entities.keys()].filter(key => key.includes(':bay:')).length;
        const launched = bays(peerA.world);
        expect(launched).toBeGreaterThan(0);
        expect(bays(peerB.world)).toBe(launched);
        expect(bays(archive.archiveWorld!)).toBe(launched);

        const compareAll = async (label: string) => {
            const hashA = hashWorld(peerA.world, PEER_LOCAL_COMPONENTS);
            const hashB = hashWorld(peerB.world, PEER_LOCAL_COMPONENTS);
            const hashArchive = hashWorld(
                archive!.archiveWorld!, PEER_LOCAL_COMPONENTS);
            expect(hashB.hash).toEqual(hashA.hash);
            if (hashArchive.hash !== hashA.hash) {
                const { diffWorldHashes } =
                    await import('nova_ecs/plugins/world_hash');
                fail(`Archive diverged (${label}): `
                    + diffWorldHashes(hashArchive, hashA).slice(0, 10).join('; '));
            }
        };
        await compareAll('after launch');

        // Remove the escorts' victim (their attack command completes,
        // dropping them back to formation), then order them home with
        // the returnToBay command — the return path whose (formerly
        // unregistered) escort-state components were lost in rollbacks
        // and resync baselines live.
        const returning = (world: World) => [...world.entities]
            .filter(([uuid]) => uuid.includes(':bay:'))
            .filter(([, entity]) => [...entity.components.keys()]
                .some(component => component.name === 'ReturnComponent'))
            .length;
        peerA.client.removeEntity('raven');
        await step(30);
        peerA.host.controlEvents([{ action: 'returnToBay', state: 'start' }]);
        await step(2);
        peerA.host.controlEvents([{ action: 'returnToBay', state: false }]);
        // Catch the escorts *mid-return*: how quickly they turn home and
        // how soon the carrier collects them depends on hull sizes and
        // where the dogfight ended, so step in small chunks and stop
        // while at least one escort is still flying home instead of
        // using a fixed step count (long enough for them to have
        // already been collected).
        for (let waited = 0;
            returning(peerA.world) === 0 && waited < 600; waited += 10) {
            await step(10);
        }
        await archive.update();
        expect(bays(peerB.world)).toBe(bays(peerA.world));
        expect(bays(archive.archiveWorld!)).toBe(bays(peerA.world));
        expect(returning(peerA.world)).toBeGreaterThan(0);
        await compareAll('during the return flight');

        // A fresh peer reconstructing from a baseline captured
        // mid-return must see escorts that can still return home:
        // exactly the state resyncs lost live.
        const commC = new MockCommunicator('c');
        commC.mockPeers = comms;
        comms.set('c', commC);
        for (const comm of comms.values()) {
            comm.peers.current.next(new Set(comms.keys()));
        }
        // The late joiner builds the ROOM's system: a room is one system,
        // and every sim-minted uuid now carries its system id (IdFactory),
        // so a peer that built a different system's world would mint a
        // different id for the same projectile and diverge on contact.
        // (It used to pass by accident: bare `projectile:N` ids were
        // system-agnostic.)
        const peerC = await makePeer('c', 'nova:226');
        expect(await peerC.host.joinRoom()).toBeTrue();
        {
            const { TimeResource } =
                await import('nova_ecs/plugins/time_plugin');
            const frame = (world: World) =>
                world.resources.get(TimeResource)!.frame;
            // C steps alone to catch up; if C landed ahead (its clock
            // estimate extrapolates wall time against the test's
            // manual relay clock), A and B advance together so their
            // lockstep survives.
            while (frame(peerC.world) < frame(peerA.world)) {
                peerC.host.step();
            }
            while (frame(peerA.world) < frame(peerC.world)) {
                await step(1);
            }
        }
        expect(returning(peerC.world)).toBe(returning(peerA.world));
        const hashC = hashWorld(peerC.world, PEER_LOCAL_COMPONENTS);
        expect(hashC.hash)
            .toEqual(hashWorld(peerA.world, PEER_LOCAL_COMPONENTS).hash);

        // Now the other live desync recipe: with escorts still in
        // flight, another player's ship arrives and takes weapon hits
        // (guided missiles home in, detonate, and blast it).
        const victim = await makePeerShip('b', peerB.world);
        await peerB.client.addEntity('ship b', victim);
        await step(10);
        // Lock the other player's ship explicitly: it has done nothing
        // to us yet, so it is not hostile and 'r' would skip it (that
        // is the point of the aggression layer — hostility toward
        // another player has to be earned).
        peerA.host.setTarget('ship b');
        await step(3);
        // Cycle from the bay back to the guided missile (the first
        // secondary), then hold fire.
        peerA.host.controlEvents([{ action: 'resetSecondary', state: 'start' }]);
        await step(3);
        peerA.host.controlEvents([{ action: 'nextSecondary', state: 'start' }]);
        await step(3);
        peerA.host.controlEvents([{ action: 'fireSecondary', state: 'start' }]);
        // The victim must actually have been hit for this to prove
        // anything. Watch the shield during the volley: it recharges,
        // so a check after the quiet tail can miss real hits.
        const { ShieldComponent } =
            await import('../nova_plugin/ship/health_plugin.js');
        let minVictimShield = Infinity;
        const watchVictim = () => {
            const shield = peerA.world.entities.get('ship b')
                ?.components.get(ShieldComponent);
            if (shield) {
                minVictimShield = Math.min(minVictimShield, shield.current);
            }
        };
        for (let i = 0; i < 400; i++) {
            await step(1);
            watchVictim();
        }
        peerA.host.controlEvents([{ action: 'fireSecondary', state: false }]);
        for (let i = 0; i < 120; i++) {
            await step(1);
            watchVictim();
        }
        await archive.update();

        const victimShield = peerA.world.entities.get('ship b')
            ?.components.get(ShieldComponent);
        expect(victimShield).toBeDefined();
        expect(minVictimShield).toBeLessThan(victimShield!.max);
        await compareAll('after missile hits on a player ship');
        for (const world of [peerA.world, peerB.world]) {
            const policies = world.resources.get(
                (await import('nova_ecs/plugins/snapshot_plugin'))
                    .SnapshotPoliciesResource)!;
            expect([...policies.unhandled]).toEqual([]);
            expect([...policies.unhandledWire]).toEqual([]);
        }

        // Every piece of simulation state must have an explicit
        // snapshot and wire strategy: a silently skipped component is
        // exactly how the escort desync got out of CI.
        const { SnapshotPoliciesResource } =
            await import('nova_ecs/plugins/snapshot_plugin');
        for (const world of [peerA.world, peerB.world, archive.archiveWorld!]) {
            const policies = world.resources.get(SnapshotPoliciesResource)!;
            expect([...policies.unhandled]).toEqual([]);
            expect([...policies.unhandledWire]).toEqual([]);
        }
    }, 240_000);

    it('NPC traffic stays in lockstep across peers and the archive', async () => {
        // The new deterministic NPC population (npc_spawn_plugin /
        // npc_ai_plugin): every world in the room — both peers and the
        // node archive — must genesis the same ships and simulate
        // their AI identically, including decisions, steering,
        // departures, and respawns.
        relay.close();
        let archive: RoomArchive | undefined;
        relay = new RollbackRelay(comms.get('server')!, {
            autoClock: false,
            baseline: () => archive?.latest,
            referenceHash: tick => archive?.hashAt(tick),
        });
        const makeArchiveWorld = async () => {
            const gameData = await getIntegrationGameData();
            return makeSystem('nova:226', gameData, 'node', { npcs: true });
        };
        archive = new RoomArchive(relay, makeArchiveWorld,
            { intervalTicks: 60, autoUpdate: false });

        // nova:226 (Ver'ashan): no asteroids, AvgShips 5.
        const peerA = await makePeer('a', 'nova:226', undefined,
            SimulationBridgeHost, true);
        const peerB = await makePeer('b', 'nova:226', undefined,
            SimulationBridgeHost, true);
        await peerA.client.addEntity('ship a',
            await makePeerShip('a', peerA.world));

        const countNpcs = (world: World) => [...world.entities.values()]
            .filter(entity => [...entity.components.keys()]
                .some(component => component.name === 'NpcComponent'))
            .length;
        expect(countNpcs(peerA.world)).toBeGreaterThan(0);
        expect(countNpcs(peerB.world)).toBe(countNpcs(peerA.world));

        // Long enough for several NPC decision intervals and some
        // planet traffic.
        for (let tick = 1; tick <= 600; tick++) {
            peerA.host.step();
            peerB.host.step();
            relay.advanceTicks(1);
            if (tick % 30 === 0) {
                await archive.update();
            }
            await new Promise(resolve => setImmediate(resolve));
        }
        await archive.update();

        expect(countNpcs(peerB.world)).toBe(countNpcs(peerA.world));
        expect(countNpcs(archive.archiveWorld!)).toBe(countNpcs(peerA.world));

        const hashA = hashWorld(peerA.world, PEER_LOCAL_COMPONENTS);
        const hashB = hashWorld(peerB.world, PEER_LOCAL_COMPONENTS);
        const hashArchive = hashWorld(
            archive.archiveWorld!, PEER_LOCAL_COMPONENTS);
        expect(hashB.hash).toEqual(hashA.hash);
        if (hashArchive.hash !== hashA.hash) {
            const { diffWorldHashes } = await import('nova_ecs/plugins/world_hash');
            fail('Archive diverged: '
                + diffWorldHashes(hashArchive, hashA).slice(0, 10).join('; '));
        }

        // NPC state must have full snapshot/wire coverage (the same
        // guarantee the bay-escort spec enforces).
        const { SnapshotPoliciesResource } =
            await import('nova_ecs/plugins/snapshot_plugin');
        for (const world of [peerA.world, peerB.world, archive.archiveWorld!]) {
            const policies = world.resources.get(SnapshotPoliciesResource)!;
            expect([...policies.unhandled]).toEqual([]);
            expect([...policies.unhandledWire]).toEqual([]);
        }
    }, 240_000);

    it('an insertion record survives staging failures via retries', async () => {
        // The Android incident's first half: one flaky fetch while
        // staging a relayed addEntity silently dropped the record, so
        // the peer was missing a whole ship — permanently diverged.
        // Staging now retries.
        class FlakyStagingHost extends SimulationBridgeHost {
            failuresLeft = 2;
            protected override stageRecords(records: InputRecord[]) {
                if (this.failuresLeft > 0) {
                    this.failuresLeft--;
                    return Promise.reject(
                        new Error('synthetic staging failure'));
                }
                return super.stageRecords(records);
            }
        }
        const peerA = await makePeer('a');
        const peerB = await makePeer('b', undefined,
            { stagingRetryMs: 5 }, FlakyStagingHost);
        await peerA.client.addEntity('ship a', await makePeerShip('a', peerA.world));
        for (let tick = 1; tick <= 25; tick++) {
            peerA.host.step();
            peerB.host.step();
            // Real time, not just a microtask: the staging retries
            // back off through timers.
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect((peerB.host as FlakyStagingHost).failuresLeft).toBe(0);
        expect(peerB.world.entities.has('ship a')).toBeTrue();
        {
            const { TimeResource } =
                await import('nova_ecs/plugins/time_plugin');
            const frame = (world: World) =>
                world.resources.get(TimeResource)!.frame;
            while (frame(peerA.world) !== frame(peerB.world)) {
                (frame(peerA.world) < frame(peerB.world) ? peerA : peerB)
                    .host.step();
            }
        }
        const hashA = hashWorld(peerA.world, PEER_LOCAL_COMPONENTS);
        const hashB = hashWorld(peerB.world, PEER_LOCAL_COMPONENTS);
        expect(hashB.hash).toEqual(hashA.hash);
    }, 240_000);

    it('resync retries until the relay responds again', async () => {
        // The Android incident's second half: a resync whose join
        // timed out left the peer on a genesis fork, convicted every
        // third checkpoint forever. Resync now keeps retrying (the
        // sim pauses meanwhile), and gives up only after a cap.
        const peerA = await makePeer('a', undefined, {
            resyncCooldownMs: 0,
            resyncJoinTimeoutMs: 150,
            resyncRetryMs: 10,
            resyncMaxAttempts: 2,
        });
        await peerA.client.addEntity('ship a', await makePeerShip('a', peerA.world));
        for (let tick = 1; tick <= 5; tick++) {
            peerA.host.step();
            relay.advanceTicks(1);
            await new Promise(resolve => setImmediate(resolve));
        }
        // The relay vanishes: every join attempt times out, and the
        // capped retries report failure.
        relay.close();
        expect(await peerA.host.resync()).toBeFalse();
        expect(peerA.host.status().joined).toBeFalse();

        // The relay returns; the next resync reconstructs and joins.
        relay = new RollbackRelay(comms.get('server')!, { autoClock: false });
        relay.advanceTicks(10);
        expect(await peerA.host.resync()).toBeTrue();
        expect(peerA.host.status().joined).toBeTrue();
    }, 240_000);

    it('a record retimed by the relay converges via the clamp echo', async () => {
        // The first real recorded desync: a control record arrived
        // behind the relay's clock, was retimed for the room but not
        // its sender, and the sender's timeline silently forked. The
        // relay now echoes retimed records to the sender, who rolls
        // back and reapplies at the room's tick.
        const peerA = await makePeer('a');
        const peerB = await makePeer('b');
        await peerA.client.addEntity('ship a', await makePeerShip('a', peerA.world));
        await peerB.client.addEntity('ship b', await makePeerShip('b', peerB.world));
        for (let tick = 1; tick <= 20; tick++) {
            peerA.host.step();
            peerB.host.step();
            relay.advanceTicks(1);
            await new Promise(resolve => setImmediate(resolve));
        }
        // The relay's clock runs ahead of peer A (a stalled sender):
        // A's next input, stamped at its local tick (it has no
        // tickSync to extrapolate), arrives behind the clock and gets
        // retimed.
        relay.advanceTicks(30);
        peerA.host.controlEvents([{ action: 'accelerate', state: 'start' }]);
        peerA.host.step();
        await new Promise(resolve => setImmediate(resolve));
        // The echo comes back and A moves its application; B and A
        // then step to the same tick and agree bit for bit.
        for (let tick = 0; tick < 60; tick++) {
            peerA.host.step();
            peerB.host.step();
            await new Promise(resolve => setImmediate(resolve));
        }
        {
            const { TimeResource } =
                await import('nova_ecs/plugins/time_plugin');
            const frame = (world: World) =>
                world.resources.get(TimeResource)!.frame;
            while (frame(peerA.world) !== frame(peerB.world)) {
                (frame(peerA.world) < frame(peerB.world) ? peerA : peerB)
                    .host.step();
            }
        }
        const hashA = hashWorld(peerA.world, PEER_LOCAL_COMPONENTS);
        const hashB = hashWorld(peerB.world, PEER_LOCAL_COMPONENTS);
        expect(hashA.hash).toEqual(hashB.hash);
        // The ship actually moved (the input was not lost in the move).
        const shipA = peerA.world.entities.get('ship a')!;
        const movement = shipA.components.get(MovementStateComponent)!;
        expect(movement.velocity.length).toBeGreaterThan(0);
    }, 240_000);

    it('detects a desync and the diverged peer resyncs from the log', async () => {
        // Replace the plain relay with one capturing incident hooks:
        // the conviction report and the diverged peer's uploaded
        // state history (the black-box desync recorder's inputs).
        relay.close();
        const desyncInfos: DesyncInfo[] = [];
        const dumps: [string, DesyncDump][] = [];
        relay = new RollbackRelay(comms.get('server')!, {
            autoClock: false,
            onDesync: info => desyncInfos.push(info),
            onDesyncDump: (peerId, dump) => dumps.push([peerId, dump]),
        });

        const peerA = await makePeer('a');
        const peerB = await makePeer('b');
        await peerA.client.addEntity('ship a', await makePeerShip('a', peerA.world));
        await peerB.client.addEntity('ship b', await makePeerShip('b', peerB.world));

        const desyncTicks: number[] = [];
        comms.get('a')!.messages.subscribe(({ message }) => {
            const rollbackMessage = unwrapRollbackMessage(message);
            if (rollbackMessage?.kind === 'desync') {
                desyncTicks.push(rollbackMessage.tick);
            }
        });

        for (let tick = 1; tick <= 50; tick++) {
            if (tick === 10) {
                peerA.host.controlEvents([{ action: 'accelerate', state: 'start' }]);
            }
            peerA.host.step();
            peerB.host.step();
            // Yield so async-staged insertion records integrate.
            await new Promise(resolve => setImmediate(resolve));
        }
        // Corrupt peer B outside the input timeline: from here its
        // simulation diverges from the log's true simulation.
        const shipB = peerB.world.entities.get('ship b')!;
        shipB.components.get(MovementStateComponent)!.position =
            new Position(500, 500);

        // Checkpoints 60, 120, 180 all mismatch; the third consecutive
        // mismatch convicts (desyncThreshold), and the tick-180 hashes
        // settle and reach the relay at tick 210.
        for (let tick = 51; tick <= 300 && desyncTicks.length === 0; tick++) {
            peerA.host.step();
            peerB.host.step();
            await new Promise(resolve => setImmediate(resolve));
        }
        expect(desyncTicks).toEqual([180]);
        expect(peerB.host.desyncCount).toBe(1);

        // The conviction report names the diverged peer ('a' wins the
        // canonical tie-break with no archive witness in this test).
        expect(desyncInfos.length).toBe(1);
        expect(desyncInfos[0]!.tick).toBe(180);
        expect(desyncInfos[0]!.convicted).toEqual(['b']);
        expect(desyncInfos[0]!.archiveOutvoted).toBeFalse();

        // The convicted peer uploaded its state history before
        // resyncing: full wire snapshots at its recent checkpoints,
        // spanning the whole divergence window (the corruption landed
        // at tick 50, so checkpoint 60 onward describe the diverged
        // timeline while genesis..49 matched).
        expect(dumps.length).toBe(1);
        const [dumpPeer, dump] = dumps[0]!;
        expect(dumpPeer).toBe('b');
        expect(dump.desyncTick).toBe(180);
        const checkpointTicks = dump.checkpoints.map(c => c.tick);
        expect(checkpointTicks).toContain(120);
        expect(checkpointTicks).toContain(180);
        for (const checkpoint of dump.checkpoints) {
            const uuids = checkpoint.snapshot.entities.map(e => e.uuid);
            expect(uuids).toContain('ship a');
            expect(uuids).toContain('ship b');
        }
        // The evidence shows the corruption itself: ship b's dumped
        // movement at checkpoint 60 reflects the forged position.
        const evidence = dump.checkpoints.find(c => c.tick === 60)!
            .snapshot.entities.find(e => e.uuid === 'ship b')!
            .components.find(([name]) => name === 'MovementState');
        expect(JSON.stringify(evidence)).toContain('500');

        // 'a' wins the canonical tie-break, so B is the one resyncing:
        // genesis plus the relay's log. Let the async join finish, then
        // step B back up to A's tick.
        await new Promise(resolve => setTimeout(resolve));
        {
            const { TimeResource } =
                await import('nova_ecs/plugins/time_plugin');
            const frame = (world: World) =>
                world.resources.get(TimeResource)!.frame;
            while (frame(peerA.world) !== frame(peerB.world)) {
                (frame(peerA.world) < frame(peerB.world) ? peerA : peerB)
                    .host.step();
            }
        }

        const hashA = hashWorld(peerA.world, PEER_LOCAL_COMPONENTS);
        const hashB = hashWorld(peerB.world, PEER_LOCAL_COMPONENTS);
        expect(hashB.hash).toEqual(hashA.hash);
        expect(peerB.world.entities.has('ship a')).toBeTrue();
        expect(peerB.world.entities.has('ship b')).toBeTrue();

        // Dump fidelity on real game state: wire-encoding a stored
        // structural snapshot must produce exactly what wire-encoding
        // the live world produces — the property the whole incident
        // record rests on.
        const { snapshotWorld, wireSnapshotWorld, wireSnapshotOfSnapshot } =
            await import('nova_ecs/plugins/snapshot_plugin');
        expect(JSON.stringify(
            wireSnapshotOfSnapshot(peerA.world, snapshotWorld(peerA.world))))
            .toEqual(JSON.stringify(wireSnapshotWorld(peerA.world)));
    }, 240_000);
});
