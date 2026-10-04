import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { BITS, SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { makeShip } from '../nova_plugin/ship/index.js';
import {
    LOCATION_BAR, LOCATION_MAIN_SPACEPORT, MissionOffer, offerAutoAccepts,
} from '../nova_plugin/missions/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player/index.js';
import {
    autoAcceptOffers, OfferRolls, rollOffers,
} from './mission_offers.js';
import { MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import { OfferPopup, presentOffers } from './offer_popup.js';

/**
 * ============================================================================
 * Offers with no offer text are taken on unasked (#319)
 * ============================================================================
 *
 * The ruling: "I think they're supposed to be auto-accepted. Explore how
 * Arpia uses it to find out." ARPIA's "Death" (arpia:1123) is a main-
 * spaceport mission with no offer dësc, no briefing, Flags cantRefuse |
 * invisible and AvailRandom 100 — a landing event, which only happens if
 * the offer site takes it without asking (the real-data pin is
 * arpia_death_auto_accept_integration_test.ts). These pin the rule against
 * the synthetic scenario's two text-less missions at Port Amberline:
 *
 *  - Silent Summons, Death's shape: main spaceport, stays ACTIVE, and its
 *    AvailBits (`b108`) stay true after the accept;
 *  - Dockside Windfall: a bar auto-ABORT that pays 900,000,000 under
 *    Flags2 0x0002 and leaves its AvailBits (`b110`) true — the case the
 *    loop guard exists for.
 *
 * Before #319 presentOffers skipped both (`if (!text) continue`).
 */

const PORT = SYNTHETIC.planets.port;
const SUMMONS = SYNTHETIC.missions.silentSummons;
const WINDFALL = SYNTHETIC.missions.dockWindfall;
const WINDFALL_PAY = 900_000_000;
const WINDFALL_BRIEF =
    'A stranger presses a credit chip into your hand and is gone.';
const START_CREDITS = 25_000;

async function bench(bits: number[]) {
    const gameData = await getSyntheticGameData();
    const universe = MissionUniverse.shared(gameData);
    await universe.load();
    const start = await gameData.data.PlayerStart.get(SYNTHETIC.playerStart);
    const entity: Entity = makeShip(await gameData.data.Ship.get(start.ship));
    entity.components.set(GameDateComponent, { ...start.date });
    entity.components.set(CreditsComponent, { credits: START_CREDITS });
    entity.components.set(ControlBitsComponent, new Set(bits));
    entity.components.set(MissionsComponent, new Map());
    const session = () => MissionSession.create(entity, gameData, universe,
        PORT);
    return { entity, universe, session };
}

const onlyWindfall = (offers: MissionOffer[]) =>
    offers.filter(offer => offer.data.id === WINDFALL);

/** A popup stand-in that records every text shown and answers accept. */
function recordingPopup() {
    const shown: string[] = [];
    const popup = {
        async show(text: string) {
            shown.push(text);
            return 'accept';
        },
    } as unknown as OfferPopup;
    return { popup, shown };
}

describe('offers with no offer text (#319)', () => {
    it('are the scenario\'s two text-less missions, and only them', async () => {
        const { universe } = await bench([]);
        const textless = universe.missions.filter(offerAutoAccepts)
            .map(m => m.id).sort();
        expect(textless).toEqual([SUMMONS, WINDFALL].sort());
    });

    it('takes the main-spaceport mission on at landing without asking',
        async () => {
            const { entity, universe, session: open } =
                await bench([BITS.summonsOpen]);
            const session = await open();
            const rolls: OfferRolls = new Map();
            const offers = rollOffers(session, universe,
                LOCATION_MAIN_SPACEPORT, rolls);
            expect(offers.map(o => o.data.id)).toContain(SUMMONS);
            const { popup, shown } = recordingPopup();

            await presentOffers(popup, session, universe, offers, rolls);

            // Nothing was shown (no offer text, no briefing)...
            expect(shown).toEqual([]);
            // ...and the accept ran in full: active, its OnAccept bit set.
            expect(session.state.missions.has(SUMMONS)).toBeTrue();
            expect(session.state.bits.has(BITS.summonsTaken)).toBeTrue();
            expect(session.state.events.map(e => e.type))
                .toContain('accepted');
            session.commit();
            expect(entity.components.get(MissionsComponent)!.has(SUMMONS))
                .toBeTrue();
        });

    it('does not take an ACTIVE text-less mission again, though its '
        + 'AvailBits stay true', async () => {
            const { universe, session: open } =
                await bench([BITS.summonsOpen]);
            const first = await open();
            await presentOffers(recordingPopup().popup, first, universe,
                rollOffers(first, universe, LOCATION_MAIN_SPACEPORT,
                    new Map()), new Map());
            first.commit();
            const accepts = first.state.events
                .filter(e => e.type === 'accepted').length;
            expect(accepts).toBe(1);

            // The next landing, even in a NEW system visit: the mission is
            // active, so it is not on offer at all.
            const second = await open();
            expect(rollOffers(second, universe, LOCATION_MAIN_SPACEPORT,
                new Map()).map(o => o.data.id)).not.toContain(SUMMONS);
        });

    it('runs an auto-abort\'s Pay and shows its briefing, as a click would',
        async () => {
            const { entity, universe, session: open } =
                await bench([BITS.windfallOpen]);
            const session = await open();
            const rolls: OfferRolls = new Map();
            const { popup, shown } = recordingPopup();

            // (The bar's other job, the Gate Survey, has offer text and is
            // not this spec's business.)
            await presentOffers(popup, session, universe,
                onlyWindfall(rollOffers(session, universe, LOCATION_BAR,
                    rolls)), rolls);

            // The only popup is the briefing; the offer was never asked.
            expect(shown).toEqual([WINDFALL_BRIEF]);
            // Flags2 0x0002: the whole PayVal, at once; never active.
            expect(session.state.missions.has(WINDFALL)).toBeFalse();
            const notice = session.state.events
                .find(e => e.type === 'autoAborted');
            expect(notice?.missionId).toBe(WINDFALL);
            expect(notice?.payment).toBe(WINDFALL_PAY);
            session.commit();
            expect(entity.components.get(CreditsComponent)!.credits)
                .toBe(START_CREDITS + WINDFALL_PAY);
        });

    it('takes an auto-abort whose AvailBits it leaves true once per '
        + 'system visit, not on every walk into the bar', async () => {
            const { entity, universe, session: open } =
                await bench([BITS.windfallOpen]);
            const visit: OfferRolls = new Map();
            const walkIn = async (rolls: OfferRolls) => {
                const session = await open();
                await presentOffers(recordingPopup().popup, session, universe,
                    onlyWindfall(rollOffers(session, universe, LOCATION_BAR,
                        rolls)), rolls);
                session.commit();
                return entity.components.get(CreditsComponent)!.credits;
            };

            expect(await walkIn(visit)).toBe(START_CREDITS + WINDFALL_PAY);
            // Out of the bar and back in, same system visit: not again.
            expect(await walkIn(visit)).toBe(START_CREDITS + WINDFALL_PAY);
            // The BBS-style helper honours the same visit record.
            const session = await open();
            expect(autoAcceptOffers(session,
                rollOffers(session, universe, LOCATION_BAR, visit), visit)
                .accepted).toEqual([]);
            // A NEW system visit re-rolls availability (Bible, AvailRandom:
            // "recalculated each time you warp into a system"), and the
            // data still offers it: taken again.
            expect(await walkIn(new Map()))
                .toBe(START_CREDITS + 2 * WINDFALL_PAY);
        });

    it('auto-accepts on a listing board and leaves only the asked offers',
        async () => {
            // The BBS path (MissionBoard.show): the same accept, and the
            // text-less offer never becomes a row.
            const { universe, session: open } =
                await bench([BITS.summonsOpen]);
            const session = await open();
            const rolls: OfferRolls = new Map();
            const offers = rollOffers(session, universe,
                LOCATION_MAIN_SPACEPORT, rolls);
            const { accepted, remaining } =
                autoAcceptOffers(session, offers, rolls);
            expect(accepted.map(o => o.data.id)).toEqual([SUMMONS]);
            expect(remaining.some(o => offerAutoAccepts(o.data))).toBeFalse();
            expect(session.state.missions.has(SUMMONS)).toBeTrue();
        });
});
