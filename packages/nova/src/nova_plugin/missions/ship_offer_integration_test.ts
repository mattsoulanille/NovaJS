import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { v4 } from 'uuid';
import {
    getIntegrationGameData, makeSimulationBridgeHarness,
} from '../../communication/simulation_test_fixture.js';
import { MissionUniverse } from '../../spaceport/mission_universe.js';
import {
    buildShipMissionAccept, buildShipMissionOffer,
} from '../../spaceport/ship_mission_accept.js';
import { shipOfferConsequence } from '../../spaceport/ship_mission_offer.js';
import { BoardedComponent } from '../ship/boarding_component.js';
import { CargoComponent } from '../ship/cargo_plugin.js';
import { DisabledComponent } from '../ship/disabled_component.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { FuelComponent } from '../ship/health_plugin.js';
import { JUMP_DISTANCE } from '../travel/jump_plugin.js';
import {
    applyAcceptMission, ShipOfferSpentComponent,
} from './mission_accept.js';
import { buildAcceptedMissionShips } from './mission_ship_spawn.js';
import { MissionShipComponent } from '../player/mission_ship_component.js';
import { GOAL_RESCUE } from '../player/mission_ship_state.js';
import { ActiveRanksComponent, ControlBitsComponent } from '../ncb/ncb_plugin.js';
import { makeNpcShip } from '../spawn/npc_spawn_plugin.js';
import { NpcComponent } from '../npc/npc_ai_plugin.js';
import { PersComponent } from '../spawn/pers_plugin.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../player/player_state_plugin.js';
import { CombatRatingComponent } from '../reputation/reputation_plugin.js';
import { ShipComponent } from '../ship/ship_plugin.js';
import { SystemHoldComponent } from '../npc/system_hold.js';
import { TargetComponent } from '../ship/target_component.js';

/**
 * ============================================================================
 * The whole Refuel Trader loop, in a stepping world
 * ============================================================================
 *
 * Stock mïsn 141 / 650 / 651 / 652 are the missions everything in this
 * feature has to work at once for, so this drives all of it end to end
 * against the real game files and a real simulation world:
 *
 *   hail        a përs (nova:225) flying a Civvies hull in the system
 *   dialog      buildShipMissionOffer resolves mïsn 141 from its
 *               LinkMission (AvailLoc 2)
 *   accept      buildShipMissionAccept bakes the acceptance, and
 *               buildAcceptedMissionShips builds the mission's ONE
 *               special ship at the trader's own position (përs Flags
 *               0x0040, "replace it with this ship while removing this
 *               one from play")
 *   replaced    applyAcceptMission inserts the replacement and deletes
 *               the trader on the SAME tick
 *   disabled    ShipGoal 5, "they start out disabled and stay that way
 *               until you board them": the replacement is a hulk, and
 *               ShipDisableSystem will not lift it however healthy it is
 *   board       the player boards it
 *   auto-abort  mïsn Flags 0x0001 deferred: Flags2 0x0002 pays the 2000
 *               credits, Flags 0x0008 takes the 100 units of fuel, and
 *               the player-local half is marked pending
 *   flies off   the rescue lifts the disable and the trader goes on its way
 *
 * The display layer between "hail" and "accept" is a popup and a button;
 * everything either side of it is here.
 */

/** The hailed përs, its hull, and the accept record the player's press
 * would produce — the whole of what the display would have done. */
async function hailTheTrader(persId = 'nova:225') {
    const harness = await makeSimulationBridgeHarness();
    const { world, shipUuid, systemId } = harness;
    const gameData = await getIntegrationGameData();
    const universe = MissionUniverse.shared(gameData);
    await universe.load();
    const pers = await gameData.data.Pers.get(persId);

    // The trader, flying where the player found it. A real përs hull:
    // PersComponent is what the display reads to know who it is.
    const persShip = await gameData.data.Ship.get(pers.ship);
    const berth = new Position(700, -300);
    const trader = makeNpcShip(persShip, pers.aiType, pers.govt,
        berth, new Angle(0.5), new Vector(0, 0));
    trader.components.set(PersComponent,
        { id: persId, name: pers.name, subtitle: pers.subtitle });
    trader.components.set(MultiplayerData, { owner: 'server' });
    const traderUuid = v4();
    await completeEntity(world, trader);
    world.entities.set(traderUuid, trader);

    // The player, with the state a mission session reads.
    const player = world.entities.get(shipUuid)!;
    player.components.set(GameDateComponent,
        { day: 23, month: 6, year: 1177 });
    player.components.set(CreditsComponent, { credits: 25_000 });
    player.components.set(ControlBitsComponent, new Set());
    player.components.set(ActiveRanksComponent, new Set());
    player.components.set(MissionsComponent, new Map());
    player.components.set(CargoComponent, new Map());
    player.components.set(CombatRatingComponent, { kills: 0 });
    for (let i = 0; i < 30; i++) {
        world.step();
        await new Promise(resolve => setImmediate(resolve));
    }

    const offer = await buildShipMissionOffer(player, pers, 'hail',
        gameData, universe, { systemId });
    if (!offer) {
        throw new Error(`${persId} offered nothing`);
    }
    const consequence = shipOfferConsequence(pers);
    const accept = await buildShipMissionAccept(player, offer, gameData,
        universe, {
        offeredBy: traderUuid, systemId,
        ...(consequence === 'stay' ? {} : { offeredByFate: consequence }),
    });
    if (!accept) {
        throw new Error(`${persId}'s offer could not be accepted`);
    }
    const movement = trader.components.get(MovementStateComponent)!;
    const ships = await buildAcceptedMissionShips(offer.data.id,
        accept.shipSource, shipUuid, systemId, gameData, universe, {
        replace: {
            position: movement.position,
            rotation: movement.rotation,
            velocity: movement.velocity,
            preferShipId: trader.components.get(ShipComponent)?.id,
        },
    });

    // What browser.ts does with the pair: encode the ships onto the
    // record so the whole acceptance is one input.
    const serializer = world.resources.get(SerializerResource)!;
    const shipUuids = ships.map(() => v4());
    const record = {
        ...accept.record,
        ships: ships.map((ship, i) => ({
            uuid: shipUuids[i],
            entity: serializer.encode(ship) as never,
        })),
    };

    return {
        world, player, playerUuid: shipUuid, trader, traderUuid,
        berth: movement.position, record, offer, accept,
        shipUuids, gameData,
    };
}

describe('the Refuel Trader, hail to undock (mïsn 141)', () => {
    it('shows an offer whose text is the trader asking for fuel',
        async () => {
            const { offer } = await hailTheTrader();
            expect(offer.data.id).toEqual('nova:141');
            expect(offer.data.offerText)
                .toContain('Can you help me out with enough energy');
            // Invisible (mïsn Flags 0x0400) but it still has its offer
            // text, and it cannot be refused into a mission list — it is
            // the deferred auto-abort kind.
            expect(offer.data.flags.invisible).toBeTrue();
            expect(offer.data.flags.cantRefuse).toBeFalse();
        }, 30_000);

    it('replaces the trader with a disabled hulk in its own berth',
        async () => {
            const { world, trader, traderUuid, berth, record, shipUuids } =
                await hailTheTrader();
            expect(record.offeredByFate).toEqual('replace');
            expect(record.ships.length).toEqual(1);

            applyAcceptMission(world, undefined, record);

            // The trader is gone from play, in the same apply that put
            // its replacement in: nothing was ever pulled out and put
            // back (Matthew's ruling).
            expect(world.entities.has(traderUuid)).toBeFalse();
            expect(trader.components.has(ShipOfferSpentComponent)).toBeTrue();

            const rescue = world.entities.get(shipUuids[0])!;
            expect(rescue).toBeDefined();
            const where = rescue.components.get(MovementStateComponent)!;
            expect(where.position.x).toEqual(berth.x);
            expect(where.position.y).toEqual(berth.y);
            expect(rescue.components.get(MissionShipComponent)?.mission)
                .toEqual('nova:141');
            // ...and it is HELD here until it has been refuelled
            // (Matthew: the ship you must rescue must not leave before
            // you rescue it). See system_hold.ts.
            expect(rescue.components.get(SystemHoldComponent))
                .toEqual({ reason: 'rescue' });

            // ShipGoal 5: adrift, and it stays adrift. Stepping the world
            // must not repair it, however healthy its armor is.
            for (let i = 0; i < 30; i++) {
                world.step();
                await new Promise(resolve => setImmediate(resolve));
            }
            const disabled = world.entities.get(shipUuids[0])!
                .components.get(DisabledComponent);
            expect(disabled).toBeDefined();
            expect(disabled!.hulk).toBeTrue();
        }, 30_000);

    it('pays, takes the 100 fuel, and lets the trader go when boarded',
        async () => {
            const { world, player, playerUuid, record, shipUuids } =
                await hailTheTrader();
            applyAcceptMission(world, undefined, record);
            for (let i = 0; i < 30; i++) {
                world.step();
                await new Promise(resolve => setImmediate(resolve));
            }
            const active = player.components.get(MissionsComponent)!
                .get('nova:141')!;
            expect(active.shipObjective!.goal).toEqual(GOAL_RESCUE);
            expect(active.autoAbortOnBoard).toBeTrue();

            const fuel = player.components.get(FuelComponent)!;
            fuel.current = fuel.max;
            const fuelBefore = fuel.current;
            const creditsBefore =
                player.components.get(CreditsComponent)!.credits;

            // The boarding itself: the durable record the sim's boarding
            // plugin writes, which is what the mission goal reads.
            world.entities.get(shipUuids[0])!.components
                .set(BoardedComponent,
                    { boarder: playerUuid, plundered: true });
            for (let i = 0; i < 10; i++) {
                world.step();
            }

            // mïsn Flags2 0x0002 "apply mission Pay on auto-abort": 2000.
            expect(player.components.get(CreditsComponent)!.credits)
                .toEqual(creditsBefore + 2000);
            // mïsn Flags 0x0008 "takes away 100 units of fuel": the fuel
            // you just handed over.
            expect(player.components.get(FuelComponent)!.current)
                .toEqual(fuelBefore - 100);
            // The player-local half (OnAbort, dropping the mission, the
            // popup) runs at the next date advance.
            const after = player.components.get(MissionsComponent)!
                .get('nova:141')!;
            expect(after.autoAbortPending).toBeTrue();
            expect(after.shipObjective!.complete).toBeTrue();
            // Rescued: refuelled and on its way, no longer a hulk — and
            // free to leave the system now that it has its fuel, so the
            // in-system hold goes with the disable.
            expect(world.entities.get(shipUuids[0])!
                .components.has(DisabledComponent)).toBeFalse();
            expect(world.entities.get(shipUuids[0])!
                .components.has(SystemHoldComponent)).toBeFalse();
        }, 30_000);

    it('will not offer again from a hull whose offer is spent',
        async () => {
            // The display reads the same marker, so the second hail opens
            // the ordinary comm dialog instead.
            const { world, record, trader, traderUuid, gameData } =
                await hailTheTrader();
            // A 'stay' variant of the same record, so the hull survives
            // to be asked twice.
            const { offeredByFate, ...stays } = record;
            void offeredByFate;
            // Stranded until somebody takes the job off her hands — the
            // spawner stamps this on every rescue-offering përs.
            trader.components.set(SystemHoldComponent,
                { reason: 'shipOffer' });
            applyAcceptMission(world, undefined, stays);
            expect(world.entities.has(traderUuid)).toBeTrue();
            expect(trader.components.get(ShipOfferSpentComponent)?.missionId)
                .toEqual('nova:141');
            // The offer is off the table, so the hold is released and the
            // person may go about her business again.
            expect(trader.components.has(SystemHoldComponent)).toBeFalse();
            void gameData;
        }, 30_000);
});

describe('the Derelict Decoy trap, boarded (mïsn 133)', () => {
    it('springs four pirates on the player, with no mission to show for it',
        async () => {
            // përs 156 "Drifting Derelict" offers mïsn 133 when BOARDED
            // (Flags 0x0200). The mission auto-aborts the instant it is
            // accepted, so the player's list never changes — the four
            // ShipDude 133 ("Pirate") ships, ShipBehav 0 ("always attack
            // the player") and ShipStart 1 ("jump in from hyperspace"),
            // are the entire content.
            const harness = await makeSimulationBridgeHarness();
            const { world, shipUuid, systemId } = harness;
            const gameData = await getIntegrationGameData();
            const universe = MissionUniverse.shared(gameData);
            await universe.load();
            const pers = await gameData.data.Pers.get('nova:156');
            expect(pers.flags.offerMissionOnBoarding).toBeTrue();

            const player = world.entities.get(shipUuid)!;
            player.components.set(GameDateComponent,
                { day: 23, month: 6, year: 1177 });
            player.components.set(CreditsComponent, { credits: 25_000 });
            player.components.set(ControlBitsComponent, new Set());
            player.components.set(ActiveRanksComponent, new Set());
            player.components.set(MissionsComponent, new Map());
            player.components.set(CargoComponent, new Map());
            player.components.set(CombatRatingComponent, { kills: 0 });

            const derelictUuid = v4();
            world.entities.set(derelictUuid, (() => {
                const hull = makeNpcShip(
                    gameData.data.Ship.getCached(pers.ship)!,
                    pers.aiType, pers.govt, new Position(0, 200),
                    new Angle(0), new Vector(0, 0));
                hull.components.set(PersComponent,
                    { id: 'nova:156', name: pers.name, subtitle: '' });
                hull.components.set(DisabledComponent,
                    { repairAt: null, hulk: true });
                hull.components.set(MultiplayerData, { owner: 'server' });
                return hull;
            })());
            await completeEntity(world, world.entities.get(derelictUuid)!);
            for (let i = 0; i < 20; i++) {
                world.step();
                await new Promise(resolve => setImmediate(resolve));
            }

            const offer = await buildShipMissionOffer(player, pers, 'board',
                gameData, universe, { systemId });
            expect(offer).not.toBeNull();
            const accept = await buildShipMissionAccept(player, offer!,
                gameData, universe,
                { offeredBy: derelictUuid, systemId });
            expect(accept!.record.autoAborted).toBeTrue();

            const ships = await buildAcceptedMissionShips('nova:133',
                accept!.shipSource, shipUuid, systemId, gameData, universe);
            expect(ships.length).toEqual(4);
            const serializer = world.resources.get(SerializerResource)!;
            const pirateUuids = ships.map(() => v4());
            applyAcceptMission(world, undefined, {
                ...accept!.record,
                ships: ships.map((ship, i) => ({
                    uuid: pirateUuids[i],
                    entity: serializer.encode(ship) as never,
                })),
            });

            // No mission — it aborted on acceptance — but four pirates,
            // already aggressed at the player who took the bait.
            expect(player.components.get(MissionsComponent)!.size).toEqual(0);
            for (const uuid of pirateUuids) {
                const pirate = world.entities.get(uuid);
                expect(pirate).withContext(uuid).toBeDefined();
                expect(pirate!.components.get(NpcComponent)?.aggressor)
                    .toEqual(shipUuid);
                expect(pirate!.components.get(TargetComponent)?.target)
                    .toEqual(shipUuid);
            }
            // ShipStart 1, "jump in from hyperspace": they arrive at the
            // jump ring and fly in, rather than materialising next to the
            // player. Every one of them is exactly JUMP_DISTANCE plus its
            // own approach margin from the middle (jumpInState), which is
            // well outside the scatter box a ShipStart 0 spawn uses.
            for (const uuid of pirateUuids) {
                const at = world.entities.get(uuid)!
                    .components.get(MovementStateComponent)!.position;
                expect(Math.hypot(at.x, at.y))
                    .withContext(uuid).toBeGreaterThan(JUMP_DISTANCE);
                // ...and heading inward, not drifting.
                const towards = world.entities.get(uuid)!
                    .components.get(MovementStateComponent)!.velocity;
                expect(at.x * towards.x + at.y * towards.y)
                    .withContext(uuid).toBeLessThan(0);
            }
            // And the trap cannot be sprung twice off the same wreck.
            expect(world.entities.get(derelictUuid)!
                .components.has(ShipOfferSpentComponent)).toBeTrue();

            // THE TRAP MUST SURVIVE: the mission auto-aborted at accept and
            // never joins the player's missions, so the ambush must not be
            // swept away by MissionShipCleanupSystem on the next ticks
            // (review r11 HIGH — 4 present after apply, 0 after 10 steps).
            for (let i = 0; i < 20; i++) {
                world.step();
            }
            for (const uuid of pirateUuids) {
                expect(world.entities.get(uuid))
                    .withContext(`${uuid} after 20 steps`).toBeDefined();
            }
        }, 30_000);
});
