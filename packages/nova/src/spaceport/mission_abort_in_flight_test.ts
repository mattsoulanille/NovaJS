import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { World } from 'nova_ecs/world';
import { MissionData } from 'novadatainterface/mission_data';
import { BITS, SYNTHETIC } from 'novaparse/synthetic/universe';
import {
    applyInputRecords, InputRecord, loadInputRecordsGameData, SimulationInput,
    SimulationInputType,
} from '../communication/simulation_input.js';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { AbortedMission, missionCargoKey } from '../nova_plugin/missions/index.js';
import { ActiveRanksComponent, ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    ActiveMission, ControlledByComponent, CreditsComponent, GameDateComponent,
    MissionShipComponent, MissionsComponent,
} from '../nova_plugin/player/index.js';
import { LegalRecordsComponent } from '../nova_plugin/reputation/index.js';
import {
    CargoComponent, makeShip, OutfitsStateComponent,
} from '../nova_plugin/ship/index.js';
import { completeEntity, makeNpcShip } from '../nova_plugin/spawn/index.js';
import { MissionUniverse } from './mission_universe.js';
import { buildMissionAbort } from './ship_mission_accept.js';

/**
 * ============================================================================
 * Aborting a mission IN FLIGHT (the 'i' dialog's Abort)
 * ============================================================================
 *
 * The abort is resolved on the owning client against a detached copy of the
 * player — the docked path's own abortMission: OnAbort, the 0x0040 CompReward
 * reversal, the mission cargo unloaded — and carried to the simulation as an
 * `abortMission` input record of deltas. The mission's special ships follow
 * the mission out (MissionShipCleanupSystem's tether). Only the owner can
 * abort, a record applies once, and CanAbort 0 stays un-abortable.
 */
describe('aborting a mission in flight', () => {
    const COURIER = SYNTHETIC.missions.courier;
    const MERIDIAN = SYNTHETIC.govts.meridian;
    const CARGO = missionCargoKey(COURIER);

    function courier(): ActiveMission {
        return {
            id: COURIER, acceptedDay: 0, acceptedAt: SYNTHETIC.planets.port,
            travelPlanet: SYNTHETIC.planets.moon,
            returnPlanet: SYNTHETIC.planets.port,
            cargoType: 0, cargoQty: 10, cargoLoaded: true, travelDone: false,
            deadlineDay: 30,
        };
    }

    async function pilot(world: World, gameData: Awaited<ReturnType<typeof getSyntheticGameData>>,
        peerId: string, missions: [string, ActiveMission][], cargo: [string, number][]) {
        const ship = makeShip(await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
        ship.components.set(MovementStateComponent, {
            accelerating: 0, position: new Position(peerId === 'a' ? 100 : -100, 40),
            rotation: new Angle(0.5), turnBack: false, turning: 0,
            velocity: new Vector(10, 0),
        });
        ship.components.set(ControlledByComponent, { peerId });
        ship.components.set(MultiplayerData, { owner: peerId });
        ship.components.set(CreditsComponent, { credits: 9_000 });
        ship.components.set(GameDateComponent, { day: 3, month: 4, year: 1177 });
        ship.components.set(MissionsComponent, new Map(missions));
        ship.components.set(ControlBitsComponent,
            new Set<number>([BITS.courierAccepted]));
        ship.components.set(ActiveRanksComponent, new Set());
        ship.components.set(CargoComponent, new Map(cargo));
        ship.components.set(LegalRecordsComponent, new Map([[MERIDIAN, 30]]));
        ship.components.set(OutfitsStateComponent, new Map());
        await completeEntity(world, ship);
        return ship;
    }

    /** Pilot A flies a loaded courier run with one special ship out; pilot
     * B flies in the same system, also on the courier run. */
    async function flying() {
        const gameData = await getSyntheticGameData();
        const systemId = SYNTHETIC.systems.thessaly;
        const world = await makeSystem(systemId, gameData, 'node', { npcs: false });
        const a = await pilot(world, gameData, 'a', [[COURIER, courier()]],
            [[CARGO, 10], ['cargo:0', 6]]);
        world.entities.set('ship a', a);
        const b = await pilot(world, gameData, 'b', [[COURIER, courier()]],
            [[CARGO, 10]]);
        world.entities.set('ship b', b);
        const special = makeNpcShip(
            await gameData.data.Ship.get(SYNTHETIC.ships.corsair), 1,
            MERIDIAN, new Position(400, 0), new Angle(0), new Vector(0, 0));
        special.components.set(MissionShipComponent,
            { mission: COURIER, owner: 'ship a' });
        special.components.set(MultiplayerData, { owner: 'a' });
        await completeEntity(world, special);
        world.entities.set('special', special);
        world.step();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        return { gameData, universe, world, systemId, a, b };
    }

    async function apply(world: World, peerId: string, aborted: AbortedMission) {
        const input: SimulationInput = { kind: 'abortMission', aborted };
        const record: InputRecord = { peerId, tick: 1, inputs: [input] };
        await loadInputRecordsGameData(world, [record]);
        applyInputRecords(world, [record]);
    }

    /** The courier run as `edit` rewrites it, for the length of a spec. */
    function rewriteCourier(edit: (mission: MissionData) => MissionData) {
        const original = MissionUniverse.prototype.getMission;
        spyOn(MissionUniverse.prototype, 'getMission').and.callFake(
            function (this: MissionUniverse, id: string) {
                const mission = original.call(this, id);
                return mission && id === COURIER ? edit(mission) : mission;
            });
    }

    it('applies what a docked abort applies: OnAbort, the cargo, the '
        + 'mission, and its special ships', async () => {
        const { gameData, universe, world, systemId, a } = await flying();
        const abort = await buildMissionAbort(a, COURIER, gameData, universe,
            { systemId });
        expect(abort).not.toBeNull();
        expect(abort!.record).toEqual({
            missionId: COURIER,
            // OnAbort `!b100`; the courier's cargo comes off.
            bitsCleared: [BITS.courierAccepted],
            cargoDelta: [[CARGO, -10]],
        });
        expect(abort!.events.map(event => event.type)).toEqual(['aborted']);
        // The record survives its own wire codec.
        expect(SimulationInputType.is({ kind: 'abortMission', aborted: abort!.record }))
            .toBeTrue();
        // Building it left the player's mirror alone.
        expect(a.components.get(MissionsComponent)!.has(COURIER)).toBeTrue();

        await apply(world, 'a', abort!.record);
        const ship = world.entities.get('ship a')!;
        expect(ship.components.get(MissionsComponent)!.has(COURIER)).toBeFalse();
        expect(ship.components.get(ControlBitsComponent)!.has(BITS.courierAccepted))
            .toBeFalse();
        expect([...ship.components.get(CargoComponent)!]).toEqual([['cargo:0', 6]]);
        // No CompReward reversal without mïsn Flags 0x0040.
        expect(ship.components.get(LegalRecordsComponent)!.get(MERIDIAN)).toBe(30);
        expect(world.entities.has('special')).toBeTrue();
        world.step();
        expect(world.entities.has('special'))
            .withContext('the special ship follows its mission out')
            .toBeFalse();
        // Pilot B's courier run is untouched.
        expect(world.entities.get('ship b')!.components.get(MissionsComponent)!
            .has(COURIER)).toBeTrue();
    });

    it('applies a record once', async () => {
        const { gameData, universe, world, systemId, a } = await flying();
        const abort = await buildMissionAbort(a, COURIER, gameData, universe,
            { systemId });
        await apply(world, 'a', abort!.record);
        const ship = world.entities.get('ship a')!;
        // Something else sets the bit again; a replayed record finds the
        // mission gone and does nothing (no second OnAbort).
        ship.components.get(ControlBitsComponent)!.add(BITS.courierAccepted);
        ship.components.get(CargoComponent)!.set(CARGO, 4);
        await apply(world, 'a', abort!.record);
        expect(ship.components.get(ControlBitsComponent)!.has(BITS.courierAccepted))
            .toBeTrue();
        expect(ship.components.get(CargoComponent)!.get(CARGO)).toBe(4);
    });

    it('aborts only the sender\'s own mission', async () => {
        const { gameData, universe, world, systemId, a } = await flying();
        const abort = await buildMissionAbort(a, COURIER, gameData, universe,
            { systemId });
        // Peer B sends A's abort: it lands on B's OWN ship (the actor is
        // the sender's, never named in the record), so A keeps the run.
        await apply(world, 'b', abort!.record);
        const shipA = world.entities.get('ship a')!;
        expect(shipA.components.get(MissionsComponent)!.has(COURIER)).toBeTrue();
        expect(shipA.components.get(ControlBitsComponent)!.has(BITS.courierAccepted))
            .toBeTrue();
        expect(shipA.components.get(CargoComponent)!.get(CARGO)).toBe(10);
        // A peer with no ship at all changes nothing.
        await apply(world, 'c', abort!.record);
        expect(shipA.components.get(MissionsComponent)!.has(COURIER)).toBeTrue();
    });

    it('refuses a CanAbort 0 mission and a mission the player lacks', async () => {
        const { gameData, universe, systemId, a } = await flying();
        expect(await buildMissionAbort(a, SYNTHETIC.missions.gateSurvey,
            gameData, universe, { systemId })).toBeNull();
        rewriteCourier(mission => ({ ...mission, canAbort: false }));
        expect(await buildMissionAbort(a, COURIER, gameData, universe,
            { systemId })).toBeNull();
    });

    it('carries the 0x0040 CompReward reversal', async () => {
        const { gameData, universe, world, systemId, a } = await flying();
        rewriteCourier(mission => ({
            ...mission, flags: { ...mission.flags, lose5xCompRewardOnAbort: true },
        }));
        const abort = await buildMissionAbort(a, COURIER, gameData, universe,
            { systemId });
        // CompReward 2 to the Concord: -5 x 2.
        expect(abort!.record.recordsDelta).toEqual([[MERIDIAN, -10]]);
        await apply(world, 'a', abort!.record);
        expect(world.entities.get('ship a')!.components
            .get(LegalRecordsComponent)!.get(MERIDIAN)).toBe(20);
    });
});
