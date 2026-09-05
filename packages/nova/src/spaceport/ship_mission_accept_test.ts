import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { CargoComponent } from '../nova_plugin/cargo_plugin.js';
import { makeShip } from '../nova_plugin/make_ship.js';
import { GOAL_RESCUE } from '../nova_plugin/mission_ship_state.js';
import { buildAcceptedMissionShips } from '../nova_plugin/mission_ship_spawn.js';
import { expandMissionText } from '../nova_plugin/mission_text.js';
import {
    ActiveRanksComponent, ControlBitsComponent,
} from '../nova_plugin/ncb_plugin.js';
import { MissionShipComponent } from '../nova_plugin/mission_ship_plugin.js';
import { DisabledComponent } from '../nova_plugin/disabled_component.js';
import { FuelComponent } from '../nova_plugin/health_plugin.js';
import { Stat } from '../nova_plugin/stat.js';
import { NpcComponent } from '../nova_plugin/npc_ai_plugin.js';
import { TargetComponent } from '../nova_plugin/target_component.js';
import { recordWith } from '../nova_plugin/reputation.js';
import {
    CombatRatingComponent,
} from '../nova_plugin/reputation_plugin.js';
import {
    ActiveMissionType, CreditsComponent, GameDateComponent,
    MissionsComponent,
} from '../nova_plugin/player_state_plugin.js';
import { MissionUniverse } from './mission_universe.js';
import {
    buildShipMissionAccept, buildShipMissionOffer,
} from './ship_mission_accept.js';

/**
 * ============================================================================
 * Taking a mission off a ship, in flight, against the real stock data
 * ============================================================================
 *
 * The two halves the display plugins glue together: resolving what a përs
 * is offering right now (buildShipMissionOffer) and turning an Accept into
 * the input record the simulation applies (buildShipMissionAccept). Driven
 * end to end against the real game files so the stock content these exist
 * for — the Refuel Traders, the Drifting Derelicts, the Escort Merchant —
 * is pinned rather than described.
 *
 * The player here is a fresh default pilot in a Shuttle (chär nova:128),
 * built exactly as mission_integration_test builds one.
 */

/** A fresh default pilot, with the mission-relevant state a session reads. */
async function makePlayer(overrides: {
    combatRating?: number,
    bits?: Iterable<number>,
    /** Defaults to the chär's Shuttle (shïp InherentAI 1, "wimpy
     * freighter" — which is what the 0x1000 offer gate keeps out). */
    shipId?: string,
} = {}): Promise<Entity> {
    const gameData = await getIntegrationGameData();
    const start = await gameData.data.PlayerStart.get('nova:128');
    const shipData =
        await gameData.data.Ship.get(overrides.shipId ?? start.ship);
    const entity = makeShip(shipData);
    entity.components.set(GameDateComponent, { ...start.date });
    entity.components.set(CreditsComponent, { credits: start.credits });
    entity.components.set(ControlBitsComponent, new Set(overrides.bits ?? []));
    entity.components.set(ActiveRanksComponent, new Set());
    entity.components.set(MissionsComponent, new Map());
    entity.components.set(CargoComponent, new Map());
    entity.components.set(CombatRatingComponent,
        { kills: overrides.combatRating ?? 0 });
    return entity;
}

/** shïp nova:138 "Argosy", InherentAI 2 (a "beefy freighter"). */
const ARGOSY = 'nova:138';
/** The system to stand the in-flight offer context in: sÿst nova:128
 * (Sol), whose Port Kane is the stellar stellarInSystem picks for it. */
const HERE = 'nova:128';

async function universeFor() {
    const gameData = await getIntegrationGameData();
    const universe = MissionUniverse.shared(gameData);
    await universe.load();
    return { gameData, universe };
}

describe('buildShipMissionOffer (what a përs is offering right now)', () => {
    it('offers the Refuel Trader on a hail (përs 225 -> mïsn 141)',
        async () => {
            const { gameData, universe } = await universeFor();
            const pers = await gameData.data.Pers.get('nova:225');
            const player = await makePlayer();
            const offer = await buildShipMissionOffer(player, pers, 'hail',
                gameData, universe);
            expect(offer).not.toBeNull();
            expect(offer!.data.id).toEqual('nova:141');
            // ShipGoal 5, frozen into the objective the accept will carry.
            expect(offer!.shipObjective?.goal).toEqual(GOAL_RESCUE);
            expect(offer!.shipObjective?.total).toEqual(1);
            // ShipSyst -6, "whatever system the player is in": null.
            expect(offer!.shipObjective?.systemId).toBeNull();
        });

    it('makes no offer on the WRONG trigger', async () => {
        // A hail-offering përs says nothing when boarded, and vice versa
        // (përs Flags 0x0200 is the only thing that decides it).
        const { gameData, universe } = await universeFor();
        const trader = await gameData.data.Pers.get('nova:225');
        const derelict = await gameData.data.Pers.get('nova:155');
        const player = await makePlayer();
        expect(await buildShipMissionOffer(player, trader, 'board',
            gameData, universe)).toBeNull();
        expect(await buildShipMissionOffer(player, derelict, 'hail',
            gameData, universe)).toBeNull();
    });

    it('offers the derelict\'s passengers on a BOARDING '
        + '(përs 155 -> mïsn 134)', async () => {
            const { gameData, universe } = await universeFor();
            const pers = await gameData.data.Pers.get('nova:155');
            const player = await makePlayer();
            const offer = await buildShipMissionOffer(player, pers, 'board',
                gameData, universe);
            expect(offer).not.toBeNull();
            expect(offer!.data.id).toEqual('nova:134');
            // CargoType 6, CargoQty -2 ("abs tons ± 50%"): the survivors.
            expect(offer!.cargoType).toEqual(6);
            expect(offer!.cargoQty).toBeGreaterThan(0);
        });

    it('offers the trap on a boarding, and it cannot be refused '
        + '(përs 156 -> mïsn 133)', async () => {
            const { gameData, universe } = await universeFor();
            const pers = await gameData.data.Pers.get('nova:156');
            const player = await makePlayer();
            // ShipSyst -1, "the system the mission was offered in", so
            // the offer needs to know where that is.
            const offer = await buildShipMissionOffer(player, pers, 'board',
                gameData, universe, { systemId: HERE });
            expect(offer).not.toBeNull();
            expect(offer!.data.id).toEqual('nova:133');
            expect(offer!.shipObjective?.systemId).toEqual(HERE);
            expect(offer!.data.flags.cantRefuse).toBeTrue();
            // Four pirates, jumping in, told to attack.
            expect(offer!.shipObjective?.total).toEqual(4);
            expect(offer!.shipObjective?.shipStart).toEqual(1);
            expect(offer!.shipObjective?.behavior).toEqual(0);
        });

    it('keeps the Escort Merchant away from an untested captain '
        + '(mïsn 132 AvailRating 10)', async () => {
            // The one stock ship-offered mission with a combat-rating
            // gate. A fresh pilot is refused it; a blooded one is not.
            // Flown in an Argosy: përs 128 also sets 0x1000, "don't offer
            // if player is flying a wimpy freighter (aiType 1)", and the
            // chär's Shuttle is exactly that.
            const { gameData, universe } = await universeFor();
            const pers = await gameData.data.Pers.get('nova:128');
            // AvailRandom 40, so force the roll to pass either way.
            const roll = { random: () => 0 };
            expect(await buildShipMissionOffer(
                await makePlayer({ shipId: ARGOSY }), pers,
                'hail', gameData, universe, roll)).toBeNull();
            const offer = await buildShipMissionOffer(
                await makePlayer({ combatRating: 500, shipId: ARGOSY }),
                pers, 'hail', gameData, universe, roll);
            expect(offer).not.toBeNull();
            expect(offer!.data.id).toEqual('nova:132');
        });

    it('keeps a job away from the wrong kind of PLAYER hull '
        + '(përs Flags 0x1000)', async () => {
            // "Don't offer if player is flying a wimpy freighter (aiType
            // 1)". përs 128 sets it; the chär's Shuttle is InherentAI 1,
            // the Argosy is 2. The one gate on a përs that IS about the
            // offer rather than about its hail quote.
            const { gameData, universe } = await universeFor();
            const pers = await gameData.data.Pers.get('nova:128');
            expect(pers.flags.noMissionIfWimpyTrader).toBeTrue();
            const roll = { random: () => 0 };
            expect(await buildShipMissionOffer(
                await makePlayer({ combatRating: 500 }), pers, 'hail',
                gameData, universe, roll)).toBeNull();
            expect(await buildShipMissionOffer(
                await makePlayer({ combatRating: 500, shipId: ARGOSY }),
                pers, 'hail', gameData, universe, roll)).not.toBeNull();
        });

    it('is not offered below 100 units of fuel (mïsn Flags 0x0008)',
        async () => {
            // "(mission won't be offered if player has less than 100 units
            // of fuel)": with 30 units the trader would take the 30, pay
            // 2000 and leave the exploit open.
            const { gameData, universe } = await universeFor();
            const pers = await gameData.data.Pers.get('nova:225');
            const low = await makePlayer();
            low.components.set(FuelComponent,
                new Stat({ current: 30, recharge: 0, max: 600 }));
            expect(await buildShipMissionOffer(low, pers, 'hail',
                gameData, universe)).toBeNull();
            const enough = await makePlayer();
            enough.components.set(FuelComponent,
                new Stat({ current: 100, recharge: 0, max: 600 }));
            expect(await buildShipMissionOffer(enough, pers, 'hail',
                gameData, universe)).not.toBeNull();
        });

    it('respects AvailBits: !b424 silences every one of them', async () => {
        // All 13 stock ship-offered missions gate on control bit 424
        // being CLEAR (mïsn 132's AvailBits is "!b424", and the rest
        // match); setting it takes the whole set off the table.
        const { gameData, universe } = await universeFor();
        const pers = await gameData.data.Pers.get('nova:225');
        const player = await makePlayer({ bits: [424] });
        expect(await buildShipMissionOffer(player, pers, 'hail',
            gameData, universe)).toBeNull();
    });

    it('does not offer a mission the player already has', async () => {
        const { gameData, universe } = await universeFor();
        const pers = await gameData.data.Pers.get('nova:225');
        const player = await makePlayer();
        const first = await buildShipMissionOffer(player, pers, 'hail',
            gameData, universe);
        const accept = await buildShipMissionAccept(player, first!,
            gameData, universe, { offeredBy: 'npc:trader' });
        // The accept was resolved against a DETACHED copy, so the mirror
        // is untouched — put the mission on the player the way the
        // simulation would, and the offer stops.
        player.components.get(MissionsComponent)!
            .set('nova:141', accept!.active!);
        expect(await buildShipMissionOffer(player, pers, 'hail',
            gameData, universe)).toBeNull();
    });

    it('expands <OSN> to the offering ship\'s name', async () => {
        // The wildcard that only works "when offering a mission from a
        // ship" (EVN Bible). Every stock hail quote opens with it.
        const { gameData } = await universeFor();
        const pers = await gameData.data.Pers.get('nova:155');
        expect(pers.hailQuote).toContain('Derelict vessel:');
        expect(expandMissionText('<OSN>: adrift.',
            { offeringShipName: pers.name }))
            .toEqual('Drifting Derelict: adrift.');
        // With no offering ship it degrades rather than leaving a tag.
        expect(expandMissionText('<OSN>: adrift.', {}))
            .toEqual('Unidentified ship: adrift.');
    });
});

describe('buildShipMissionAccept (the input record)', () => {
    it('bakes the Refuel Trader\'s deferred auto-abort into the mission',
        async () => {
            // mïsn Flags 0x0001 with ShipGoal 5 is the DEFERRED kind: the
            // mission becomes active so its hulk can be found, and aborts
            // when the player boards it. The two numeric effects the
            // simulation applies on that boarding ride the ActiveMission.
            const { gameData, universe } = await universeFor();
            const pers = await gameData.data.Pers.get('nova:225');
            const player = await makePlayer();
            const offer = await buildShipMissionOffer(player, pers, 'hail',
                gameData, universe);
            const accept = await buildShipMissionAccept(player, offer!,
                gameData, universe, {
                offeredBy: 'npc:trader', offeredByFate: 'replace',
            });
            expect(accept).not.toBeNull();
            expect(accept!.record.missionId).toEqual('nova:141');
            expect(accept!.record.autoAborted).toBeUndefined();
            expect(accept!.record.offeredBy).toEqual('npc:trader');
            expect(accept!.record.offeredByFate).toEqual('replace');
            expect(accept!.active!.autoAbortOnBoard).toBeTrue();
            // mïsn Flags2 0x0002 PayVal 2000, mïsn Flags 0x0008 100 fuel.
            expect(accept!.active!.autoAbortPay).toEqual(2000);
            expect(accept!.active!.autoAbortFuel).toEqual(100);
            // Nothing is paid at ACCEPT: the 2000 comes on the boarding.
            expect(accept!.record.creditsDelta).toBeUndefined();
            // OnAccept is "Q25057" — Qxxx is "make the player immediately
            // leave (absquatulate) whatever stellar he's landed on,
            // showing a message from STR# ID xxx" (EVN Bible). The player
            // is in flight, landed on nothing, so it changes no player
            // state and the record carries no bits at all.
            expect(accept!.record.bitsSet).toBeUndefined();
        });

    it('never writes to the display\'s mirror of the player', async () => {
        // The whole reason the accept runs against a detached copy: the
        // display world's player entity is a one-way mirror the next
        // simulation frame overwrites.
        const { gameData, universe } = await universeFor();
        const pers = await gameData.data.Pers.get('nova:155');
        const player = await makePlayer();
        const offer = await buildShipMissionOffer(player, pers, 'board',
            gameData, universe);
        await buildShipMissionAccept(player, offer!, gameData, universe,
            { offeredBy: 'npc:derelict' });
        expect(player.components.get(MissionsComponent)!.size).toEqual(0);
        expect(player.components.get(CargoComponent)!.size).toEqual(0);
    });

    it('carries the derelict\'s survivors as a cargo delta '
        + '(mïsn 134, PickupMode 0)', async () => {
            const { gameData, universe } = await universeFor();
            const pers = await gameData.data.Pers.get('nova:155');
            const player = await makePlayer();
            const offer = await buildShipMissionOffer(player, pers, 'board',
                gameData, universe);
            const accept = await buildShipMissionAccept(player, offer!,
                gameData, universe, { offeredBy: 'npc:derelict' });
            expect(accept!.record.cargoDelta?.length).toEqual(1);
            const [, tons] = accept!.record.cargoDelta![0];
            expect(tons).toEqual(offer!.cargoQty);
            // No fate: a boarded derelict keeps floating there.
            expect(accept!.record.offeredByFate).toBeUndefined();
        });

    it('turns the Derelict Decoy into an auto-aborted record that still '
        + 'carries its ambush (mïsn 133)', async () => {
            // An IMMEDIATE auto-abort never becomes an active mission, so
            // the record says `autoAborted` and carries a null mission —
            // but the four pirates are the whole content and must survive
            // the trip.
            const { gameData, universe } = await universeFor();
            const pers = await gameData.data.Pers.get('nova:156');
            const player = await makePlayer();
            const offer = await buildShipMissionOffer(player, pers, 'board',
                gameData, universe, { systemId: HERE });
            const accept = await buildShipMissionAccept(player, offer!,
                gameData, universe,
                { offeredBy: 'npc:derelict', systemId: HERE });
            expect(accept).not.toBeNull();
            expect(accept!.record.autoAborted).toBeTrue();
            expect(accept!.record.mission).toBeNull();
            expect(accept!.active).toBeUndefined();
            // The ship source falls back to the OFFER's frozen objective,
            // which is where the pirates live once the mission is gone.
            expect(accept!.shipSource.shipObjective?.total).toEqual(4);

            const ships = await buildAcceptedMissionShips('nova:133',
                accept!.shipSource, 'player', HERE, gameData, universe);
            expect(ships.length).toEqual(4);
            for (const ship of ships) {
                // ShipBehav 0, "always attack the player".
                expect(ship.components.get(NpcComponent)?.aggressor)
                    .toEqual('player');
                expect(ship.components.get(TargetComponent)?.target)
                    .toEqual('player');
                expect(ship.components.get(MissionShipComponent)?.mission)
                    .toEqual('nova:133');
            }
        });

    it('carries an auto-abort\'s DatePostInc and its NEGATIVE PayVal '
        + 'across the wire', async () => {
            // PLUG-IN REACHABILITY, pinned with stock data: mïsn nova:609
            // (the "Drop Bear" trap) is autoAbort + applyPayOnAutoAbort
            // with PayVal -40002 and DatePostInc 14, but AvailLoc 3, so
            // no stock përs offers it. A plug-in that pointed a përs's
            // LinkMission at a mission of this shape used to lose BOTH
            // effects on the in-flight path: the record diffed credits,
            // bits, ranks, cargo and outfits but not the calendar, and
            // acceptOffer discarded every negative PayVal outright.
            const { gameData, universe } = await universeFor();
            const player = await makePlayer();
            expect(player.components.get(CreditsComponent)!.credits)
                .toEqual(25000);
            const accept = await buildShipMissionAccept(player, {
                data: universe.getMission('nova:609')!,
                travelPlanet: null, returnPlanet: null,
                cargoType: -1, cargoQty: 0, acceptable: true,
            }, gameData, universe,
                { offeredBy: 'npc:drop-bear', systemId: HERE });
            expect(accept).not.toBeNull();
            expect(accept!.record.autoAborted).toBeTrue();
            // 2% of the chär's 25000 credits.
            expect(accept!.record.creditsDelta).toEqual(-500);
            expect(accept!.record.dateDelta).toEqual(14);
            // The display's mirror is still a mirror.
            expect(player.components.get(CreditsComponent)!.credits)
                .toEqual(25000);
            expect(player.components.get(GameDateComponent))
                .toEqual((await gameData.data.PlayerStart.get('nova:128'))
                    .date);
        });

    it('carries an immediate auto-abort\'s OnAbort ranks (nova:909 '
        + '"Eamon Boarding", `K152 L138`)', async () => {
            // The whole consequence of boarding Eamon — Sworn Enemy of the
            // Wild Geese granted, Knight of Red Branch revoked — lives in
            // OnAbort, which the immediate auto-abort used to skip.
            const { gameData, universe } = await universeFor();
            const player = await makePlayer();
            player.components.set(ActiveRanksComponent,
                new Set(['nova:138']));
            const accept = await buildShipMissionAccept(player, {
                data: universe.getMission('nova:909')!,
                travelPlanet: null, returnPlanet: null,
                cargoType: -1, cargoQty: 0, acceptable: true,
            }, gameData, universe,
                { offeredBy: 'npc:eamon', systemId: HERE });
            expect(accept).not.toBeNull();
            expect(accept!.record.autoAborted).toBeTrue();
            expect(accept!.record.bitsSet).toEqual([801]);
            expect(accept!.record.ranksGranted).toEqual(['nova:152']);
            expect(accept!.record.ranksRevoked).toEqual(['nova:138']);
        });

    it('carries the missions an OnAccept starts and ends, and the record '
        + 'change that ending one makes', async () => {
            // Stock has no AvailLoc 2 mission whose OnAccept starts another
            // (arpia's "Pro-death" cascade does), so the shape is pinned on
            // a stock mission with a doctored OnAccept: `S128` starts
            // "Delivery to Earth" and `F614` fails an active enforcement
            // squad (CompGovt 128, CompReward 2: failure costs half, -1).
            const { gameData, universe } = await universeFor();
            const player = await makePlayer();
            player.components.get(MissionsComponent)!.set('nova:614', {
                id: 'nova:614', acceptedDay: 0, acceptedAt: 'nova:128',
                travelPlanet: null, returnPlanet: null, cargoType: -1,
                cargoQty: 0, cargoLoaded: false, travelDone: false,
                deadlineDay: null,
            });
            const accept = await buildShipMissionAccept(player, {
                data: {
                    ...universe.getMission('nova:909')!,
                    onAccept: 'b801 S128 F614',
                },
                travelPlanet: null, returnPlanet: null,
                cargoType: -1, cargoQty: 0, acceptable: true,
            }, gameData, universe,
                { offeredBy: 'npc:eamon', systemId: HERE });
            expect(accept).not.toBeNull();
            const record = accept!.record;
            expect(record.missionsEnded).toEqual(['nova:614']);
            expect(record.missionsStarted?.length).toEqual(1);
            const [id, started] = record.missionsStarted![0];
            expect(id).toEqual('nova:128');
            const decoded = ActiveMissionType.decode(started);
            expect(decoded._tag).toEqual('Right');
            if (decoded._tag === 'Right') {
                expect(decoded.right.returnPlanet).toEqual('nova:128');
            }
            // The Federation record: materialized from the gövt's
            // InitialRec on the client, then -1 for the failure.
            const fed = universe.getGovt('nova:128');
            const [[govtId, delta]] = record.recordsDelta!;
            expect(govtId).toEqual('nova:128');
            expect(delta).toEqual(recordWith(new Map(), 'nova:128', fed) - 1);
            // The mirror is untouched.
            expect(player.components.get(MissionsComponent)!.has('nova:614'))
                .toBeTrue();
        });

    it('refuses an accept the machinery itself refuses', async () => {
        // The 16-mission cap, re-checked at accept time against the
        // CURRENT state rather than the frozen offer.
        const { gameData, universe } = await universeFor();
        const pers = await gameData.data.Pers.get('nova:225');
        const player = await makePlayer();
        const offer = await buildShipMissionOffer(player, pers, 'hail',
            gameData, universe);
        const missions = player.components.get(MissionsComponent)!;
        for (let i = 0; i < 16; i++) {
            missions.set(`filler:${i}`, {
                id: `filler:${i}`, acceptedDay: 0, acceptedAt: 'nova:128',
                travelPlanet: null, returnPlanet: null, cargoType: -1,
                cargoQty: 0, cargoLoaded: false, travelDone: false,
                deadlineDay: null,
            });
        }
        expect(await buildShipMissionAccept(player, offer!, gameData,
            universe, { offeredBy: 'npc:trader' })).toBeNull();
    });
});

describe('the Refuel Trader replacement ship (përs Flags 0x0040)', () => {
    it('spawns the rescue hulk where the trader was, in the player\'s '
        + 'own system', async () => {
            const { gameData, universe } = await universeFor();
            const pers = await gameData.data.Pers.get('nova:225');
            const player = await makePlayer();
            const offer = await buildShipMissionOffer(player, pers, 'hail',
                gameData, universe);
            const accept = await buildShipMissionAccept(player, offer!,
                gameData, universe, {
                offeredBy: 'npc:trader', offeredByFate: 'replace',
            });
            const { Position } = await import('nova_ecs/datatypes/position');
            const { Angle } = await import('nova_ecs/datatypes/angle');
            const { Vector } = await import('nova_ecs/datatypes/vector');
            const where = new Position(1234, -567);
            const ships = await buildAcceptedMissionShips('nova:141',
                accept!.shipSource, 'player', 'nova:128', gameData, universe,
                {
                    replace: {
                        position: where, rotation: new Angle(1),
                        velocity: new Vector(0, 0),
                        preferShipId: pers.ship,
                    },
                });
            expect(ships.length).toEqual(1);
            const { MovementStateComponent } =
                await import('nova_ecs/plugins/movement_plugin');
            const movement = ships[0].components.get(MovementStateComponent)!;
            // In the trader's berth, not scattered by ShipStart 0.
            expect(movement.position.x).toEqual(1234);
            expect(movement.position.y).toEqual(-567);
            // ShipGoal 5: "they start out disabled and stay that way until
            // you board them" — a hulk, which only a boarding can lift.
            const disabled = ships[0].components.get(DisabledComponent);
            expect(disabled).toBeDefined();
            expect(disabled!.hulk).toBeTrue();
        });

    it('keeps the përs\'s own ship class when the ShipDude contains it',
        async () => {
            // Bible, përs Flags 0x0040: "if the mission's SpecialShip düde
            // type contains the përs ship's ship type in it, the
            // SpecialShip that's created will be of the same type as the
            // përs ship, regardless of the probabilities in the düde
            // resource. This is to prevent a përs ship from accidentally
            // morphing into another ship type before the player's eyes."
            //
            // The stock case is mïsn 132: përs 128 "Terrapin" flies shïp
            // nova:136 (Terrapin), and the mission's ShipDude nova:259
            // ("Lone idiot in terrapin") produces exactly that hull.
            const { gameData, universe } = await universeFor();
            const pers = await gameData.data.Pers.get('nova:128');
            expect(pers.ship).toEqual('nova:136');
            const player = await makePlayer(
                { combatRating: 500, shipId: ARGOSY });
            const offer = await buildShipMissionOffer(player, pers, 'hail',
                gameData, universe, { systemId: HERE, random: () => 0 });
            const accept = await buildShipMissionAccept(player, offer!,
                gameData, universe, {
                offeredBy: 'npc:terrapin', offeredByFate: 'replace',
            });
            const { Position } = await import('nova_ecs/datatypes/position');
            const { Angle } = await import('nova_ecs/datatypes/angle');
            const { Vector } = await import('nova_ecs/datatypes/vector');
            const ships = await buildAcceptedMissionShips('nova:132',
                accept!.shipSource, 'player', 'nova:128', gameData, universe,
                {
                    replace: {
                        position: new Position(0, 0), rotation: new Angle(0),
                        velocity: new Vector(0, 0), preferShipId: pers.ship,
                    },
                });
            // One special ship — the Terrapin taking the përs's berth —
            // plus mïsn 132's three AuxShips (düde 133 "Pirate",
            // AuxShipSyst -1, "any system the player is in"), which are
            // what makes an escort mission worth escorting.
            const special = ships.filter(ship =>
                !ship.components.get(MissionShipComponent)?.aux);
            expect(special.length).toEqual(1);
            expect(ships.length - special.length).toEqual(3);
            const { ShipComponent } =
                await import('../nova_plugin/ship_plugin.js');
            expect(special[0].components.get(ShipComponent)?.id)
                .toEqual('nova:136');
        });
});
