import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { World } from 'nova_ecs/world';
import { getDefaultCronData } from 'novadatainterface/cron_data';
import { BITS, SYNTHETIC } from 'novaparse/synthetic/universe';
import { GameDataAggregator } from '../server/parsing/game_data_aggregator.js';
import {
    getPluginGameData, getSyntheticGameData, makeSyntheticGameData,
} from '../communication/simulation_test_fixture.js';
import {
    applyInputRecords, InputRecord, loadInputRecordsGameData, SimulationInput,
} from '../communication/simulation_input.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import {
    makeMissionOffer, MissionOffer, MissionSystemMove, MissionSystemMoveEvent,
    outfitsAfterShipChange,
} from '../nova_plugin/missions/index.js';
import { ActiveRanksComponent, ControlBitsComponent, ShipChangeMode } from '../nova_plugin/ncb/index.js';
import {
    ActiveMission, ControlledByComponent, CreditsComponent, GameDateComponent,
    MissionsComponent, PlayerShipSelector,
} from '../nova_plugin/player/index.js';
import { CombatRatingComponent } from '../nova_plugin/reputation/index.js';
import {
    CargoComponent, makeShip, OutfitsStateComponent, ShipComponent, TargetComponent,
} from '../nova_plugin/ship/index.js';
import { completeEntity, makeNpcShip, PersComponent } from '../nova_plugin/spawn/index.js';
import { placeOnFirstStellar } from '../client/transit.js';
import { advanceEntityDate, MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import {
    buildShipMissionAccept, buildShipMissionOffer, buildShipMissionRefusal,
} from './ship_mission_accept.js';

/**
 * ============================================================================
 * `Cxxx` / `Exxx` / `Hxxx` WHERE A SET STRING RUNS IN FLIGHT (#141, part 2)
 * ============================================================================
 *
 * The maintainer's ruling: "Let's wire it so it works everywhere." The first
 * part wired every LANDED venue through the landing's transaction; these pin
 * the in-flight half:
 *
 *  - a ship-offered mission (mïsn AvailLoc 2) ACCEPTED or REFUSED in flight:
 *    the set string is resolved on a detached copy with the landed path's
 *    own buildChangedShip, and the class rides the record (`shipChange`)
 *    that every peer applies — the hull is replaced at the player's uuid,
 *    in place in the world, carrying the pilot;
 *  - the synthetic "Muster Call" (mïsn 141), whose buttons are SWAPPED the
 *    way plug-in arpia's 1112 swaps them, and whose OnRefuse moves the
 *    pilot to another system (Mxxx) in a new hull, retitles it (Txxx, not
 *    implemented: reported) and starts the follow-up with a LOWERCASE `s`;
 *  - the date advance's set strings (an in-flight OnFailure, a crön), which
 *    run on the entity the client holds between systems.
 *
 * Every spec also checks that no change-ship warning is logged.
 */
describe('a change-ship set string run in flight', () => {
    const SKIFF = SYNTHETIC.ships.skiff;
    const WARDEN = SYNTHETIC.ships.warden;
    const MUSTER = SYNTHETIC.missions.musterCall;
    const REPORT = SYNTHETIC.missions.musterReport;
    const COURIER = SYNTHETIC.missions.courier;
    /** The skiff's own gun: NONpersistent, so an `H` drops it. */
    const BLASTER = SYNTHETIC.outfits.blaster;
    /** Nonpersistent too; the Warden's loadout carries two of them. */
    const CAPACITOR = SYNTHETIC.outfits.shieldCapacitor;
    const PEER = 'a';
    const CREDITS = 25_000;

    let warn: jasmine.Spy;
    beforeEach(() => {
        warn = spyOn(console, 'warn').and.callThrough();
    });
    afterEach(() => {
        const changeShipWarnings = warn.calls.allArgs()
            .map(args => args.map(String).join(' '))
            .filter(line => /change ship|change-ship|Change of ship|Change-ship/i.test(line));
        expect(changeShipWarnings).withContext('change-ship warnings').toEqual([]);
    });

    function courierMission(): ActiveMission {
        return {
            id: COURIER, acceptedDay: 0, acceptedAt: SYNTHETIC.planets.port,
            travelPlanet: SYNTHETIC.planets.moon, returnPlanet: SYNTHETIC.planets.port,
            cargoType: -1, cargoQty: 0, cargoLoaded: false, travelDone: false,
            deadlineDay: null,
        };
    }

    /** The pilot's state, on a skiff that is flying. */
    function pilotOn(ship: Entity) {
        ship.components.set(MovementStateComponent, {
            accelerating: 1, position: new Position(320, -180),
            rotation: new Angle(1.25), turnBack: false, turning: 0,
            velocity: new Vector(40, -12),
        });
        ship.components.set(ControlledByComponent, { peerId: PEER });
        ship.components.set(MultiplayerData, { owner: PEER });
        ship.components.set(CreditsComponent, { credits: CREDITS });
        ship.components.set(GameDateComponent, { day: 3, month: 4, year: 1177 });
        ship.components.set(MissionsComponent, new Map([[COURIER, courierMission()]]));
        ship.components.set(ControlBitsComponent,
            new Set<number>([BITS.musterOffered, BITS.courierAccepted]));
        ship.components.set(ActiveRanksComponent, new Set());
        ship.components.set(CargoComponent, new Map([['cargo:0', 6]]));
        ship.components.set(CombatRatingComponent, { kills: 3 });
        ship.components.set(OutfitsStateComponent, new Map([
            [BLASTER, { count: 1 }],
            [CAPACITOR, { count: 1 }],
        ]));
    }

    /**
     * A skiff pilot flying in Thessaly Reach, with the muster officer (the
     * përs whose LinkMission is the Muster Call) beside them.
     */
    async function flying(gameData?: GameDataAggregator) {
        gameData ??= await getSyntheticGameData();
        const systemId = SYNTHETIC.systems.thessaly;
        const world = await makeSystem(systemId, gameData, 'node', { npcs: false });
        const player = makeShip(await gameData.data.Ship.get(SKIFF));
        pilotOn(player);
        await completeEntity(world, player);
        world.entities.set('player', player);

        const pers = await gameData.data.Pers.get(SYNTHETIC.persons.muster);
        const officer = makeNpcShip(await gameData.data.Ship.get(pers.ship),
            pers.aiType, pers.govt, new Position(500, 0), new Angle(0),
            new Vector(0, 0));
        officer.components.set(PersComponent,
            { id: pers.id, name: pers.name, subtitle: pers.subtitle });
        officer.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(world, officer);
        world.entities.set('officer', officer);
        for (let i = 0; i < 3; i++) {
            world.step();
        }
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const offer = await buildShipMissionOffer(player, pers, 'hail',
            gameData, universe, { systemId, random: () => 0 });
        if (!offer) {
            throw new Error('the muster officer offered nothing');
        }
        return { gameData, universe, world, systemId, offer, pers };
    }

    function withStrings(offer: MissionOffer,
        strings: { onAccept?: string, onRefuse?: string }): MissionOffer {
        return { ...offer, data: { ...offer.data, ...strings } };
    }

    async function apply(world: World, input: SimulationInput) {
        const record: InputRecord = { peerId: PEER, tick: 1, inputs: [input] };
        await loadInputRecordsGameData(world, [record]);
        applyInputRecords(world, [record]);
    }

    async function expectedOutfits(gameData: GameDataAggregator,
        mode: ShipChangeMode) {
        const warden = await gameData.data.Ship.get(WARDEN);
        return new Map([...outfitsAfterShipChange(warden,
            new Map([[BLASTER, 1], [CAPACITOR, 1]]),
            id => gameData.data.Outfit.getCached(id), mode)]
            .map(([id, { count }]) => [id, count]));
    }

    function outfitCounts(entity: Entity) {
        return new Map([...entity.components.get(OutfitsStateComponent) ?? []]
            .map(([id, { count }]) => [id, count]));
    }

    /** What every in-flight change must keep: the pilot, where they were. */
    function expectPilotKept(world: World, before: Entity) {
        const after = world.entities.get('player')!;
        expect(after).withContext('the player is still at their uuid').toBeDefined();
        expect(after).not.toBe(before);
        expect(after.components.get(ShipComponent)?.id).toBe(WARDEN);
        const was = before.components.get(MovementStateComponent)!;
        const now = after.components.get(MovementStateComponent)!;
        expect(now.position.x).toBe(was.position.x);
        expect(now.position.y).toBe(was.position.y);
        expect(now.velocity.x).toBe(was.velocity.x);
        expect(now.velocity.y).toBe(was.velocity.y);
        expect(now.rotation.angle).toBe(was.rotation.angle);
        expect(after.components.get(ControlledByComponent))
            .toEqual({ peerId: PEER });
        expect(after.components.get(MultiplayerData)).toEqual({ owner: PEER });
        expect(after.components.get(CreditsComponent)?.credits).toBe(CREDITS);
        // The hold is carried as it is, as the landed path carries it.
        expect(after.components.get(CargoComponent)?.get('cargo:0')).toBe(6);
        expect(after.components.get(CombatRatingComponent)).toEqual({ kills: 3 });
        // Fully formed: the new class's data is derived on insertion.
        expect(after.components.get(ShipComponent)?.id).toBe(WARDEN);
        return after;
    }

    for (const [letter, mode] of [['C', 'keep'], ['E', 'keepAndGrantDefaults'],
        ['H', 'dropAndGrantDefaults']] as const) {
        it(`${letter}xxx in an ACCEPTED ship offer swaps the hull in the `
            + 'simulation, outfits as the landed path treats them', async () => {
            const { gameData, universe, world, systemId, offer } = await flying();
            const before = world.entities.get('player')!;
            const accept = await buildShipMissionAccept(before,
                withStrings(offer, { onAccept: `b${BITS.musterAnswered} ${letter}130` }),
                gameData, universe, { offeredBy: 'officer', systemId });
            expect(accept).not.toBeNull();
            expect(accept!.record.shipChange).toEqual({ shipId: WARDEN });
            await apply(world, { kind: 'acceptMission', accepted: accept!.record });

            const after = expectPilotKept(world, before);
            expect(outfitCounts(after)).toEqual(await expectedOutfits(gameData, mode));
            expect(after.components.get(MissionsComponent)?.has(MUSTER)).toBeTrue();
            expect(after.components.get(ControlBitsComponent)?.has(BITS.musterAnswered))
                .toBeTrue();
            // The hull steps on as a ship of its new class.
            world.step();
            expect(world.entities.get('player')!.components.get(ShipComponent)?.id)
                .toBe(WARDEN);
        });

        it(`${letter}xxx in a REFUSED ship offer swaps the hull the same way`,
            async () => {
                const { gameData, universe, world, systemId, offer } = await flying();
                const before = world.entities.get('player')!;
                const refusal = await buildShipMissionRefusal(before,
                    withStrings(offer, { onRefuse: `${letter}130 b${BITS.musterJoined}` }),
                    gameData, universe, { offeredBy: 'officer', systemId });
                expect(refusal).not.toBeNull();
                expect(refusal!.record.shipChange).toEqual({ shipId: WARDEN });
                await apply(world, { kind: 'refuseMission', refused: refusal!.record });

                const after = expectPilotKept(world, before);
                expect(outfitCounts(after))
                    .toEqual(await expectedOutfits(gameData, mode));
                // A refusal adds no mission; the courier run is untouched.
                expect(after.components.get(MissionsComponent)?.has(MUSTER)).toBeFalse();
                expect(after.components.get(MissionsComponent)?.has(COURIER)).toBeTrue();
                expect(after.components.get(ControlBitsComponent)?.has(BITS.musterJoined))
                    .toBeTrue();
            });
    }

    it('the parsed Muster Call: its Refuse button joins, moves the pilot to '
        + 'Ossory Shoal in a Heron Warden and starts the follow-up', async () => {
        const { gameData, universe, world, systemId, offer } = await flying();
        // The data as parsed: swapped buttons, the OnRefuse in arpia:1112's
        // shape, `s` in lower case.
        expect(offer.data.refuseButton).toBe("I'll take her gladly.");
        expect(offer.data.acceptButton).toBe("My skiff's fine.");
        expect(offer.data.onRefuse).toContain(`s${REPORT.split(':')[1]}`);
        expect(offer.data.onRefuse).toContain(`M${SYNTHETIC.systems.ossory.split(':')[1]}`);

        const before = world.entities.get('player')!;
        const refusal = await buildShipMissionRefusal(before, offer, gameData,
            universe, { offeredBy: 'officer', systemId });
        expect(refusal).not.toBeNull();
        const record = refusal!.record;
        expect(record.shipChange).toEqual({ shipId: WARDEN });
        expect(record.moveToSystem)
            .toEqual({ systemId: SYNTHETIC.systems.ossory, keepCoordinates: false });
        expect(record.missionsEnded).toEqual([COURIER]);
        expect(record.missionsStarted?.map(([id]) => id)).toEqual([REPORT]);
        expect(record.bitsSet).toEqual(jasmine.arrayWithExactContents(
            [BITS.musterAnswered, BITS.musterJoined]));
        // `A128` aborted the courier run, whose own OnAbort clears b100.
        expect(record.bitsCleared).toEqual(jasmine.arrayWithExactContents(
            [BITS.musterOffered, BITS.courierAccepted]));

        const moves: MissionSystemMove[] = [];
        world.events.get(MissionSystemMoveEvent).subscribe(
            ({ data }) => moves.push(data));
        await apply(world, { kind: 'refuseMission', refused: record });
        world.step();

        // The ship left this system, in its new hull, for Ossory Shoal.
        expect(world.entities.has('player')).toBeFalse();
        expect(moves.length).toBe(1);
        const [move] = moves;
        expect(move.uuid).toBe('player');
        expect(move.systemId).toBe(SYNTHETIC.systems.ossory);
        expect(move.keepCoordinates).toBeFalse();
        const carried = move.entity;
        expect(carried.components.get(ShipComponent)?.id).toBe(WARDEN);
        const missions = carried.components.get(MissionsComponent)!;
        expect(missions.has(REPORT)).toBeTrue();
        expect(missions.has(COURIER)).toBeFalse();
        expect(carried.components.get(ControlledByComponent)).toEqual({ peerId: PEER });
        // Targets name things in the system left behind.
        expect(carried.components.has(TargetComponent)).toBeFalse();
        // The client follows it there (client/transit.ts
        // followMissionSystemMove); Mxxx puts the ship on top of the
        // system's first stellar, at rest, heading kept.
        await placeOnFirstStellar(carried, move.systemId, gameData);
        const ossory = await gameData.data.System.get(SYNTHETIC.systems.ossory);
        const first = await gameData.data.Planet.get(ossory.planets[0]);
        const placed = carried.components.get(MovementStateComponent)!;
        expect([placed.position.x, placed.position.y]).toEqual(first.position);
        expect([placed.velocity.x, placed.velocity.y]).toEqual([0, 0]);
        expect(placed.rotation.angle).toBe(1.25);
        // (The `T7102` retitle is the one operator here the record does not
        // carry: there is no persisted ship name to write. ncb.ts reports
        // it unimplemented, once per session.)
    });

    it('the Muster Call\'s Accept button ("My skiff\'s fine.") only records '
        + 'the answer', async () => {
        const { gameData, universe, world, systemId, offer } = await flying();
        const before = world.entities.get('player')!;
        const accept = await buildShipMissionAccept(before, offer, gameData,
            universe, { offeredBy: 'officer', systemId });
        expect(accept!.record.shipChange).toBeUndefined();
        expect(accept!.record.moveToSystem).toBeUndefined();
        await apply(world, { kind: 'acceptMission', accepted: accept!.record });
        world.step();
        const after = world.entities.get('player')!;
        expect(after).toBe(before);
        expect(after.components.get(ShipComponent)?.id).toBe(SKIFF);
        expect(after.components.get(MissionsComponent)?.has(COURIER)).toBeFalse();
    });

    it('a refusal whose OnRefuse is empty sends nothing (every stock '
        + 'AvailLoc 2 mission)', async () => {
        const { gameData, universe, world, systemId, offer } = await flying();
        expect(await buildShipMissionRefusal(world.entities.get('player')!,
            withStrings(offer, { onRefuse: '' }), gameData, universe,
            { systemId })).toBeNull();
    });

    describe('on the entity the date advance holds (a jump, a landing)', () => {
        /**
         * A fresh aggregator, so the spec can rewrite a mission's data
         * without touching the process-wide synthetic cache.
         */
        async function heldSkiff() {
            const gameData = makeSyntheticGameData();
            const universe = new MissionUniverse(gameData);
            await universe.load();
            const entity = makeShip(await gameData.data.Ship.get(SKIFF));
            pilotOn(entity);
            entity.components.set(PlayerShipSelector, undefined);
            return { gameData, universe, entity };
        }

        it('an in-flight OnFailure\'s Hxxx swaps the held hull in place',
            async () => {
                const { gameData, universe, entity } = await heldSkiff();
                const courier = universe.getMission(COURIER)!;
                (courier as { onFailure: string }).onFailure =
                    `!b${BITS.courierAccepted} H130`;
                const missions = entity.components.get(MissionsComponent)!;
                missions.set(COURIER, { ...courierMission(), failed: true });
                const movement = entity.components.get(MovementStateComponent);

                await advanceEntityDate(entity, 2, universe, gameData);

                expect(entity.components.get(ShipComponent)?.id).toBe(WARDEN);
                expect(outfitCounts(entity)).toEqual(
                    await expectedOutfits(gameData, 'dropAndGrantDefaults'));
                expect(entity.components.get(MissionsComponent)?.has(COURIER))
                    .toBeFalse();
                expect(entity.components.get(ControlBitsComponent)
                    ?.has(BITS.courierAccepted)).toBeFalse();
                // The pilot rides along: the arrival kinematics, the identity.
                expect(entity.components.get(MovementStateComponent)).toBe(movement);
                expect(entity.components.get(ControlledByComponent))
                    .toEqual({ peerId: PEER });
                expect(entity.components.has(PlayerShipSelector)).toBeTrue();
                expect(entity.components.get(CreditsComponent)?.credits).toBe(CREDITS);
            });

        it('a crön\'s Exxx swaps the held hull in place', async () => {
            const { gameData, universe, entity } = await heldSkiff();
            universe.crons.push({
                ...getDefaultCronData(), id: 'nova:900', name: 'Muster cron',
                onStart: 'E130', duration: 1,
            });
            await advanceEntityDate(entity, 1, universe, gameData);
            expect(entity.components.get(ShipComponent)?.id).toBe(WARDEN);
            expect(outfitCounts(entity)).toEqual(
                await expectedOutfits(gameData, 'keepAndGrantDefaults'));
            expect(entity.components.get(GameDateComponent))
                .toEqual({ day: 4, month: 4, year: 1177 });
        });
    });

    /**
     * Plug-in arpia's mïsn 1112 "Gather up the Team;a", the case that
     * motivated this: AvailLoc 2 (offered when boarding the Fallen Angel),
     * buttons deliberately swapped, OnRefuse
     * `A1111 !b20196 M401 H445 T25091 s1113 b20200 b20205`. Real plug-in
     * data, so it pends where arpia is not installed.
     */
    it('arpia:1112\'s OnRefuse ends with the pilot in hull 445, bound for '
        + 'system 401, with mission 1113 active', async () => {
        const gameData = await getPluginGameData('arpia');
        if (!gameData) {
            pending('the arpia plug-in is not installed');
            return;
        }
        const universe = new MissionUniverse(gameData);
        await universe.load();
        const mission = universe.getMission('arpia:1112');
        expect(mission).withContext('arpia:1112 is loaded').toBeDefined();
        expect(mission!.availLoc).toBe(2);
        expect(mission!.onRefuse)
            .toBe('A1111 !b20196 M401 H445 T25091 s1113 b20200 b20205');
        const ids = await gameData.ids;
        const resolve = (n: number, list: readonly string[]) =>
            list.includes(`nova:${n}`) ? `nova:${n}` : `arpia:${n}`;
        const hull = resolve(445, ids.Ship);
        const system = resolve(401, ids.System);
        const next = resolve(1113, ids.Mission);
        const previous = resolve(1111, ids.Mission);
        expect(ids.Ship).toContain(hull);
        expect(ids.Mission).toContain(next);

        const world = await makeSystem([...ids.System].sort()[0]!, gameData,
            'node', { npcs: false });
        const player = makeShip(await gameData.data.Ship.get(
            [...ids.Ship].sort()[0]!));
        pilotOn(player);
        player.components.set(MissionsComponent, new Map([[previous, {
            ...courierMission(), id: previous,
        }]]));
        await completeEntity(world, player);
        world.entities.set('player', player);
        world.step();

        const session = await MissionSession.create(player, gameData,
            universe, '<in-flight>');
        const offer = makeMissionOffer(mission!, session.machinery.offerContext());
        expect(offer).toBeDefined();
        const refusal = await buildShipMissionRefusal(player, offer!,
            gameData, universe, {});
        expect(refusal).not.toBeNull();
        expect(refusal!.record.shipChange).toEqual({ shipId: hull });
        expect(refusal!.record.moveToSystem)
            .toEqual({ systemId: system, keepCoordinates: false });

        const moves: MissionSystemMove[] = [];
        world.events.get(MissionSystemMoveEvent).subscribe(
            ({ data }) => moves.push(data));
        await apply(world, { kind: 'refuseMission', refused: refusal!.record });
        world.step();
        expect(moves.length).toBe(1);
        expect(moves[0].systemId).toBe(system);
        const carried = moves[0].entity;
        expect(carried.components.get(ShipComponent)?.id).toBe(hull);
        const missions = carried.components.get(MissionsComponent)!;
        expect(missions.has(next)).toBeTrue();
        expect(missions.has(previous)).toBeFalse();
        // ... and the client puts it on system 401's first stellar.
        await placeOnFirstStellar(carried, system, gameData);
        const destination = await gameData.data.System.get(system);
        const at = carried.components.get(MovementStateComponent)!.position;
        const expected = destination.planets[0]
            ? (await gameData.data.Planet.get(destination.planets[0])).position
            : [0, 0];
        expect([at.x, at.y]).toEqual(expected);
    }, 120_000);
});
