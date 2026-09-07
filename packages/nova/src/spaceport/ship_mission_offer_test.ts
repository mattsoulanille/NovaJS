import 'jasmine';
import { getDefaultPersData, PersData } from 'novadatainterface/pers_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { deferredAutoAbort } from '../nova_plugin/missions/index.js';
import {
    shipOfferConsequence, ShipOfferContext, ShipOfferGates, shipOffers,
    shipOfferTrigger, showsHailQuote,
} from './ship_mission_offer.js';

/**
 * ============================================================================
 * Missions offered BY A SHIP (mïsn AvailLoc 2)
 * ============================================================================
 *
 * The Bible: AvailLoc 2 is "Offered from ship (must set up associated
 * përs resource as well)", and përs Flags 0x0200 is "Offer ship's
 * LinkMission when boarding it instead of when hailing it" — so the përs,
 * not the mission, decides which of the two triggers fires.
 */

function pers(overrides: Partial<PersData> = {},
    flags: Partial<PersData['flags']> = {}): PersData {
    const base = getDefaultPersData();
    return {
        ...base, linkMission: 'nova:134', ...overrides,
        flags: { ...base.flags, ...flags },
    };
}

function ctx(overrides: Partial<ShipOfferContext> = {}): ShipOfferContext {
    return {
        trigger: 'hail', missionAvailable: true,
        playerShip: undefined, ...overrides,
    };
}

function gates(overrides: Partial<ShipOfferGates> = {}): ShipOfferGates {
    return {
        disabled: false, attackingPlayer: false,
        holdsGrudge: false, likesPlayer: false, ...overrides,
    };
}

const playerShip = (inherentAI: number): ShipData =>
    ({ ...getDefaultShipData(), inherentAI });

describe('shipOfferTrigger (përs Flags 0x0200)', () => {
    it('offers on hailing by default', () => {
        expect(shipOfferTrigger(pers())).toEqual('hail');
    });

    it('offers on boarding when the bit is set', () => {
        expect(shipOfferTrigger(pers({}, { offerMissionOnBoarding: true })))
            .toEqual('board');
    });

    it('offers nothing without a LinkMission', () => {
        expect(shipOfferTrigger(pers({ linkMission: null }))).toBeNull();
    });
});

describe('shipOffers', () => {
    it('makes the offer on its own trigger and no other', () => {
        const boarder = pers({}, { offerMissionOnBoarding: true });
        expect(shipOffers(boarder, ctx({ trigger: 'board' }))).toBeTrue();
        expect(shipOffers(boarder, ctx({ trigger: 'hail' }))).toBeFalse();
        const hailer = pers();
        expect(shipOffers(hailer, ctx({ trigger: 'hail' }))).toBeTrue();
        expect(shipOffers(hailer, ctx({ trigger: 'board' }))).toBeFalse();
    });

    it('stays silent when the mission is not available to the player', () => {
        expect(shipOffers(pers(), ctx({ missionAvailable: false })))
            .toBeFalse();
    });

    it('leaves the four QUOTE bits entirely alone', () => {
        // Bible, përs Flags: 0x0004/0x0008/0x0010/0x0020 are each worded
        // "HailQuote only shown when ...". None of them is an offer gate,
        // and reading them as one made the 141 stock missions whose përs
        // set 0x0008 unobtainable (see ShipOfferGates' note).
        for (const flag of ['hailOnlyWithGrudge', 'hailOnlyWhenLikesPlayer',
            'hailOnlyWhenAttacking', 'hailOnlyWhenDisabled'] as const) {
            expect(shipOffers(pers({}, { [flag]: true }), ctx()))
                .withContext(flag).toBeTrue();
        }
        // ...including on the boarding trigger, where the derelicts live.
        expect(shipOffers(
            pers({}, { offerMissionOnBoarding: true, hailOnlyWhenDisabled: true }),
            ctx({ trigger: 'board' }))).toBeTrue();
    });

    it('keeps a job away from the wrong kind of PLAYER ship', () => {
        // 0x1000/0x2000/0x4000 are about the player's hull, not the
        // përs's: the Bible's way of not offering a courier run to a
        // battleship. AIType 1-2 are its "Freighters", 3+ warships.
        expect(shipOffers(pers({}, { noMissionIfWarship: true }),
            ctx({ playerShip: playerShip(3) }))).toBeFalse();
        expect(shipOffers(pers({}, { noMissionIfWarship: true }),
            ctx({ playerShip: playerShip(1) }))).toBeTrue();
        expect(shipOffers(pers({}, { noMissionIfWimpyTrader: true }),
            ctx({ playerShip: playerShip(1) }))).toBeFalse();
        expect(shipOffers(pers({}, { noMissionIfBeefyTrader: true }),
            ctx({ playerShip: playerShip(2) }))).toBeFalse();
        expect(shipOffers(pers({}, { noMissionIfBeefyTrader: true }),
            ctx({ playerShip: playerShip(1) }))).toBeTrue();
    });
});

describe('showsHailQuote (përs HailQuote, STR# 7101)', () => {
    const quoter = (flags: Partial<PersData['flags']> = {},
        hailQuote = '<OSN>: I need assistance, can you help?') =>
        pers({ hailQuote }, flags);
    const quoteCtx = (overrides: Partial<ShipOfferGates & {
        missionAvailable: boolean, alreadyShown: boolean,
    }> = {}) => ({
        ...gates(), missionAvailable: true, alreadyShown: false, ...overrides,
    });

    it('says nothing when there is no quote', () => {
        expect(showsHailQuote(quoter({}, ''), quoteCtx())).toBeFalse();
        expect(showsHailQuote(quoter({}, '   '), quoteCtx())).toBeFalse();
        expect(showsHailQuote(quoter(), quoteCtx())).toBeTrue();
    });

    it('honours 0x0080, "only show quote once"', () => {
        expect(showsHailQuote(quoter({ hailOnlyOnce: true }),
            quoteCtx({ alreadyShown: true }))).toBeFalse();
        expect(showsHailQuote(quoter({ hailOnlyOnce: true }),
            quoteCtx({ alreadyShown: false }))).toBeTrue();
        // Without the bit, an already-shown quote may be said again.
        expect(showsHailQuote(quoter(),
            quoteCtx({ alreadyShown: true }))).toBeTrue();
    });

    it('honours 0x0400, "don\'t show quote when LinkMission is not '
        + 'available"', () => {
            expect(showsHailQuote(
                quoter({ hailOnlyWhenMissionAvailable: true }),
                quoteCtx({ missionAvailable: false }))).toBeFalse();
            expect(showsHailQuote(
                quoter({ hailOnlyWhenMissionAvailable: true }),
                quoteCtx({ missionAvailable: true }))).toBeTrue();
        });

    it('honours the four encounter conditions', () => {
        expect(showsHailQuote(quoter({ hailOnlyWhenDisabled: true }),
            quoteCtx())).toBeFalse();
        expect(showsHailQuote(quoter({ hailOnlyWhenDisabled: true }),
            quoteCtx({ disabled: true }))).toBeTrue();
        expect(showsHailQuote(quoter({ hailOnlyWhenAttacking: true }),
            quoteCtx())).toBeFalse();
        expect(showsHailQuote(quoter({ hailOnlyWhenAttacking: true }),
            quoteCtx({ attackingPlayer: true }))).toBeTrue();
        expect(showsHailQuote(quoter({ hailOnlyWithGrudge: true }),
            quoteCtx())).toBeFalse();
        expect(showsHailQuote(quoter({ hailOnlyWithGrudge: true }),
            quoteCtx({ holdsGrudge: true }))).toBeTrue();
        expect(showsHailQuote(quoter({ hailOnlyWhenLikesPlayer: true }),
            quoteCtx())).toBeFalse();
        expect(showsHailQuote(quoter({ hailOnlyWhenLikesPlayer: true }),
            quoteCtx({ likesPlayer: true }))).toBeTrue();
    });
});

describe('shipOfferConsequence', () => {
    it('reports the përs replacement (0x0040) and departure (0x0800)', () => {
        expect(shipOfferConsequence(pers())).toEqual('stay');
        expect(shipOfferConsequence(
            pers({}, { replaceWithSpecialShip: true }))).toEqual('replace');
        expect(shipOfferConsequence(
            pers({}, { leavesAfterMissionAccepted: true }))).toEqual('leave');
        // Replacement wins: both remove the hull, and only one of them
        // says what takes its place.
        expect(shipOfferConsequence(pers({}, {
            replaceWithSpecialShip: true, leavesAfterMissionAccepted: true,
        }))).toEqual('replace');
    });
});

/**
 * The stock data these rules exist for. Pinned against the real game
 * files so a parser or data change shows up here rather than as a mission
 * that silently stops being offered.
 */
describe('the stock ship-offered missions', () => {
    it('offers the derelict missions on BOARDING', async () => {
        const gameData = await getIntegrationGameData();
        // The Drifting Derelicts: përs 155/156 among them, both govt 160
        // ("Derelicts", gövt Flags1 0x0800 "ships start out disabled"),
        // both carrying përs Flags 0x0200.
        const takeUsHome = await gameData.data.Pers.get('nova:155');
        expect(takeUsHome.linkMission).toEqual('nova:134');
        expect(takeUsHome.flags.offerMissionOnBoarding).toBeTrue();
        expect(shipOfferTrigger(takeUsHome)).toEqual('board');

        const decoy = await gameData.data.Pers.get('nova:156');
        expect(decoy.linkMission).toEqual('nova:133');
        expect(decoy.flags.offerMissionOnBoarding).toBeTrue();
        expect(shipOfferTrigger(decoy)).toEqual('board');
    });

    it('makes the Derelict Decoy a real trap (mïsn 133)', async () => {
        const gameData = await getIntegrationGameData();
        const mission = await gameData.data.Mission.get('nova:133');
        // Four pirates, told to attack the player, jumping in from
        // hyperspace: ShipBehav 0 is "always attack the player",
        // ShipStart 1 is "jump in from hyperspace".
        expect(mission.shipCount).toEqual(4);
        expect(mission.shipBehav).toEqual(0);
        expect(mission.shipStart).toEqual(1);
        // AvailLoc 2: offered from a ship.
        expect(mission.availLoc).toEqual(2);
    });

    it('offers the escort-merchant mission on HAILING, replacing the përs '
        + 'with its special ship', async () => {
            // The stock përs Flags 0x0040 case is not a refuel mission at
            // all: it is "Terrapin" (përs 128-154 and friends), which
            // offers mïsn 132 "Escort Merchant to <RST>" when HAILED, and
            // whose ship is then replaced in place by the mission's single
            // special ship — ShipStart 0, as the Bible requires for a
            // replacement, and ShipBehav 1 "protect the player".
            const gameData = await getIntegrationGameData();
            const terrapin = await gameData.data.Pers.get('nova:128');
            expect(terrapin.linkMission).toEqual('nova:132');
            expect(terrapin.flags.offerMissionOnBoarding).toBeFalse();
            expect(shipOfferTrigger(terrapin)).toEqual('hail');
            expect(terrapin.flags.replaceWithSpecialShip).toBeTrue();
            expect(shipOfferConsequence(terrapin)).toEqual('replace');

            const mission = await gameData.data.Mission.get('nova:132');
            expect(mission.availLoc).toEqual(2);
            expect(mission.shipCount).toEqual(1);
            expect(mission.shipStart).toEqual(0);
            expect(mission.shipBehav).toEqual(1);
        });

    it('sends the take-us-home derelict to a real destination (mïsn 134)',
        async () => {
            const gameData = await getIntegrationGameData();
            const mission = await gameData.data.Mission.get('nova:134');
            expect(mission.availLoc).toEqual(2);
            expect(mission.payVal).toEqual(75000);
            // No special ships of its own: the derelict you boarded IS
            // the mission, and the job is to carry its people home.
            expect(mission.shipCount).toBeLessThan(0);
        });

    it('offers the Refuel Traders on HAILING, replacing the trader with '
        + 'the rescue hulk (mïsn 141/650/651/652)', async () => {
            const gameData = await getIntegrationGameData();
            // All 63 Refuel Trader përs carry the same mask; përs 225 is
            // one of the 26 that link mïsn 141.
            const trader = await gameData.data.Pers.get('nova:225');
            expect(trader.linkMission).toEqual('nova:141');
            expect(shipOfferTrigger(trader)).toEqual('hail');
            expect(trader.flags.replaceWithSpecialShip).toBeTrue();
            expect(shipOfferConsequence(trader)).toEqual('replace');
            // The advertisement: STR# 7101 index 15.
            expect(trader.hailQuote)
                .toEqual('<OSN>: I need assistance, can you help?');
            // 0x0008 is set on every one of them, and their govt is
            // Civvies — so it MUST NOT gate the offer (ShipOfferGates).
            expect(trader.flags.hailOnlyWhenLikesPlayer).toBeTrue();
            expect(shipOffers(trader, ctx())).toBeTrue();
            // ...but it does gate the quote, which is the point of the bit.
            expect(showsHailQuote(trader, {
                ...gates(), missionAvailable: true, alreadyShown: false,
            })).toBeFalse();
            expect(showsHailQuote(trader, {
                ...gates({ likesPlayer: true }), missionAvailable: true,
                alreadyShown: false,
            })).toBeTrue();

            for (const id of ['nova:141', 'nova:650', 'nova:651', 'nova:652']) {
                const mission = await gameData.data.Mission.get(id);
                expect(mission.availLoc).withContext(id).toEqual(2);
                // ShipGoal 5 "rescue", one ship, in the player's own
                // system (ShipSyst -6), placed where the përs was.
                expect(mission.shipGoal).withContext(id).toEqual(5);
                expect(mission.shipCount).withContext(id).toEqual(1);
                expect(mission.shipSyst).withContext(id).toEqual(-6);
                // The deferred auto-abort and its two numeric effects.
                expect(mission.flags.autoAbort).withContext(id).toBeTrue();
                expect(mission.flags.applyPayOnAutoAbort)
                    .withContext(id).toBeTrue();
                expect(mission.flags.remove100FuelOnAutoAbort)
                    .withContext(id).toBeTrue();
                expect(mission.payVal).withContext(id).toEqual(2000);
                // Invisible, but it still has offer text to show.
                expect(mission.flags.invisible).withContext(id).toBeTrue();
                expect(mission.offerText.length).withContext(id)
                    .toBeGreaterThan(0);
                // NOT cantRefuse: you may decline to give up your fuel.
                expect(mission.flags.cantRefuse).withContext(id).toBeFalse();
            }
        });

    it('keeps the whole AvailLoc 2 set offerable in open space '
        + '(AvailStel -1)', async () => {
            // The in-flight offer context has no stellar and substitutes a
            // neutral one (ship_mission_accept's buildShipMissionOffer).
            // That is only safe because every stock ship-offered mission is
            // authored AvailStel -1, "any inhabited stellar" — pinned here
            // so a data change surfaces as this spec rather than as a
            // mission that silently stops being offered in flight.
            const gameData = await getIntegrationGameData();
            for (const id of ['nova:132', 'nova:133', 'nova:134', 'nova:135',
                'nova:136', 'nova:137', 'nova:138', 'nova:139', 'nova:140',
                'nova:141', 'nova:650', 'nova:651', 'nova:652']) {
                const mission = await gameData.data.Mission.get(id);
                expect(mission.availLoc).withContext(id).toEqual(2);
                expect(mission.availStel).withContext(id).toEqual(-1);
                // Every one of them has offer text; an offer with none
                // would open an empty popup (presentShipOffer skips it).
                expect(mission.offerText.trim().length).withContext(id)
                    .toBeGreaterThan(0);
            }
        });

    it('makes the Derelict Decoy an IMMEDIATE auto-abort, so its only '
        + 'content is the ambush', async () => {
            const gameData = await getIntegrationGameData();
            const mission = await gameData.data.Mission.get('nova:133');
            expect(mission.flags.autoAbort).toBeTrue();
            expect(mission.flags.cantRefuse).toBeTrue();
            expect(mission.flags.invisible).toBeTrue();
            // Not a board/rescue goal, so it is NOT the deferred kind:
            // it aborts the instant it is accepted and never becomes an
            // active mission (mission_logic's deferredAutoAbort).
            expect(mission.shipGoal).toEqual(-1);
            expect(deferredAutoAbort(mission)).toBeFalse();
            // Nothing but the pirates: no pay, no OnAccept set string.
            expect(mission.payVal).toEqual(0);
            expect(mission.onAccept).toEqual('');
        });
});
