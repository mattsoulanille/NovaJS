import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import {
    getPluginGameData, pluginControlBit,
} from '../communication/simulation_test_fixture.js';
import {
    LOCATION_MAIN_SPACEPORT, MissionOffer, offerAutoAccepts, startMissionById,
} from '../nova_plugin/missions/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player/index.js';
import { makeShip } from '../nova_plugin/ship/index.js';
import { OfferRolls, rollOffers } from './mission_offers.js';
import { MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import { OfferPopup, presentOffers } from './offer_popup.js';

/**
 * ============================================================================
 * The installed plug-ins' text-less missions, against their real data
 * ============================================================================
 *
 * #319: ARPIA's death mechanic, in ARPIA's own (raw) bit numbers. Many
 * ARPIA missions end their special-ship goal with `R(b993) R(!b993) ...`
 * in OnShipDone — a chance the player "dies". The next landing anywhere
 * inhabited then takes on arpia:1123 "Death" (AvailLoc 3, AvailRandom 100,
 * AvailBits `b993 & !(b2018 | b2015)`, Flags cantRefuse | hideDestArrows |
 * invisible, NO offer dësc 4995, no briefing): OnAccept `b993 G485 A946
 * A953 A975 A976 A977 A978 A997 A1008 A1012 A1033 A1039 A1043 M800
 * Q25090`. During the Pirate Strike (b2015) it is arpia:1124 ";Death -
 * Pirate Strike" instead (AvailBits `b993 & b2015`; OnAccept `s1123
 * !b2015 ...  A1036`), which starts Death itself. Neither has a word to
 * show, so before #319 neither could ever begin at a landing.
 *
 * #320: Extra Outfits' "Leviathan Income" (extra-outfits:1034, started by
 * crön extra-outfits:589's `S1034` when a Leviathan is sold) is the
 * installed auto-abort-that-pays: Flags 0x0001 with no special ships,
 * Flags2 0x0002, PayVal 12,000,000, no offer text.
 */

const ARPIA = 'arpia';
const DEATH = 'arpia:1123';
const DEATH_PIRATE_STRIKE = 'arpia:1124';
/** ARPIA's raw "the player has died" bit (b20132 once namespaced with
 * every installed plug-in loaded). */
const DEAD = 993;
/** ARPIA's raw "Pirate Strike under way" bit (b20148 namespaced). */
const PIRATE_STRIKE = 2015;
/** Earth: inhabited, so AvailStel -1 ("any inhabited stellar") holds. */
const EARTH = 'nova:128';

async function pilot(gameData: Awaited<ReturnType<typeof getPluginGameData>>,
    bits: number[]): Promise<Entity> {
    const shipData = await gameData!.data.Ship.get('nova:128');
    const entity = makeShip(shipData);
    entity.components.set(CreditsComponent, { credits: 1000 });
    entity.components.set(GameDateComponent, { day: 1, month: 1, year: 1177 });
    entity.components.set(ControlBitsComponent, new Set(bits));
    entity.components.set(MissionsComponent, new Map());
    return entity;
}

const onlyDeath = (offers: MissionOffer[]) => offers.filter(offer =>
    offer.data.id === DEATH || offer.data.id === DEATH_PIRATE_STRIKE);

/** A popup that must never be needed: these missions have no text. */
const silentPopup = {
    async show(text: string) {
        throw new Error(`unexpected popup: ${text}`);
    },
} as unknown as OfferPopup;

describe('ARPIA\'s "Death" missions at a landing (#319)', () => {
    async function bench() {
        const gameData = await getPluginGameData(ARPIA);
        if (!gameData) {
            return undefined;
        }
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        // ARPIA's own (raw) bit numbers, renumbered into the private range
        // by the control bit namespacing.
        const bit = (raw: number) => pluginControlBit(gameData, ARPIA, raw);
        return { gameData, universe, bit };
    }

    it('are text-less, unrefusable and invisible, as the scan found', async () => {
        const b = await bench();
        if (!b) {
            pending('ARPIA plug-in not installed');
            return;
        }
        for (const id of [DEATH, DEATH_PIRATE_STRIKE]) {
            const mission = b.universe.getMission(id)!;
            expect(offerAutoAccepts(mission)).withContext(id).toBeTrue();
            expect(mission.availLoc).toBe(LOCATION_MAIN_SPACEPORT);
            expect(mission.availRandom).toBe(100);
            expect(mission.flags.cantRefuse).toBeTrue();
            expect(mission.flags.invisible).toBeTrue();
        }
    });

    it('takes "Death" on at the landing once b993 is set', async () => {
        const b = await bench();
        if (!b) {
            pending('ARPIA plug-in not installed');
            return;
        }
        const dead = await b.bit(DEAD);
        const entity = await pilot(b.gameData, [dead]);
        const session = await MissionSession.create(entity, b.gameData,
            b.universe, EARTH);
        const rolls: OfferRolls = new Map();
        const offers = rollOffers(session, b.universe,
            LOCATION_MAIN_SPACEPORT, rolls);
        expect(offers.map(o => o.data.id)).toContain(DEATH);

        // (Earth's own stock landing offers — the tutorial's — have text
        // and are not this spec's business.)
        await presentOffers(silentPopup, session, b.universe,
            onlyDeath(offers), rolls);

        // Taken: active (it ends itself from OnShipDone, `A1123`)...
        expect(session.state.missions.has(DEATH)).toBeTrue();
        // ...with its OnAccept run: G485 is ARPIA's own outfit (stock oütf
        // ids stop at 443), and b993 stays set.
        expect(session.outfits.get(`${ARPIA}:485`)).toBe(1);
        expect(session.state.bits.has(dead)).toBeTrue();
        // An active mission is not offered again at the next landing.
        expect(rollOffers(session, b.universe, LOCATION_MAIN_SPACEPORT,
            new Map()).map(o => o.data.id)).not.toContain(DEATH);
    });

    it('takes the Pirate-Strike twin instead during the strike, which '
        + 'starts "Death" and clears b2015', async () => {
            const b = await bench();
            if (!b) {
                pending('ARPIA plug-in not installed');
                return;
            }
            const dead = await b.bit(DEAD);
            const strike = await b.bit(PIRATE_STRIKE);
            const entity = await pilot(b.gameData, [dead, strike]);
            const session = await MissionSession.create(entity, b.gameData,
                b.universe, EARTH);
            const rolls: OfferRolls = new Map();
            const offers = rollOffers(session, b.universe,
                LOCATION_MAIN_SPACEPORT, rolls);
            const ids = offers.map(o => o.data.id);
            expect(ids).toContain(DEATH_PIRATE_STRIKE);
            expect(ids).not.toContain(DEATH);

            await presentOffers(silentPopup, session, b.universe,
                onlyDeath(offers), rolls);

            // `s1123` started Death; `!b2015` turned its own AvailBits off.
            expect(session.state.missions.has(DEATH)).toBeTrue();
            expect(session.state.missions.has(DEATH_PIRATE_STRIKE)).toBeTrue();
            expect(session.state.bits.has(strike)).toBeFalse();
            expect(rollOffers(session, b.universe, LOCATION_MAIN_SPACEPORT,
                new Map()).map(o => o.data.id))
                .not.toContain(DEATH_PIRATE_STRIKE);
        });
});

describe('Extra Outfits\' "Leviathan Income" auto-abort (#320)', () => {
    it('pays its 12,000,000 at once and never becomes active', async () => {
        const gameData = await getPluginGameData('extra-outfits');
        if (!gameData) {
            pending('Extra Outfits plug-in not installed');
            return;
        }
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const id = 'extra-outfits:1034';
        const mission = universe.getMission(id)!;
        expect(mission.flags.autoAbort).toBeTrue();
        expect(mission.flags.applyPayOnAutoAbort).toBeTrue();
        expect(mission.shipCount).toBeLessThanOrEqual(0);
        expect(mission.payVal).toBe(12_000_000);

        const entity = await pilot(gameData, []);
        const session = await MissionSession.create(entity, gameData,
            universe, EARTH);
        // How crön extra-outfits:589 starts it: `S1034`.
        startMissionById(session.machinery, id, session.outfits);

        expect(session.state.missions.has(id)).toBeFalse();
        expect(session.state.credits.credits).toBe(1000 + 12_000_000);
        expect(session.state.events.find(e => e.type === 'autoAborted')
            ?.payment).toBe(12_000_000);
    });
});
