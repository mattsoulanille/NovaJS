import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { restoreWorld, snapshotWorld } from 'nova_ecs/plugins/snapshot_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import {
    boardingBlockedMessage, cargoRetrievedMessage,
} from '../../display/status_bar_content.js';
import {
    getIntegrationGameData, getSyntheticGameData,
} from '../../communication/simulation_test_fixture.js';
import { novaDataInstalled, requireNovaData } from '../../test_support/nova_data_gate.js';
import { deriveEntityComponents, GovtComponent } from '../core/index.js';
import { missionCargoName } from '../missions/index.js';
import { makeSystem } from '../make_system.js';
import {
    NpcComponent, SystemHoldComponent, waitingForRescue,
} from '../npc/index.js';
import {
    ActiveMission, CreditsComponent, GOAL_BOARD, GOAL_RESCUE,
    missionCargoKey, MissionsComponent, MissionShipComponent, ShipControlEvent,
    ShipControlStateComponent, ShipObjective,
} from '../player/index.js';
import { LegalRecordsComponent } from '../reputation/index.js';
import {
    ArmorComponent, BoardedComponent, BoardingComponent, CargoComponent,
    DisabledComponent, makeShip, ShieldComponent, ShipPhysicsComponent,
    TargetComponent,
} from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { BoardingBlockedEvent } from './boarding_plugin.js';
import { MissionCargoRetrievedEvent } from './rescue_board.js';

/**
 * ============================================================================
 * Boarding a live mission's RESCUE ship (mïsn ShipGoal 5)
 * ============================================================================
 *
 * Reference "Boarding a rescue ship: stock \"Rescue Raczak\" (nova:394),
 * wave 13": with PickupMode-2 cargo to take, the board (past the ordinary
 * gate) loads it with "You retrieved Admiral Raczak from this ship." — no
 * dialog, the hulk stays Disabled — and every later press is "You can't
 * board this ship."; the mission then completes at the cargo's drop-off.
 * Without cargo ("H1 / rescue leftovers, wave 21", finding 5), the first
 * press past the gate is a SILENT board that spends the hull's one board,
 * and every later press is refused; the mission never completes.
 */
describe('boarding a rescue ship', () => {
    const OWNER = 'owner';
    const RIVAL = 'rival';
    const HULK = 'hulk';
    const MISSION = 'nova:9394';
    /** Any cargo type: the spec only carries it through to the event. */
    const CARGO_TYPE = 27;

    function objective(goal = GOAL_RESCUE): ShipObjective {
        return {
            goal, systemId: null, shipStart: 0, behavior: -1,
            dudeId: 'nova:258', total: 1, satisfied: 0, complete: false,
            failed: false, shipDonePending: false, live: new Map(),
        };
    }

    function rescueMission(overrides: Partial<ActiveMission> = {}):
        ActiveMission {
        return {
            id: MISSION, acceptedDay: 0, acceptedAt: SYNTHETIC.planets.port,
            travelPlanet: null, returnPlanet: SYNTHETIC.planets.port,
            cargoType: CARGO_TYPE, cargoQty: 1, cargoLoaded: false,
            travelDone: false, deadlineDay: null, pickupOnBoard: true,
            shipObjective: objective(),
            ...overrides,
        };
    }

    function placeShip(ship: Entity, x: number, rotation = 0) {
        ship.components.set(MovementStateComponent, {
            position: new Position(x, 0), velocity: new Vector(0, 0),
            rotation: new Angle(rotation), turning: 0, turnBack: false,
            accelerating: 0,
        });
    }

    /**
     * The owner (and a rival on the far side) alongside the mission's
     * disabled rescue hulk in Thessaly Reach, two Wren Skiffs' worth of
     * board square apart, everyone aligned.
     */
    async function rescueWorld(mission: ActiveMission = rescueMission(),
        { untethered = false, waiting = false } = {}) {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            'worker', { npcs: false });
        const skiff = (await gameData.data.Ship.get(SYNTHETIC.ships.skiff))!;

        const owner = makeShip(skiff);
        placeShip(owner, 0);
        owner.components.set(CreditsComponent, { credits: 0 });
        owner.components.set(LegalRecordsComponent, new Map());
        owner.components.set(MissionsComponent, new Map([[MISSION, mission]]));
        const rival = makeShip(skiff);
        placeShip(rival, 10);
        rival.components.set(CreditsComponent, { credits: 0 });
        rival.components.set(LegalRecordsComponent, new Map());

        const hulk = makeShip(skiff);
        placeShip(hulk, 5);
        hulk.components.set(GovtComponent, { id: SYNTHETIC.govts.meridian });
        hulk.components.set(MissionShipComponent, {
            mission: MISSION, owner: OWNER,
            ...(untethered ? { untethered: true } : {}),
        });
        hulk.components.set(SystemHoldComponent, { reason: 'rescue' });
        if (waiting) {
            // A ShipStart-2 rescue ship: live, with a brain to decide
            // nothing with until it is released.
            hulk.components.set(NpcComponent, { aiType: 3 });
        }

        for (const [uuid, ship] of [[OWNER, owner], [RIVAL, rival],
            [HULK, hulk]] as const) {
            await completeEntity(world, ship);
            world.entities.set(uuid, ship);
        }
        world.step();
        owner.components.get(TargetComponent)!.target = HULK;
        rival.components.get(TargetComponent)!.target = HULK;
        // A hulk, as mission_ship_spawn makes a rescue target (unless it
        // is WAITING: ShipStart 2).
        if (!waiting) {
            hulk.components.get(ArmorComponent)!.current = 1;
            hulk.components.get(ShieldComponent)!.current = 0;
            hulk.components.set(DisabledComponent,
                { repairAt: null, hulk: true });
        }
        world.step();

        const blocked: string[] = [];
        world.addSystem(new System({
            name: 'RecordBlocked',
            events: [BoardingBlockedEvent],
            args: [BoardingBlockedEvent] as const,
            step: ({ reason }) => {
                blocked.push(boardingBlockedMessage(reason));
            },
        }));
        const retrieved: number[] = [];
        world.addSystem(new System({
            name: 'RecordRetrieved',
            events: [MissionCargoRetrievedEvent],
            args: [MissionCargoRetrievedEvent] as const,
            step: ({ cargoType }) => { retrieved.push(cargoType); },
        }));
        return { world, owner, rival, hulk, blocked, retrieved };
    }

    function press(world: World, uuid: string) {
        world.entities.get(uuid)!.components.set(ShipControlStateComponent,
            new Map([['board', 'start']]) as never);
        world.emit(ShipControlEvent, undefined, [uuid]);
        world.step();
    }

    function active(owner: Entity) {
        return owner.components.get(MissionsComponent)!.get(MISSION)!;
    }

    it('retrieves the PickupMode-2 cargo and nothing else; the hulk stays '
        + 'disabled', async () => {
            const { world, owner, hulk, blocked, retrieved } =
                await rescueWorld();
            press(world, OWNER);

            expect(retrieved).toEqual([CARGO_TYPE]);
            expect(blocked).toEqual([]);
            expect(owner.components.get(CargoComponent)!
                .get(missionCargoKey(MISSION))).toBe(1);
            expect(active(owner).cargoLoaded).toBeTrue();
            // No plunder session, no plunder record, no capture.
            expect(owner.components.has(BoardingComponent)).toBeFalse();
            expect(hulk.components.has(BoardedComponent)).toBeFalse();
            // The rescue goal is credited, so the drop-off completes it.
            const goal = active(owner).shipObjective!;
            expect(goal.satisfied).toBe(1);
            expect(goal.complete).toBeTrue();

            for (let i = 0; i < 60; i++) {
                world.step();
            }
            expect(world.entities.has(HULK)).toBeTrue();
            expect(hulk.components.get(DisabledComponent)?.hulk).toBeTrue();
            expect(hulk.components.get(SystemHoldComponent)?.reason)
                .toBe('rescue');
        });

        it('a WAITING (ShipStart 2) rescue ship sits still, is boarded where '
            + 'it sits, and flies off once the cargo is out (reference '
            + 'Contraband / rescue / A14, wave 19, finding 4)', async () => {
                const { world, owner, hulk, blocked, retrieved } =
                    await rescueWorld(rescueMission(), { waiting: true });
                expect(waitingForRescue(hulk)).toBeTrue();
                const at = () => hulk.components
                    .get(MovementStateComponent)!.position;
                const before = at();
                for (let i = 0; i < 120; i++) {
                    world.step();
                }
                // Waiting: still where it was, deciding nothing.
                expect(at().subtract(before).length).toBeLessThan(1);
                expect(hulk.components.get(NpcComponent)!.mode)
                    .toBeUndefined();
                expect(hulk.components.get(ShieldComponent)!.percent)
                    .toBe(100);

                press(world, OWNER);
                expect(retrieved).toEqual([CARGO_TYPE]);
                expect(blocked).toEqual([]);
                expect(active(owner).cargoLoaded).toBeTrue();
                expect(active(owner).shipObjective!.complete).toBeTrue();
                // Released: no hold, never disabled, on its way out.
                expect(hulk.components.has(SystemHoldComponent)).toBeFalse();
                expect(hulk.components.has(DisabledComponent)).toBeFalse();
                expect(hulk.components.get(NpcComponent)!.mode)
                    .toBe('depart');
                for (let i = 0; i < 90; i++) {
                    world.step();
                }
                expect(!world.entities.has(HULK)
                    || at().subtract(before).length > 20).toBeTrue();
            });

        it('a waiting rescue ship refuses a rival, and nobody plunders it',
            async () => {
                const { world, hulk, blocked, retrieved } = await rescueWorld(
                    rescueMission(), { waiting: true });
                press(world, RIVAL);
                expect(retrieved).toEqual([]);
                expect(blocked).toEqual(["You can't board this ship."]);
                expect(hulk.components.has(BoardedComponent)).toBeFalse();
                expect(waitingForRescue(hulk)).toBeTrue();
            });

        it('refuses every later press with the catch-all line', async () => {
            const { world, owner, blocked, retrieved } = await rescueWorld();
            press(world, OWNER);
            press(world, OWNER);
            press(world, OWNER);
            expect(retrieved.length).toBe(1);
            expect(blocked).toEqual([
                "You can't board this ship.", "You can't board this ship."]);
            expect(owner.components.get(CargoComponent)!
                .get(missionCargoKey(MISSION))).toBe(1);
        });

    it('keeps the ordinary gate in front: a misaligned press is silent',
        async () => {
            const { world, owner, blocked, retrieved } = await rescueWorld();
            placeShip(owner, 0, Math.PI / 2);
            press(world, OWNER);
            expect(blocked).toEqual(['']);
            expect(retrieved).toEqual([]);
            expect(active(owner).cargoLoaded).toBeFalse();
        });

    it('without cargo to retrieve, the first press is a SILENT board and '
        + 'every later one is refused; the mission never completes '
        + '(reference H1 / rescue leftovers, wave 21, finding 5)',
        async () => {
            const { world, owner, hulk, blocked, retrieved } =
                await rescueWorld(rescueMission({
                    cargoType: -1, cargoQty: 0, pickupOnBoard: false,
                }));
            const goal = () => active(owner).shipObjective!;
            expect(goal().live.get(HULK)?.boarded).toBeFalsy();
            press(world, OWNER);
            // Nothing on the status line, nothing retrieved, no session:
            // the one board is spent.
            expect(blocked).toEqual([]);
            expect(retrieved).toEqual([]);
            expect(owner.components.has(BoardingComponent)).toBeFalse();
            expect(hulk.components.has(BoardedComponent)).toBeFalse();
            expect(goal().live.get(HULK)?.boarded).toBeTrue();
            press(world, OWNER);
            press(world, OWNER);
            expect(blocked).toEqual([
                "You can't board this ship.", "You can't board this ship."]);
            expect(retrieved).toEqual([]);
            // Not credited: the hulk stays a disabled hulk and the
            // mission stays active and incomplete.
            expect(goal().satisfied).toBe(0);
            expect(goal().complete).toBeFalse();
            for (let i = 0; i < 60; i++) {
                world.step();
            }
            expect(hulk.components.get(DisabledComponent)?.hulk).toBeTrue();
            expect(hulk.components.get(SystemHoldComponent)?.reason)
                .toBe('rescue');
            expect(owner.components.get(MissionsComponent)!.has(MISSION))
                .toBeTrue();
        });

    it('without cargo, a misaligned press stays silent and does NOT spend '
        + 'the board (the gate first, wave 21\'s control press)',
        async () => {
            const { world, owner, blocked } = await rescueWorld(
                rescueMission({
                    cargoType: -1, cargoQty: 0, pickupOnBoard: false,
                }));
            placeShip(owner, 0, Math.PI / 2);
            press(world, OWNER);
            expect(blocked).toEqual(['']);
            expect(active(owner).shipObjective!.live.get(HULK)?.boarded)
                .toBeFalsy();
            placeShip(owner, 0);
            press(world, OWNER);
            expect(blocked).toEqual(['']);
            press(world, OWNER);
            expect(blocked).toEqual(['', "You can't board this ship."]);
        });

    it('without cargo, a rival is refused at once and spends nothing',
        async () => {
            const { world, owner, blocked } = await rescueWorld(
                rescueMission({
                    cargoType: -1, cargoQty: 0, pickupOnBoard: false,
                }));
            press(world, RIVAL);
            expect(blocked).toEqual(["You can't board this ship."]);
            expect(active(owner).shipObjective!.live.get(HULK)?.boarded)
                .toBeFalsy();
        });

    it('refuses anybody but the owner', async () => {
        const { world, owner, rival, blocked, retrieved } =
            await rescueWorld();
        press(world, RIVAL);
        expect(blocked).toEqual(["You can't board this ship."]);
        expect(retrieved).toEqual([]);
        expect(rival.components.has(BoardingComponent)).toBeFalse();
        expect(active(owner).cargoLoaded).toBeFalse();
    });

    it('refuses while the cargo does not fit, and retrieves once it does',
        async () => {
            const { world, owner, blocked, retrieved } = await rescueWorld();
            const free = owner.components.get(ShipPhysicsComponent)!.freeCargo;
            owner.components.get(CargoComponent)!.set('cargo:0', free);
            press(world, OWNER);
            expect(blocked).toEqual(["You can't board this ship."]);
            owner.components.get(CargoComponent)!.set('cargo:0', free - 1);
            press(world, OWNER);
            expect(retrieved).toEqual([CARGO_TYPE]);
        });

    it('leaves the deferred auto-abort rescue on the plunder path',
        async () => {
            // The Refuel Traders (përs replacements, mïsn Flags 0x0001):
            // untested on the original, so boarding still ends them.
            const { world, owner, hulk, retrieved } = await rescueWorld(
                rescueMission({
                    cargoType: -1, cargoQty: 0, pickupOnBoard: false,
                    autoAbortOnBoard: true,
                }));
            press(world, OWNER);
            expect(retrieved).toEqual([]);
            expect(owner.components.get(BoardingComponent)?.target)
                .toBe(HULK);
            expect(hulk.components.get(BoardedComponent)?.plundered)
                .toBeTrue();
        });

    it('leaves every other goal on the ordinary rules', async () => {
        const { world, owner, retrieved } = await rescueWorld(
            rescueMission({ shipObjective: objective(GOAL_BOARD) }));
        press(world, OWNER);
        expect(retrieved).toEqual([]);
        expect(owner.components.get(BoardingComponent)?.target).toBe(HULK);
    });

    it('treats a ship whose mission is over (untethered) as an ordinary '
        + 'hulk', async () => {
            const { world, owner, retrieved } = await rescueWorld(
                rescueMission(), { untethered: true });
            press(world, OWNER);
            expect(retrieved).toEqual([]);
            expect(owner.components.get(BoardingComponent)?.target)
                .toBe(HULK);
        });

    it('replays the retrieval identically after a rollback', async () => {
        const { world, owner } = await rescueWorld();
        const before = snapshotWorld(world);
        const run = () => {
            press(world, OWNER);
            const hashes = [hashWorld(world).hash];
            for (let i = 0; i < 30; i++) {
                world.step();
                hashes.push(hashWorld(world).hash);
            }
            return hashes;
        };
        const first = run();
        expect(active(owner).cargoLoaded).toBeTrue();
        restoreWorld(world, before, deriveEntityComponents);
        expect(world.entities.get(OWNER)!.components.get(MissionsComponent)!
            .get(MISSION)!.cargoLoaded).toBeFalse();
        expect(run()).toEqual(first);
    });

    describe('the status line', () => {
        it('drops "the" and the asterisk for a quantityless name', () => {
            expect(cargoRetrievedMessage(missionCargoName(0,
                ['*Admiral Raczak'], ['*Admiral Raczak'])))
                .toBe('You retrieved Admiral Raczak from this ship.');
        });

        it('says "the" otherwise', () => {
            expect(cargoRetrievedMessage(
                missionCargoName(0, ['Sample'], ['sample'])))
                .toBe('You retrieved the sample from this ship.');
        });

        it('uses the running-text name, the STR# 4000 one without it', () => {
            expect(cargoRetrievedMessage(
                missionCargoName(0, ['Wild Geese'], [])))
                .toBe('You retrieved the Wild Geese from this ship.');
        });

        describe('against the stock strings', () => {
            beforeEach(requireNovaData);

            it('composes the reference line from STR# 2002 and 4000',
                async () => {
                    if (!novaDataInstalled()) {
                        return;
                    }
                    const gameData = await getIntegrationGameData();
                    const misc = (await gameData.data.StringTable
                        .get('nova:2002')).strings;
                    // 105 "You retrieved ", 106 "the", 107 "from this
                    // ship." — the pieces cargoRetrievedMessage writes.
                    expect(misc[105]).toBe('You retrieved ');
                    expect(misc[106]).toBe('the');
                    expect(misc[107]).toBe('from this ship.');
                    const start = (await gameData.data.PlayerStart.get(
                        (await gameData.ids).PlayerStart[0]!));
                    const raczak = (await gameData.data.Mission
                        .get('nova:394'));
                    expect(raczak.cargoType).toBe(27);
                    expect(start.cargoNames[raczak.cargoType])
                        .toBe('*Admiral Raczak');
                    expect(cargoRetrievedMessage(missionCargoName(
                        raczak.cargoType, start.cargoNames,
                        start.cargoNamesLower)))
                        .toBe('You retrieved Admiral Raczak from this ship.');
                    // 31 "Sample" / "sample": not quantityless.
                    expect(cargoRetrievedMessage(missionCargoName(31,
                        start.cargoNames, start.cargoNamesLower))).toBe(
                        `${misc[105]}${misc[106]} sample ${misc[107]}`);
                });
        });
    });
});
