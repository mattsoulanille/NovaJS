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
import {
    failureOwed, missionCargoKey, MissionSetString, owedMissionSetString,
    shipDoneOwed,
} from '../nova_plugin/missions/index.js';
import { ActiveRanksComponent, ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    ActiveMission, ControlledByComponent, CreditsComponent, GameDateComponent,
    GOAL_DESTROY, GOAL_DISABLE, GOAL_ESCORT, MissionShipComponent,
    MissionsComponent, PendingMissionNoticesComponent, PlayerNamesComponent,
    ShipObjective,
} from '../nova_plugin/player/index.js';
import { LegalRecordsComponent } from '../nova_plugin/reputation/index.js';
import {
    CargoComponent, DamagedEvent, DeathEvent, makeShip, OutfitsStateComponent,
} from '../nova_plugin/ship/index.js';
import { completeEntity, makeNpcShip } from '../nova_plugin/spawn/index.js';
import {
    decodeSave, encodeSave, extractSaveData, restorePlayerState,
} from '../nova_plugin/pilot/index.js';
import { advanceEntityDate, processEntityLanding } from './mission_session.js';
import { emptySetStringRequests } from './set_string_requests.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { MissionUniverse } from './mission_universe.js';
import {
    buildDeferredAutoAbort, buildMissionSetString,
} from './ship_mission_accept.js';

/**
 * ============================================================================
 * OnShipDone and an in-flight OnFailure, run AT ONCE
 * ============================================================================
 *
 * Reference "OnShipDone and an in-flight OnFailure, read by a person's hail
 * (the SD / SF leftover), wave 48": both strings' bits are set in flight,
 * seconds after the special ship's death and after "Mission failed.". The
 * sim marks the moment (the goal's `shipDonePending`, a `failed` goal); the
 * owner's client resolves the string (buildMissionSetString) and sends a
 * `missionSetString` record. These specs step a real world: the special
 * ship dies in the sim, the record is built from the pilot as the sim left
 * it and applied as an input record, and the next date advance (a jump or
 * a landing) does not run the string a second time.
 */
describe('a mission\'s OnShipDone and in-flight OnFailure', () => {
    const COURIER = SYNTHETIC.missions.courier;
    const THESSALY = SYNTHETIC.systems.thessaly;
    const CARGO = missionCargoKey(COURIER);
    /** Toggles (^b), so a second run would show. */
    const SHIP_DONE_BIT = 9001;
    const FAILURE_BIT = 9002;
    const LETHAL_DAMAGE = {
        shield: 1e9, armor: 1e9, ionization: 0, ionizationColor: 0,
        knockback: 0, passThroughShield: true, recoil: 0,
    } as never;

    /** The courier's OnShipDone (a spec may add operators to it). */
    let onShipDone = `^b${SHIP_DONE_BIT}`;
    /** Replaces the courier's OnFailure when set. */
    let onFailure: string | undefined;

    beforeEach(() => {
        onShipDone = `^b${SHIP_DONE_BIT}`;
        onFailure = undefined;
        // The courier run with an OnShipDone, a countable OnFailure and a
        // FailText.
        const original = MissionUniverse.prototype.getMission;
        spyOn(MissionUniverse.prototype, 'getMission').and.callFake(
            function (this: MissionUniverse, id: string) {
                const mission = original.call(this, id);
                return mission && id === COURIER ? {
                    ...mission,
                    onShipDone,
                    onFailure: onFailure
                        ?? `${mission.onFailure} ^b${FAILURE_BIT}`,
                    failText: 'The convoy is lost.',
                } as MissionData : mission;
            });
    });

    function objective(goal: number): ShipObjective {
        return {
            goal, systemId: null, shipStart: 0, behavior: -1,
            dudeId: SYNTHETIC.dudes.raiders, total: 1, satisfied: 0,
            complete: false, failed: false, shipDonePending: false,
            live: new Map(),
        };
    }

    function courier(goal: number): ActiveMission {
        return {
            id: COURIER, acceptedDay: 0, acceptedAt: SYNTHETIC.planets.port,
            travelPlanet: SYNTHETIC.planets.moon,
            returnPlanet: SYNTHETIC.planets.port,
            cargoType: 0, cargoQty: 10, cargoLoaded: true, travelDone: false,
            deadlineDay: null, shipObjective: objective(goal),
        };
    }

    async function settle(world: World, ticks: number) {
        for (let i = 0; i < ticks; i++) {
            world.step();
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    /** Pilot A on the courier run with one special ship out (goal `goal`);
     * pilot B in the same system with no mission. */
    async function flying(goal: number) {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(THESSALY, gameData, 'node',
            { npcs: false });
        const pilot = async (peerId: string, missions: [string, ActiveMission][]) => {
            const ship = makeShip(await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
            ship.components.set(MovementStateComponent, {
                accelerating: 0,
                position: new Position(peerId === 'a' ? 100 : -100, 40),
                rotation: new Angle(0.5), turnBack: false, turning: 0,
                velocity: new Vector(0, 0),
            });
            ship.components.set(ControlledByComponent, { peerId });
            ship.components.set(MultiplayerData, { owner: peerId });
            ship.components.set(CreditsComponent, { credits: 9_000 });
            ship.components.set(GameDateComponent, { day: 3, month: 4, year: 1177 });
            ship.components.set(MissionsComponent, new Map(missions));
            ship.components.set(ControlBitsComponent,
                new Set<number>([BITS.courierAccepted]));
            ship.components.set(ActiveRanksComponent, new Set());
            ship.components.set(CargoComponent, new Map([[CARGO, 10]]));
            ship.components.set(LegalRecordsComponent, new Map([[THESSALY, 30]]));
            ship.components.set(OutfitsStateComponent, new Map());
            await completeEntity(world, ship);
            world.entities.set(`ship ${peerId}`, ship);
            return ship;
        };
        const a = await pilot('a', [[COURIER, courier(goal)]]);
        await pilot('b', []);
        const special = makeNpcShip(
            await gameData.data.Ship.get(SYNTHETIC.ships.corsair), 1,
            SYNTHETIC.govts.meridian, new Position(600, 0), new Angle(0),
            new Vector(0, 0));
        special.components.set(MissionShipComponent,
            { mission: COURIER, owner: 'ship a' });
        special.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(world, special);
        world.entities.set('special', special);
        await settle(world, 30);
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const active = () => a.components.get(MissionsComponent)!.get(COURIER);
        return { gameData, universe, world, a, active };
    }

    async function kill(world: World, uuid: string) {
        let died = false;
        const sub = world.events.get(DeathEvent).subscribe(() => { died = true; });
        world.emit(DamagedEvent, { damage: LETHAL_DAMAGE, damager: 'test' },
            [uuid]);
        for (let i = 0; i < 60 * 20 && !died; i++) {
            world.step();
            await new Promise(resolve => setImmediate(resolve));
        }
        sub.unsubscribe();
        await settle(world, 5);
        return died;
    }

    async function apply(world: World, peerId: string, record: MissionSetString) {
        const input: SimulationInput = { kind: 'missionSetString', record };
        expect(SimulationInputType.is(input)).withContext('wire codec')
            .toBeTrue();
        const inputRecord: InputRecord = { peerId, tick: 1, inputs: [input] };
        await loadInputRecordsGameData(world, [inputRecord]);
        applyInputRecords(world, [inputRecord]);
    }

    function bits(world: World, uuid = 'ship a') {
        return world.entities.get(uuid)!.components.get(ControlBitsComponent)!;
    }

    it('runs OnShipDone the moment the goal completes, once (no second run '
        + 'at the next date advance)', async () => {
        const { gameData, universe, world, a, active } =
            await flying(GOAL_DESTROY);
        expect(owedMissionSetString(a.components.get(MissionsComponent)!))
            .toBeUndefined();
        expect(await kill(world, 'special')).withContext('the special died')
            .toBeTrue();
        expect(active()!.shipObjective!.shipDonePending).toBeTrue();
        const owed = owedMissionSetString(a.components.get(MissionsComponent)!);
        expect(owed).toEqual({ kind: 'shipDone', missionId: COURIER });

        const record = await buildMissionSetString(a, owed!, gameData,
            universe, { systemId: THESSALY });
        expect(record).toEqual({
            missionId: COURIER, kind: 'shipDone', bitsSet: [SHIP_DONE_BIT],
        });
        // Building it left the mirror alone.
        expect(bits(world).has(SHIP_DONE_BIT)).toBeFalse();

        await apply(world, 'a', record!);
        expect(bits(world).has(SHIP_DONE_BIT)).toBeTrue();
        // The goal stays done and its text still owed to the date advance.
        expect(active()!.shipObjective).toEqual(jasmine.objectContaining({
            complete: true, shipDonePending: true, onShipDoneRun: true,
        }));
        expect(owedMissionSetString(a.components.get(MissionsComponent)!))
            .toBeUndefined();
        expect(await buildMissionSetString(a, owed!, gameData, universe))
            .toBeNull();

        // A duplicate is a no-op (the toggle would clear the bit).
        await apply(world, 'a', record!);
        expect(bits(world).has(SHIP_DONE_BIT)).toBeTrue();

        // The next jump's date advance settles the goal without running
        // the string again.
        await advanceEntityDate(a, 1, universe, gameData);
        expect(active()!.shipObjective!.shipDonePending).toBeFalse();
        expect(bits(world).has(SHIP_DONE_BIT)).toBeTrue();
        expect(active()).withContext('still active until its landing')
            .toBeDefined();
    }, 60_000);

    it('runs an in-flight OnFailure the moment the goal fails: the '
        + 'mission, its cargo and its CompReward go at once, the notice waits '
        + 'for the next spaceport, and the date advance runs nothing more',
        async () => {
            const { gameData, universe, world, a, active } =
                await flying(GOAL_ESCORT);
            expect(await kill(world, 'special')).toBeTrue();
            expect(active()!.shipObjective!.failed).toBeTrue();
            const owed = owedMissionSetString(
                a.components.get(MissionsComponent)!);
            expect(owed).toEqual({ kind: 'failure', missionId: COURIER });

            const record = await buildMissionSetString(a, owed!, gameData,
                universe, { systemId: THESSALY });
            expect(record).toEqual(jasmine.objectContaining({
                missionId: COURIER, kind: 'failure',
                // OnFailure `!b100 ^b9002`.
                bitsSet: [FAILURE_BIT],
                bitsCleared: [BITS.courierAccepted],
                cargoDelta: [[CARGO, -10]],
                // CompReward 2 to the Concord: -R/2 in each of its systems.
                recordsDelta: [[THESSALY, -1], [SYNTHETIC.systems.vael, -1]],
            }));
            expect(record!.notices?.map(notice => notice.type))
                .toEqual(['failed']);

            await apply(world, 'a', record!);
            expect(active()).withContext('the mission is gone').toBeUndefined();
            expect(bits(world).has(FAILURE_BIT)).toBeTrue();
            expect(bits(world).has(BITS.courierAccepted)).toBeFalse();
            expect(a.components.get(CargoComponent)!.has(CARGO)).toBeFalse();
            expect(a.components.get(LegalRecordsComponent)!.get(THESSALY))
                .toBe(29);
            expect(a.components.get(PendingMissionNoticesComponent)
                ?.map(notice => [notice.type, notice.missionId]))
                .toEqual([['failed', COURIER]]);

            // A duplicate finds the mission gone.
            await apply(world, 'a', record!);
            expect(bits(world).has(FAILURE_BIT)).toBeTrue();
            await advanceEntityDate(a, 1, universe, gameData);
            expect(bits(world).has(FAILURE_BIT)).toBeTrue();
            expect(a.components.get(PendingMissionNoticesComponent)?.length)
                .toBe(1);
        }, 60_000);

    it('keeps an in-flight failure\'s FailText across a save-and-quit: '
        + 'the restored pilot\'s next landing shows it once', async () => {
        // The failure takes the mission off the list at once, so the
        // queued notice is the only trace of it left; before the save
        // carried `pendingNotices` a save-and-quit here lost the text.
        const { gameData, universe, world, a } = await flying(GOAL_ESCORT);
        expect(await kill(world, 'special')).toBeTrue();
        const owed = owedMissionSetString(a.components.get(MissionsComponent)!);
        const record = await buildMissionSetString(a, owed!, gameData,
            universe, { systemId: THESSALY });
        await apply(world, 'a', record!);
        const failText = record!.notices![0].text;
        expect(failText).withContext('the FailText')
            .toBe('The convoy is lost.');

        // Save in flight, then quit: the save goes through its JSON envelope.
        const saved = extractSaveData(a, THESSALY)!;
        expect(saved.missions.map(([id]) => id)).not.toContain(COURIER);
        expect(saved.pendingNotices?.map(notice => [notice.type, notice.text]))
            .toEqual([['failed', failText]]);
        const loaded = decodeSave(encodeSave(saved))!;
        expect(loaded).toEqual(saved);

        // Reload: a fresh hull, the save restored onto it.
        const restored = makeShip(
            await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
        restorePlayerState(restored, loaded);
        expect(restored.components.get(PendingMissionNoticesComponent))
            .toEqual(a.components.get(PendingMissionNoticesComponent)!);

        // The next landing shows it, once.
        const landing = await processEntityLanding(restored, gameData,
            universe, SYNTHETIC.planets.port);
        expect(landing.filter(event => event.missionId === COURIER)
            .map(event => [event.type, event.text]))
            .toEqual([['failed', failText]]);
        // Drained: the save after the landing carries none, and neither a
        // second landing nor a reload of that save shows it again.
        const after = extractSaveData(restored, THESSALY)!;
        expect(after.pendingNotices).toBeUndefined();
        const again = await processEntityLanding(restored, gameData,
            universe, SYNTHETIC.planets.port);
        expect(again.filter(event => event.missionId === COURIER)).toEqual([]);
        const reloaded = makeShip(
            await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
        restorePlayerState(reloaded, decodeSave(encodeSave(after))!);
        expect(reloaded.components.has(PendingMissionNoticesComponent))
            .toBeFalse();
    }, 60_000);

    it('fails a mission the sim failed for the pilot (Flags2 0x0004), and '
        + 'its live special ship stays, no longer the mission\'s', async () => {
        const { gameData, universe, world, a, active } =
            await flying(GOAL_DESTROY);
        // MissionPlayerFailSystem's mark when the owner is disabled.
        active()!.failed = true;
        active()!.failCause = 'lost';
        const owed = owedMissionSetString(a.components.get(MissionsComponent)!);
        expect(owed).toEqual({ kind: 'failure', missionId: COURIER });
        const record = await buildMissionSetString(a, owed!, gameData,
            universe, { systemId: THESSALY });
        await apply(world, 'a', record!);
        expect(active()).toBeUndefined();
        expect(bits(world).has(FAILURE_BIT)).toBeTrue();
        await settle(world, 5);
        expect(world.entities.has('special'))
            .withContext('not deleted with its mission').toBeTrue();
        expect(world.entities.get('special')!.components
            .get(MissionShipComponent)!.untethered).toBeTrue();
    }, 60_000);

    it('pays only the sender\'s own debt', async () => {
        const { gameData, universe, world, a, active } =
            await flying(GOAL_DESTROY);
        expect(await kill(world, 'special')).toBeTrue();
        const owed = owedMissionSetString(a.components.get(MissionsComponent)!);
        const record = await buildMissionSetString(a, owed!, gameData,
            universe, { systemId: THESSALY });
        // Peer B holds no such mission: nothing happens to anyone.
        await apply(world, 'b', record!);
        expect(bits(world).has(SHIP_DONE_BIT)).toBeFalse();
        expect(bits(world, 'ship b').has(SHIP_DONE_BIT)).toBeFalse();
        expect(active()!.shipObjective!.onShipDoneRun).toBeUndefined();
        // A failure record for a mission that has not failed is refused.
        await apply(world, 'a', { missionId: COURIER, kind: 'failure',
            bitsSet: [FAILURE_BIT] });
        expect(active()).toBeDefined();
        expect(bits(world).has(FAILURE_BIT)).toBeFalse();
    }, 60_000);

    it('owes a disable goal\'s OnShipDone before its failure (disabled, then '
        + 'destroyed)', () => {
        const mission = courier(GOAL_DISABLE);
        // shipDisabled then shipDied: the goal stays complete, ShipDone
        // still pending, and the mission failed.
        mission.shipObjective = {
            ...mission.shipObjective!, satisfied: 0, complete: true,
            shipDonePending: true, failed: true,
        };
        const missions = new Map([[COURIER, mission]]);
        expect(shipDoneOwed(mission)).toBeTrue();
        expect(failureOwed(mission)).toBeFalse();
        expect(owedMissionSetString(missions))
            .toEqual({ kind: 'shipDone', missionId: COURIER });
        mission.shipObjective = { ...mission.shipObjective, onShipDoneRun: true };
        expect(failureOwed(mission)).toBeTrue();
        expect(owedMissionSetString(missions))
            .toEqual({ kind: 'failure', missionId: COURIER });
    });

    it('leaves a deferred auto-abort\'s OnShipDone to its abort record, '
        + 'which runs it first', async () => {
        const { gameData, universe, world, a, active } =
            await flying(GOAL_DESTROY);
        expect(await kill(world, 'special')).toBeTrue();
        active()!.autoAbortPending = true;
        expect(owedMissionSetString(a.components.get(MissionsComponent)!))
            .toBeUndefined();
        const abort = await buildDeferredAutoAbort(a, COURIER, gameData,
            universe, { systemId: THESSALY });
        expect(abort!.record.bitsSet).toEqual([SHIP_DONE_BIT]);
    }, 60_000);

    /**
     * `Qxxx` / `Txxx` / `Pxxx` in an OnShipDone (stock: 30-odd OnShipDones
     * and in-flight OnFailures carry a Q — mïsn nova:156 `Q25059`
     * "Holographic recording complete.  Return to P'ar Aed."; arpia:1028's
     * OnShipDone is `P5001`). The STR# / snd numbers come back as requests
     * for the owner's display; a T's line is picked from its STR# and rides
     * the record as `shipName`, which every peer applies.
     */
    it('hands an OnShipDone\'s Q and P to the owner\'s display and its T to '
        + 'the record', async () => {
        onShipDone = `^b${SHIP_DONE_BIT} Q25059 T25040 P5001`;
        const { gameData, universe, world, a } = await flying(GOAL_DESTROY);
        expect(await kill(world, 'special')).toBeTrue();
        const owed = owedMissionSetString(a.components.get(MissionsComponent)!);
        const tables: { [id: string]: string[] } = {
            'nova:25040': ['Dart', 'Dart'],
        };
        const displayAssets = {
            data: {
                StringTable: {
                    get: async (id: string) => {
                        if (!tables[id]) {
                            throw new Error(`no STR# ${id}`);
                        }
                        return { id, strings: tables[id] };
                    },
                },
            },
        } as unknown as DisplayAssetDataInterface;
        const requests = emptySetStringRequests();
        const record = await buildMissionSetString(a, owed!, gameData,
            universe, { systemId: THESSALY, displayAssets, requests });
        expect(record).toEqual({
            missionId: COURIER, kind: 'shipDone', bitsSet: [SHIP_DONE_BIT],
            shipName: 'Dart',
        });
        expect(requests.statusQuotes).toEqual(
            [{ stringId: 25059, prefix: 'nova' }]);
        expect(requests.sounds).toEqual([{ soundId: 5001, prefix: 'nova' }]);
        expect(requests.shipNames).toEqual(
            [{ stringId: 25040, prefix: 'nova' }]);

        await apply(world, 'a', record!);
        expect(world.entities.get('ship a')!.components
            .get(PlayerNamesComponent)?.ship).toBe('Dart');
        // The other pilot's name is not touched.
        expect(world.entities.get('ship b')!.components
            .get(PlayerNamesComponent)?.ship).toBeUndefined();
    }, 60_000);

    it('a jump\'s date advance hands a deadline OnFailure\'s Q and M to the '
        + 'caller (the duellists\' `Q7999`, arpia:1038\'s `M500`)',
        async () => {
            onFailure = `Q7999 M${SYNTHETIC.systems.ossory.split(':')[1]}`;
            const gameData = await getSyntheticGameData();
            const universe = MissionUniverse.shared(gameData);
            await universe.load();
            const ship = makeShip(
                await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
            ship.components.set(GameDateComponent,
                { day: 3, month: 4, year: 1177 });
            ship.components.set(MissionsComponent, new Map([[COURIER, {
                ...courier(GOAL_DESTROY), shipObjective: undefined,
                deadlineDay: 0,
            }]]));
            const quotes: unknown[] = [];
            const moves: unknown[] = [];
            await advanceEntityDate(ship, 2, universe, gameData, {
                operators: {
                    leaveStellar: (stringId, prefix) =>
                        quotes.push({ stringId, prefix }),
                    moveToSystem: (systemId, keepCoordinates) =>
                        moves.push({ systemId, keepCoordinates }),
                },
            });
            expect(ship.components.get(MissionsComponent)!.has(COURIER))
                .withContext('the deadline failed it').toBeFalse();
            expect(quotes).toEqual([{ stringId: 7999, prefix: 'nova' }]);
            expect(moves).toEqual([{
                systemId: SYNTHETIC.systems.ossory, keepCoordinates: false,
            }]);
        }, 60_000);
});
