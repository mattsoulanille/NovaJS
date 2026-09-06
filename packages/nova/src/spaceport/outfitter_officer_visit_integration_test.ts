import 'jasmine';
import { OutfitData } from 'novadatainterface/outfit_data';
import { Entity } from 'nova_ecs/entity';
import { DefaultMap } from 'nova_ecs/utils';
import {
    getPluginGameData, pluginControlBit,
} from '../communication/simulation_test_fixture.js';
import { makeShip } from '../nova_plugin/ship/make_ship.js';
import { idPrefix } from '../nova_plugin/missions/mission_logic.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/ncb_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/ship/outfit_plugin.js';
import {
    CreditsComponent, GameDateComponent,
} from '../nova_plugin/player/player_state_plugin.js';
import { MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import {
    availabilityTest, canBuyOutfit, canSellOutfit, hasPurchaseSideEffects,
    maxBuyCount, OutfitterContext, sellRefund, stellarOf, visibleOutfits,
} from './outfitter_rules.js';

/**
 * HIRING AN OFFICER SHUTS THE POST, WITHIN THE SAME VISIT.
 *
 * Playtest report (Matthew, 2026-08-19), clarified: "It should be possible
 * for there to be multiple officers in the outfitter, and when you hire
 * (buy) one of them, you are no longer able to hire (buy) the others of
 * that type." So the moment under test is not the committed save (where
 * outfitter_officer_grades_plugin_test already pins the refusals) but the
 * BUY ITSELF: the exclusion has to see the working copy the Outfitter menu
 * mutates, before anything is committed to the entity.
 *
 * The Outfitter class is PIXI-bound, so — as elsewhere in this package —
 * the visit is driven through the exact pieces it delegates to, in the
 * exact order it calls them:
 *
 *   setInput     working outfits/bits/credits seeded from the MissionSession
 *   refreshGrid  visibleOutfits(allOutfits, makeContext())
 *   buyOutfit    canBuyOutfit -> applyBuy -> refreshGrid -> refreshTradeState
 *   applyBuy     charge, bump the working count, run OnPurchase through
 *                MissionSession.runMissionSet, then re-seed the working
 *                outfits from the session (the Gxxx/Dxxx grant path)
 *   sellOutfit   canSellOutfit -> applySell -> refreshGrid -> ...
 *
 * `grid()` below is what refreshGrid + refreshTradeState together produce:
 * the tiles the shop shows and, per tile, whether the Buy button would be
 * greyed. (ItemGrid itself draws no unbuyable state — matching the original,
 * whose reference screenshots show ungreyed tiles and put the refusal on the
 * Buy button and the caption line. So "the tile still looks clickable" is
 * expected; what must not happen is the purchase going through.)
 *
 * WHAT THE REPORT ALMOST CERTAINLY SAW. Every case here passes at the dev
 * tip, and the debug pilot's own 219-checkpoint history never holds two
 * candidates for one post. Before the writerPrefix resolution landed,
 * though, every `Oxxx` resolved into the STOCK namespace — where outfit
 * 511 does not exist — so each exclusion silently passed. Replaying that
 * old resolution against this same data (canBuyOutfit with `resolveId: id
 * => nova:${id}`) still reproduces the report exactly: holding Tactical
 * Officer, the poor candidate comes back `{ allowed: true }` instead of the
 * availability refusal. That is the bug, and the last case a client running
 * a pre-fix bundle would have shown. These specs are what keeps it fixed.
 */
describe('Extra Outfits officers, within one outfitter visit', () => {
    const PLUGIN = 'extra-outfits';
    const QUARTERS = `${PLUGIN}:533`;
    /** The Tactical Officer post: poor / ordinary / good. */
    const POOR = `${PLUGIN}:510`;
    const ORDINARY = `${PLUGIN}:511`;
    const GOOD = `${PLUGIN}:512`;
    const POST = [POOR, ORDINARY, GOOD];
    /** Terrapin: mass and hardpoints to spare. */
    const SHIP = 'nova:136';
    /**
     * Earth, TechLevel 7. It stocks the poor (TechLevel 3) and ordinary (4)
     * Tactical candidates but not the good one (113), so the two-candidate
     * cases run through the shop end to end and the third is placed aboard
     * directly where the point is the exclusion rather than the tech gate.
     */
    const EARTH = 'nova:128';

    /** One visit: the Outfitter's working state and the operations on it. */
    interface Visit {
        outfits: Map<string, OutfitData>;
        working: DefaultMap<string, number>;
        session: MissionSession;
        context(): OutfitterContext;
        /** [visible tile id, would the Buy button be greyed?] */
        grid(): { id: string, buyGreyed: boolean }[];
        /** The Outfitter's buyOutfit: gate, then applyBuy. Returns the gate. */
        buy(id: string): { allowed: boolean, reason?: string };
        /** applyBuy WITHOUT the gate — the stale-UI / debug-override click. */
        forceBuy(id: string): void;
        /** The Outfitter's sellOutfit. */
        sell(id: string): { allowed: boolean, reason?: string };
    }

    async function visit(): Promise<Visit | undefined> {
        const gameData = await getPluginGameData(PLUGIN);
        if (!gameData) {
            return undefined;
        }
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const ids = await gameData.ids;
        const outfits = new Map<string, OutfitData>();
        for (const id of ids.Outfit) {
            outfits.set(id, await gameData.data.Outfit.get(id));
        }
        const shipData = await gameData.data.Ship.get(SHIP);
        const planet = stellarOf(await gameData.data.Planet.get(EARTH));
        const b9010 = await pluginControlBit(gameData, PLUGIN, 9010);

        // The landed player: quarters aboard (they carry the Contribute
        // bit the officers Require) and b9010 set, i.e. exactly the state
        // the outfitter is in when the officer list first appears.
        const entity = makeShip(shipData);
        entity.components.set(CreditsComponent, { credits: 100_000_000 });
        entity.components.set(GameDateComponent,
            { day: 1, month: 1, year: 1177 });
        entity.components.set(ControlBitsComponent, new Set([b9010]));
        entity.components.set(OutfitsStateComponent,
            new Map([[QUARTERS, { count: 1 }]]));
        const session = await MissionSession.create(
            entity, gameData, universe, '<outfitter>');

        // Outfitter.setInput, mission-session branch.
        let working = new DefaultMap<string, number>(() => 0,
            [...session.outfits]);
        const visitPurchases = new DefaultMap<string, number>(() => 0);

        const context = (): OutfitterContext => ({
            shipData,
            outfits: working,
            getOutfit: id => outfits.get(id),
            getWeapon: () => undefined,
            bits: session.state.bits,
            credits: session.state.credits.credits,
            planet,
        });

        // Outfitter.runSetString, mission-session branch: sync the working
        // outfits INTO the session, run the string, take the result back.
        const runSetString = (expression: string, prefix: string) => {
            if (!expression) {
                return;
            }
            session.outfits.clear();
            for (const [id, count] of working) {
                if (count > 0) {
                    session.outfits.set(id, count);
                }
            }
            session.runMissionSet(expression, prefix);
            working = new DefaultMap<string, number>(() => 0,
                [...session.outfits]);
        };

        const applyBuy = (outfit: OutfitData) => {
            session.state.credits.credits -= outfit.price;
            working.set(outfit.id, working.get(outfit.id) + 1);
            visitPurchases.set(outfit.id, visitPurchases.get(outfit.id) + 1);
            runSetString(outfit.onPurchase, idPrefix(outfit.id));
        };
        const applySell = (outfit: OutfitData) => {
            const refund = sellRefund(outfit, visitPurchases.get(outfit.id));
            session.state.credits.credits += refund.credited;
            visitPurchases.set(outfit.id, refund.boughtThisVisit);
            working.set(outfit.id, Math.max(0, working.get(outfit.id) - 1));
            if (working.get(outfit.id) === 0) {
                working.delete(outfit.id);
            }
            runSetString(outfit.onSell, idPrefix(outfit.id));
        };

        return {
            outfits,
            get working() { return working; },
            session,
            context,
            grid: () => visibleOutfits([...outfits.values()], context())
                .map(outfit => ({
                    id: outfit.id,
                    buyGreyed: !canBuyOutfit(outfit, context()).allowed,
                })),
            buy: id => {
                const outfit = outfits.get(id)!;
                const check = canBuyOutfit(outfit, context());
                if (!check.allowed) {
                    return { allowed: false, reason: check.reason };
                }
                applyBuy(outfit);
                return { allowed: true };
            },
            forceBuy: id => applyBuy(outfits.get(id)!),
            sell: id => {
                const outfit = outfits.get(id)!;
                const check = canSellOutfit(outfit, context());
                if (!check.allowed) {
                    return { allowed: false, reason: check.reason };
                }
                applySell(outfit);
                return { allowed: true };
            },
        };
    }

    /** The grid entry for `id`, or undefined when the shop isn't showing it. */
    function tile(grid: { id: string, buyGreyed: boolean }[], id: string) {
        return grid.find(entry => entry.id === id);
    }

    it('offers both stocked candidates, then refuses the sibling the '
        + 'instant one is hired — before anything is committed', async () => {
            const v = await visit();
            if (!v) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            // Both Earth-stocked candidates are on the shelf and buyable:
            // "It should be possible for there to be multiple officers in
            // the outfitter".
            expect(tile(v.grid(), POOR)).toEqual(
                { id: POOR, buyGreyed: false });
            expect(tile(v.grid(), ORDINARY)).toEqual(
                { id: ORDINARY, buyGreyed: false });

            expect(v.buy(ORDINARY)).toEqual({ allowed: true });
            expect(v.working.get(ORDINARY)).toBe(1);
            // Nothing has been committed — the entity still knows nothing
            // about the hire — yet the post is already shut.
            expect(v.session.state.bits.size).toBe(1);
            expect(tile(v.grid(), POOR))
                .withContext('the sibling right after the hire')
                .toEqual({ id: POOR, buyGreyed: true });
            expect(canBuyOutfit(v.outfits.get(POOR)!, v.context()))
                .toEqual(jasmine.objectContaining(
                    { allowed: false, reason: 'availability' }));
            // The hired one itself refuses on Max, not Availability: its
            // own test excludes the OTHER two, never itself.
            expect(canBuyOutfit(v.outfits.get(ORDINARY)!, v.context()))
                .toEqual(jasmine.objectContaining(
                    { allowed: false, reason: 'maxCount' }));
            // And the bulk dialog cannot prefill a second of either.
            expect(maxBuyCount(v.outfits.get(POOR)!, v.context())).toBe(0);
            expect(maxBuyCount(v.outfits.get(ORDINARY)!, v.context())).toBe(0);
        });

    it('refuses the sibling on a SECOND click too (a stale tile is only a '
        + 'picture; the gate is re-evaluated per click)', async () => {
            const v = await visit();
            if (!v) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            expect(v.buy(POOR)).toEqual({ allowed: true });
            // Every subsequent click on the sibling goes through
            // canBuyOutfit again, so repeating it changes nothing.
            for (let click = 0; click < 3; click++) {
                expect(v.buy(ORDINARY)).toEqual(
                    { allowed: false, reason: 'availability' });
            }
            expect(v.working.get(ORDINARY)).toBe(0);
            expect(v.working.get(POOR)).toBe(1);
        });

    it('keeps all three candidates mutually exclusive, whichever is hired',
        async () => {
            for (const hired of POST) {
                const v = await visit();
                if (!v) {
                    pending('Extra Outfits plug-in not installed');
                    return;
                }
                // The good candidate is TechLevel 113, which Earth does not
                // stock, so it is placed aboard rather than bought — the
                // question here is the exclusion, not the shop's tech gate.
                if (hired === GOOD) {
                    v.forceBuy(hired);
                } else {
                    expect(v.buy(hired)).withContext(hired)
                        .toEqual({ allowed: true });
                }
                for (const other of POST.filter(id => id !== hired)) {
                    const check = canBuyOutfit(
                        v.outfits.get(other)!, v.context());
                    expect(check.allowed)
                        .withContext(`${other} after hiring ${hired}`)
                        .toBe(false);
                    // notStocked wins for the tech-113 candidate at Earth;
                    // everything the shop carries is refused on the
                    // exclusion itself.
                    expect(check.allowed ? undefined : check.reason)
                        .withContext(`${other} after hiring ${hired}`)
                        .toBe(other === GOOD ? 'notStocked' : 'availability');
                }
            }
        });

    it('re-opens the post when the hire is sold back in the same visit',
        async () => {
            const v = await visit();
            if (!v) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            expect(v.buy(ORDINARY)).toEqual({ allowed: true });
            expect(tile(v.grid(), POOR)?.buyGreyed).toBe(true);

            expect(v.sell(ORDINARY)).toEqual({ allowed: true });
            expect(v.working.get(ORDINARY)).toBe(0);
            expect(tile(v.grid(), POOR))
                .withContext('the sibling after selling the hire back')
                .toEqual({ id: POOR, buyGreyed: false });
            expect(v.buy(POOR)).toEqual({ allowed: true });
            // ...and now the FIRST one is the excluded one.
            expect(canBuyOutfit(v.outfits.get(ORDINARY)!, v.context()))
                .toEqual(jasmine.objectContaining(
                    { allowed: false, reason: 'availability' }));
        });

    it('scopes the exclusion to the plug-in that wrote it, which is the '
        + 'whole of the original bug', async () => {
            const v = await visit();
            if (!v) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            // Stock outfits stop well short of 510-512, so an `!O511`
            // resolved into the stock namespace names nothing and the
            // exclusion silently passes. Pinning the absence is what makes
            // the refusal below meaningful rather than incidental.
            for (const n of [510, 511, 512]) {
                expect(v.outfits.has(`nova:${n}`)).withContext(`nova:${n}`)
                    .toBe(false);
            }
            expect(v.buy(ORDINARY)).toEqual({ allowed: true });
            const poor = v.outfits.get(POOR)!;
            expect(availabilityTest(poor, v.context())).toBe(false);
            // The pre-fix resolution, for the contrast: with every Oxxx
            // sent to the stock namespace the post stays wide open, which
            // is precisely what the playtest report described.
            const stockScoped: OutfitterContext = {
                ...v.context(), resolveId: id => `nova:${id}`,
            };
            expect(availabilityTest(poor, stockScoped))
                .withContext('the old hard-coded nova: resolution').toBe(true);
            expect(canBuyOutfit(poor, stockScoped).allowed)
                .withContext('the old hard-coded nova: resolution').toBe(true);
        });

    it('survives the OnPurchase re-seed: buying the quarters and an officer '
        + 'in one visit leaves the post shut', async () => {
            const v = await visit();
            if (!v) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            // Selling and re-buying the quarters runs both set strings
            // (`!b9010` then `b9010`), and each re-seeds the working outfit
            // map from the session — the one step in the buy path that
            // could drop an uncommitted hire on the floor.
            expect(v.sell(QUARTERS).allowed)
                .withContext('quarters are Flags 0x8, cannot be sold')
                .toBe(false);
            const quarters = v.outfits.get(QUARTERS)!;
            expect(hasPurchaseSideEffects(quarters)).toBe(true);

            expect(v.buy(ORDINARY)).toEqual({ allowed: true });
            // A set string now runs with the hire present only in the
            // working copy. Buy something that carries one: Extra Outfits'
            // Mining Crew (oütf 549, OnPurchase `K164`).
            const crew = `${PLUGIN}:549`;
            if (v.outfits.has(crew)) {
                v.forceBuy(crew);
            }
            expect(v.working.get(ORDINARY))
                .withContext('the hire survived the set-string re-seed')
                .toBe(1);
            expect(canBuyOutfit(v.outfits.get(POOR)!, v.context()))
                .toEqual(jasmine.objectContaining(
                    { allowed: false, reason: 'availability' }));
        });
});
