import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { boardingBlockedMessage } from '../../display/status_bar_content.js';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { GovtComponent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { SystemHoldComponent } from '../npc/index.js';
import {
    ActiveMission, CreditsComponent, GOAL_BOARD, GOAL_CHASE_OFF,
    GOAL_DESTROY, GOAL_DISABLE, GOAL_ESCORT, GOAL_NONE, GOAL_OBSERVE,
    MissionsComponent, MissionShipComponent, ShipControlEvent,
    ShipControlStateComponent, ShipObjective,
} from '../player/index.js';
import { LegalRecordsComponent } from '../reputation/index.js';
import {
    ArmorComponent, BoardedComponent, BoardingComponent, CargoComponent,
    DisabledComponent,
    makeShip, ShieldComponent, TargetComponent,
} from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { BoardingBlockedEvent } from './boarding_plugin.js';
import { MissionCargoRetrievedEvent } from './rescue_board.js';

/**
 * ============================================================================
 * Boarding a LIVE mission's special ship, goal by goal
 * ============================================================================
 *
 * Reference "Boarding live mission ships, wave 61" (Matthew boarded a
 * disabled RAGE Gunboat of "Destroy Bureau Cell", ShipGoal 0 / ShipBehav
 * 0, and should not have been able to): the original never opens the
 * plunder dialog on the special ship of a mission that is running and has
 * not failed. Its first board past the range / speed / alignment gate is
 * SILENT and spends the hull's one board (no message, nothing credited),
 * and every later press, at any distance and heading, is "You can't board
 * this ship." — measured on goals 0 and 1, and read off the original's
 * HandlePlayerBoardAttempt for every goal. A FAILED mission's ship is an
 * ordinary hulk (wave 11's disabled escort ally opened the plunder dialog);
 * so is an aborted mission's ship that was never boarded, while one the
 * player had already boarded still refuses (wave 61).
 *
 * The PickupMode-2 retrieval and the deferred auto-abort rescue are
 * rescue_board_test's.
 */
describe('boarding a live mission ship', () => {
    const OWNER = 'owner';
    const RIVAL = 'rival';
    const HULK = 'hulk';
    const MISSION = 'nova:9878';
    const REFUSED = "You can't board this ship.";

    function objective(goal: number): ShipObjective {
        return {
            goal, systemId: null, shipStart: 0, behavior: 0,
            dudeId: 'nova:273', total: 1, satisfied: 0, complete: false,
            failed: false, shipDonePending: false, live: new Map(),
        };
    }

    function mission(goal: number, overrides: Partial<ActiveMission> = {}):
        ActiveMission {
        return {
            id: MISSION, acceptedDay: 0, acceptedAt: SYNTHETIC.planets.port,
            travelPlanet: null, returnPlanet: SYNTHETIC.planets.port,
            cargoType: -1, cargoQty: 0, cargoLoaded: false,
            travelDone: false, deadlineDay: null,
            shipObjective: objective(goal),
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

    /** The owner (and a rival) alongside the mission's disabled special
     * ship, a board square apart, everyone aligned. */
    async function missionWorld(active: ActiveMission,
        { untethered = false } = {}) {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            'worker', { npcs: false });
        const skiff = (await gameData.data.Ship.get(SYNTHETIC.ships.skiff))!;

        const owner = makeShip(skiff);
        placeShip(owner, 0);
        owner.components.set(CreditsComponent, { credits: 0 });
        owner.components.set(LegalRecordsComponent, new Map());
        owner.components.set(MissionsComponent, new Map([[MISSION, active]]));
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
        hulk.components.set(SystemHoldComponent, { reason: 'missionGoal' });

        for (const [uuid, ship] of [[OWNER, owner], [RIVAL, rival],
            [HULK, hulk]] as const) {
            await completeEntity(world, ship);
            world.entities.set(uuid, ship);
        }
        world.step();
        owner.components.get(TargetComponent)!.target = HULK;
        rival.components.get(TargetComponent)!.target = HULK;
        // Disabled (the player's guns did it), not destroyed.
        hulk.components.get(ArmorComponent)!.current = 1;
        hulk.components.get(ShieldComponent)!.current = 0;
        hulk.components.set(DisabledComponent, { repairAt: null, hulk: true });
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
        return { world, owner, rival, hulk, blocked };
    }

    function press(world: World, uuid: string) {
        world.entities.get(uuid)!.components.set(ShipControlStateComponent,
            new Map([['board', 'start']]) as never);
        world.emit(ShipControlEvent, undefined, [uuid]);
        world.step();
    }

    function goal(owner: Entity) {
        return owner.components.get(MissionsComponent)!.get(MISSION)!
            .shipObjective!;
    }

    for (const [name, code] of [
        ['none (-1)', GOAL_NONE], ['destroy (0)', GOAL_DESTROY],
        ['disable (1)', GOAL_DISABLE], ['board (2)', GOAL_BOARD],
        ['observe (4)', GOAL_OBSERVE], ['chase off (6)', GOAL_CHASE_OFF],
    ] as const) {
        it(`goal ${name}: the first board is silent and spends it, with no `
            + 'plunder session; every later press is refused at any '
            + 'distance and heading', async () => {
                const { world, owner, hulk, blocked } =
                    await missionWorld(mission(code));
                const before = { ...goal(owner), live: undefined };
                press(world, OWNER);
                expect(blocked).toEqual([]);
                expect(owner.components.has(BoardingComponent)).toBeFalse();
                expect(hulk.components.get(BoardedComponent))
                    .toEqual({ boarder: OWNER, plundered: true });
                expect(goal(owner).live.get(HULK)?.boarded).toBeTrue();
                // Nothing credited (a board goal without PickupMode-2
                // cargo can never be completed by boarding).
                expect(goal(owner).satisfied).toBe(before.satisfied);
                expect(goal(owner).complete).toBe(before.complete);

                press(world, OWNER);
                // Misaligned and far: the refusal comes before the gate.
                placeShip(owner, -400, Math.PI / 2);
                press(world, OWNER);
                expect(blocked).toEqual([REFUSED, REFUSED]);
                expect(owner.components.has(BoardingComponent)).toBeFalse();
                expect(hulk.components.has(DisabledComponent)).toBeTrue();
            });
    }

    it('completes a board goal whose PickupMode-2 cargo is 0 tons (stock '
        + 'mïsn 710 "Set and Launch Trap": the original\'s pickup succeeds '
        + 'outright for a quantity of 0)', async () => {
            const { world, owner, hulk, blocked } = await missionWorld(
                mission(GOAL_BOARD, {
                    cargoType: 16, cargoQty: 0, pickupOnBoard: true,
                }));
            const retrieved: number[] = [];
            world.addSystem(new System({
                name: 'RecordRetrieved',
                events: [MissionCargoRetrievedEvent],
                args: [MissionCargoRetrievedEvent] as const,
                step: ({ cargoType }) => { retrieved.push(cargoType); },
            }));
            press(world, OWNER);
            expect(blocked).toEqual([]);
            expect(retrieved).toEqual([16]);
            expect(owner.components.has(BoardingComponent)).toBeFalse();
            expect(hulk.components.has(BoardedComponent)).toBeFalse();
            expect(goal(owner).complete).toBeTrue();
            expect([...owner.components.get(CargoComponent)!.keys()])
                .toEqual([]);
            press(world, OWNER);
            expect(blocked).toEqual([REFUSED]);
        });

    it('keeps the gate in front of the unspent board: a misaligned press '
        + 'is silent and spends nothing', async () => {
            const { world, owner, hulk, blocked } =
                await missionWorld(mission(GOAL_DESTROY));
            placeShip(owner, 0, Math.PI / 2);
            press(world, OWNER);
            expect(blocked).toEqual(['']);
            expect(goal(owner).live.get(HULK)?.boarded).toBeFalsy();
            expect(hulk.components.has(BoardedComponent)).toBeFalse();
        });

    it('refuses anybody but the owner', async () => {
        const { world, rival, hulk, blocked } =
            await missionWorld(mission(GOAL_DESTROY));
        press(world, RIVAL);
        expect(blocked).toEqual([REFUSED]);
        expect(rival.components.has(BoardingComponent)).toBeFalse();
        expect(hulk.components.has(BoardedComponent)).toBeFalse();
    });

    it('plunders the ship of a FAILED mission: the escort ally the player '
        + 'disabled (reference "Reviving a disabled ally, wave 11")',
        async () => {
            const { world, owner } = await missionWorld(mission(GOAL_ESCORT));
            // The disable failed the escort goal.
            expect(goal(owner).failed).toBeTrue();
            press(world, OWNER);
            expect(owner.components.get(BoardingComponent)?.target)
                .toBe(HULK);
        });

    it('plunders the ship of a mission the sim marked failed', async () => {
        const { world, owner } = await missionWorld(mission(GOAL_DESTROY,
            { failed: true, failCause: 'scan' }));
        press(world, OWNER);
        expect(owner.components.get(BoardingComponent)?.target).toBe(HULK);
    });

    it('plunders an UNBOARDED ship of an aborted mission (untethered): an '
        + 'ordinary ship again', async () => {
            const { world, owner } = await missionWorld(
                mission(GOAL_DESTROY), { untethered: true });
            press(world, OWNER);
            expect(owner.components.get(BoardingComponent)?.target)
                .toBe(HULK);
        });

    it('still refuses a ship boarded before its mission was aborted '
        + '(reference "Boarding live mission ships, wave 61")', async () => {
            const { world, owner, hulk, blocked } =
                await missionWorld(mission(GOAL_DESTROY));
            press(world, OWNER);
            expect(blocked).toEqual([]);
            // The abort releases it (mission_ship_release.ts).
            hulk.components.set(MissionShipComponent, {
                ...hulk.components.get(MissionShipComponent)!,
                untethered: true,
            });
            owner.components.get(MissionsComponent)!.delete(MISSION);
            press(world, OWNER);
            expect(blocked).toEqual([REFUSED]);
            expect(owner.components.has(BoardingComponent)).toBeFalse();
        });
});
