import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import {
    restoreWorld, snapshotWorld, SnapshotPoliciesResource,
} from 'nova_ecs/plugins/snapshot_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import {
    applyInputRecords, InputRecord, loadInputRecordsGameData,
} from '../../communication/simulation_input.js';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { deriveEntityComponents } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import {
    FormationComponent, isInFlock, NpcComponent, SystemHoldComponent,
} from '../npc/index.js';
import {
    ActiveMission, ControlledByComponent, CreditsComponent, GameDateComponent,
    GOAL_DESTROY, GOAL_ESCORT, MissionShipComponent, MissionsComponent,
    ShipObjective,
} from '../player/index.js';
import {
    ArmorComponent, FiringGroupComponent, makeShip, ShieldComponent,
    ShipDataComponent, ShipPhysicsComponent,
    TargetComponent,
} from '../ship/index.js';
import { completeEntity, makeNpcShip } from '../spawn/index.js';
import { ABORTED_ESCORT_DEPART_MS } from './mission_ship_release.js';
import {
    liveMissionShips, MISSION_SHIP_NO_DEPART_MS,
} from './mission_ship_spawn.js';

/**
 * ============================================================================
 * An in-flight Abort keeps the mission's ShipBehav 0 and 1 ships
 * ============================================================================
 *
 * Reference "Aborting a mission in flight from the `i` dialog, wave 13":
 * the ShipBehav-1 escort turned neutral at once and jumped out about 17 s
 * after the abort; the two ShipBehav-0 raiders stayed hostile and kept
 * shooting until the player landed. Other ShipBehav values were not
 * measured and keep the old deletion (mission_ship_release.ts).
 */
describe('the special ships of a mission aborted in flight', () => {
    const MISSION = 'nova:9065';
    const OWNER = 'ship a';
    const STEP_MS = 1000 / 60;

    function objective(goal: number, behavior: number): ShipObjective {
        return {
            goal, systemId: null, shipStart: 0, behavior,
            dudeId: 'nova:999', total: 2, satisfied: 0, complete: false,
            failed: false, shipDonePending: false, live: new Map(),
        };
    }

    function mission(shipObjective: ShipObjective): ActiveMission {
        return {
            id: MISSION, acceptedDay: 0, acceptedAt: SYNTHETIC.planets.port,
            travelPlanet: null, returnPlanet: SYNTHETIC.planets.port,
            cargoType: -1, cargoQty: 0, cargoLoaded: false, travelDone: false,
            deadlineDay: null, shipObjective,
        };
    }

    /**
     * Peer A's skiff (made all but unkillable, so a 40 s fight cannot end
     * it) with one mission out in Thessaly Reach, whose two special ships
     * are spawned the way mission_ship_spawn builds them for `behavior`,
     * plus one aux ship of the same mission.
     */
    async function flying(behavior: number, aiType = 3) {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            'node', { npcs: false });
        const skiff = await gameData.data.Ship.get(SYNTHETIC.ships.skiff);
        const owner = makeShip(skiff);
        owner.components.set(MovementStateComponent, {
            accelerating: 0, position: new Position(0, 0),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        });
        owner.components.set(ControlledByComponent, { peerId: 'a' });
        owner.components.set(MultiplayerData, { owner: 'a' });
        owner.components.set(CreditsComponent, { credits: 0 });
        owner.components.set(GameDateComponent,
            { day: 3, month: 4, year: 1177 });
        const goal = behavior === 1 ? GOAL_ESCORT : GOAL_DESTROY;
        owner.components.set(MissionsComponent,
            new Map([[MISSION, mission(objective(goal, behavior))]]));
        await completeEntity(world, owner);
        // Unkillable through its ShipData: shipStatSystem re-derives the
        // Armor / Shield caps from the hull every tick, so raising the
        // Stats themselves (as this spec used to) was undone at once, and
        // the raiders disabled and plundered the 25-armor skiff inside 40
        // s once knockback went to 30 x (reference KB, wave 46).
        const ownerData = owner.components.get(ShipDataComponent)!;
        owner.components.set(ShipDataComponent, {
            ...ownerData,
            physics: { ...ownerData.physics, armor: 1e9, shield: 1e9 },
        });
        owner.components.delete(ShipPhysicsComponent);
        world.entities.set(OWNER, owner);

        const corsair = await gameData.data.Ship.get(SYNTHETIC.ships.corsair);
        const uuids = ['special 1', 'special 2', 'aux'];
        for (const [index, uuid] of uuids.entries()) {
            const ship = makeNpcShip(corsair, aiType,
                behavior === 0 ? SYNTHETIC.govts.raiders
                    : SYNTHETIC.govts.meridian,
                new Position(300 + 100 * index, 200), new Angle(0),
                new Vector(0, 0));
            const aux = uuid === 'aux';
            ship.components.set(MissionShipComponent, {
                mission: MISSION, owner: OWNER, ...(aux ? { aux } : {}),
            });
            ship.components.set(MultiplayerData, { owner: 'a' });
            const npc = ship.components.get(NpcComponent)!;
            if (!aux) {
                npc.departAt = MISSION_SHIP_NO_DEPART_MS;
                ship.components.set(SystemHoldComponent,
                    { reason: 'missionGoal' });
                if (behavior === 0) {
                    npc.aggressor = OWNER;
                    ship.components.set(TargetComponent, { target: OWNER });
                } else if (behavior === 1) {
                    ship.components.set(FormationComponent,
                        { leader: OWNER, slot: index });
                    ship.components.set(FiringGroupComponent,
                        { group: OWNER });
                }
            }
            await completeEntity(world, ship);
            world.entities.set(uuid, ship);
        }
        for (let i = 0; i < 60; i++) {
            world.step();
        }
        // Unkillable: the raiders fight on for the whole spec.
        for (const component of [ArmorComponent, ShieldComponent]) {
            expect(owner.components.get(component)!.max).toBe(1e9);
        }
        return { world, gameData };
    }

    async function abort(world: World) {
        const record: InputRecord = {
            peerId: 'a', tick: 1,
            inputs: [{ kind: 'abortMission', aborted: { missionId: MISSION } }],
        };
        await loadInputRecordsGameData(world, [record]);
        applyInputRecords(world, [record]);
    }

    function now(world: World) {
        return world.resources.get(TimeResource)!.time;
    }

    function stepFor(world: World, ms: number) {
        for (let t = 0; t < ms; t += STEP_MS) {
            world.step();
        }
    }

    describe('ShipBehav 1 (protect the player)', () => {
        it('turns neutral at once: out of the flock, untethered, no hold',
            async () => {
                const { world } = await flying(1);
                expect(isInFlock('special 1', OWNER,
                    uuid => world.entities.get(uuid))).toBeTrue();
                await abort(world);
                world.step();
                const escort = world.entities.get('special 1')!;
                expect(escort).toBeDefined();
                expect(isInFlock('special 1', OWNER,
                    uuid => world.entities.get(uuid))).toBeFalse();
                expect(escort.components.has(FormationComponent)).toBeFalse();
                expect(escort.components.has(FiringGroupComponent))
                    .toBeFalse();
                expect(escort.components.has(SystemHoldComponent))
                    .toBeFalse();
                expect(escort.components.get(MissionShipComponent)!.untethered)
                    .toBeTrue();
                // The aux ship was not measured: it goes, as before.
                expect(world.entities.has('aux')).toBeFalse();
            });

        // The measured window is a warship's (AI 3: about 17 s here). A
        // trader (AI 1) spends the wait flying in toward a stellar, so
        // its run back out of the no-jump zone is longer; it still leaves.
        for (const [aiType, earliest, latest] of [[3, 14, 20], [1, 13, 30]]) {
            it(`jumps out about 17 s after the abort (AI ${aiType})`,
                async () => {
                    const { world } = await flying(1, aiType!);
                    await abort(world);
                    const abortedAt = now(world);
                    expect(world.entities.get('special 1')!.components
                        .get(NpcComponent)!.departAt)
                        .toBe(abortedAt + ABORTED_ESCORT_DEPART_MS);
                    let goneAt: number | undefined;
                    while (now(world) - abortedAt < 40_000) {
                        world.step();
                        if (!world.entities.has('special 1')) {
                            goneAt = now(world);
                            break;
                        }
                    }
                    expect(goneAt).withContext('it left').toBeDefined();
                    const after = (goneAt! - abortedAt) / 1000;
                    expect(after).toBeGreaterThan(earliest!);
                    expect(after).toBeLessThan(latest!);
                });
        }
    });

    describe('ShipBehav 0 (always attack the player)', () => {
        it('keeps fighting for as long as the owner stays', async () => {
            const { world } = await flying(0);
            await abort(world);
            const abortedAt = now(world);
            for (const seconds of [3, 8, 21, 40]) {
                stepFor(world, abortedAt + seconds * 1000 - now(world));
                for (const uuid of ['special 1', 'special 2']) {
                    const raider = world.entities.get(uuid);
                    expect(raider).withContext(`${uuid} at ${seconds}s`)
                        .toBeDefined();
                    expect(raider!.components.get(NpcComponent)!.aggressor)
                        .toBe(OWNER);
                    expect(raider!.components.get(MissionShipComponent)!
                        .untethered).toBeTrue();
                }
            }
            expect(world.entities.has('aux')).toBeFalse();
        });

        it('goes once the owner leaves the system', async () => {
            const { world } = await flying(0);
            await abort(world);
            stepFor(world, 1000);
            // Landing or jumping takes the owner's entity out of the world.
            world.entities.delete(OWNER);
            world.step();
            expect(world.entities.has('special 1')).toBeFalse();
            expect(world.entities.has('special 2')).toBeFalse();
        });

        it('is ignored by the goals of the same mission taken again',
            async () => {
                const { world } = await flying(0);
                await abort(world);
                world.step();
                const owner = world.entities.get(OWNER)!;
                owner.components.get(MissionsComponent)!.set(MISSION,
                    mission(objective(GOAL_DESTROY, 0)));
                stepFor(world, 1000);
                const again = owner.components.get(MissionsComponent)!
                    .get(MISSION)!.shipObjective!;
                expect(again.live.size).toBe(0);
                expect(liveMissionShips(world.entities, OWNER).special
                    .has(MISSION)).toBeFalse();
                // ...and they are still here: the new mission's tether
                // does not reach them either.
                expect(world.entities.has('special 1')).toBeTrue();
            });
    });

    for (const behavior of [-1, 2]) {
        it(`keeps the ShipBehav ${behavior} ships, released, and deletes `
            + 'only the aux ship (reference "Boarding live mission ships, '
            + 'wave 61": a disabled ShipBehav -1 ship stayed)', async () => {
                const { world } = await flying(behavior);
                await abort(world);
                world.step();
                for (const uuid of ['special 1', 'special 2']) {
                    expect(world.entities.get(uuid)?.components
                        .get(MissionShipComponent)?.untethered)
                        .withContext(uuid).toBeTrue();
                }
                expect(world.entities.has('aux')).toBeFalse();
            });
    }

    it('replays the abort identically after a rollback', async () => {
        const { world } = await flying(1);
        const before = snapshotWorld(world);
        const run = async () => {
            await abort(world);
            const hashes = [hashWorld(world).hash];
            for (let i = 0; i < 20 * 60; i++) {
                world.step();
                if (i % 60 === 0) {
                    hashes.push(hashWorld(world).hash);
                }
            }
            return { hashes, escortHere: world.entities.has('special 1') };
        };
        const first = await run();
        expect(first.escortHere).withContext('gone by 20 s').toBeFalse();
        restoreWorld(world, before, deriveEntityComponents);
        expect(world.entities.get(OWNER)!.components.get(MissionsComponent)!
            .has(MISSION)).toBeTrue();
        const second = await run();
        expect(second.hashes).toEqual(first.hashes);
        const policies = world.resources.get(SnapshotPoliciesResource)!;
        expect([...policies.unhandled]).toEqual([]);
    });
});
