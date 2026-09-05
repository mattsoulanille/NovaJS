import 'jasmine';
import { OutfitData } from 'novadatainterface/outfit_data';
import { DefaultMap } from 'nova_ecs/utils';
import {
    makePluginNovaParse, pluginControlBit,
} from '../communication/simulation_test_fixture.js';
import { GameDataAggregator }
    from '../server/parsing/game_data_aggregator.js';
import {
    canBuyOutfit, OutfitterContext, stellarOf, visibleOutfits,
} from './outfitter_rules.js';

/**
 * SELECTING AWAY AND BACK MUST NOT UNLOCK A POST THE PLAYER ALREADY FILLED.
 *
 * Playtest report (Matthew, 2026-09-02): "I have an Officers Quarters and
 * I've hired officers, which should prevent me from hiring more of the same
 * type. When I open the outfitter and select an officer of a type I already
 * have, it INITIALLY says I can't buy it. Then I select ANOTHER outfit and
 * select the officer again, and it LETS me buy it. If I select e.g.
 * Engineering Officer 1, then another outfit, then Engineering Officer 2, it
 * says I can buy #2 — so it's related to the CLASS (post) rather than the
 * specific outfit."
 *
 * outfitter_officer_visit_integration_test already pins the exclusion, and
 * it passes — because it hands the rules an EXHAUSTIVE id->outfit map as
 * `getOutfit`. The real menu cannot: Outfitter.makeContext wires
 *
 *     getOutfit: id => this.simulationData.data.Outfit.getCached(id)
 *
 * and that one line is the whole bug. `Oxxx` resolution (outfitter_rules'
 * resolveOutfitReference) asks "is there a STOCK outfit numbered n?" by
 * probing `getOutfit('nova:n')` and reading undefined as no. Two things
 * conspire to make that probe answer differently the second time:
 *
 *   - Gettable.getCached STARTS A BACKGROUND LOAD on a miss, and
 *   - GameDataAggregator answers an id no data source defines with
 *     `Defaults[dataType]` rather than rejecting.
 *
 * So the miss caches a placeholder outfit (`{ id: 'default', ... }`) under
 * `nova:n`, and every later probe is a HIT. Extra Outfits' officers are
 * numbered 504-521 and stock outfits stop at 443, so each post's `!Oxxx`
 * exclusion silently flips from "the plug-in's own sibling, which I own"
 * to "stock outfit n, which does not exist and therefore is not owned":
 *
 *   first selection   O513 -> extra-outfits:513   owned -> REFUSED
 *   re-selection      O513 -> nova:513            absent -> ALLOWED
 *
 * Class-wide, exactly as reported, because it is the SIBLING ids in the
 * exclusion that mis-resolve, not the selected item's own id. And the
 * refusal is not merely cosmetic: Outfitter.buyOutfit re-runs canBuyOutfit
 * against a freshly made (equally poisoned) context and applyBuy has no
 * availability backstop of its own, so the second officer really is hired.
 *
 * The fixture below is a FRESH GameDataAggregator, not the shared cached
 * one, because the cold->warm flip can only be observed once per process.
 */
describe('Extra Outfits officers, selected away from and back to', () => {
    const PLUGIN = 'extra-outfits';
    const QUARTERS = `${PLUGIN}:533`;
    /** The Engineering Officer post: bad (TL 3) / ordinary (5) / good (12). */
    const BAD = `${PLUGIN}:513`;
    const ORDINARY = `${PLUGIN}:514`;
    /** Terrapin: mass and hardpoints to spare. */
    const SHIP = 'nova:136';
    /** Earth, TechLevel 7: stocks the bad and ordinary candidates. */
    const EARTH = 'nova:128';

    interface Bench {
        gameData: GameDataAggregator;
        /**
         * Outfitter.makeContext, wired exactly as the menu wires it —
         * `outfitExists` included, since that is the id-space lookup the
         * menu now hands the rules.
         */
        context(): OutfitterContext;
        /**
         * The same context with NO `outfitExists`, i.e. the getCached
         * lookups alone. Every headless caller is in this shape, so the
         * `Oxxx` resolution has to survive it without an id list too.
         */
        contextWithoutIdSpace(): OutfitterContext;
        /** What the grid lists (refreshGrid). */
        listed(): string[];
        /**
         * Awaits the background loads `getCached` kicked off on its misses.
         *
         * Not a nudge: Gettable.getCached calls `this.get(id)` and caches
         * the promise, and `get` dedups on that same entry — so awaiting it
         * here is awaiting the very load the probe already started. In the
         * running menu the wait is simply the frames between one tile click
         * and the next.
         */
        settle(): Promise<void>;
    }

    async function bench(): Promise<Bench | undefined> {
        const novaParse = makePluginNovaParse([PLUGIN]);
        if (!novaParse) {
            return undefined;
        }
        const gameData = new GameDataAggregator([novaParse], () => { });
        const ids = await gameData.ids;
        const shipData = await gameData.data.Ship.get(SHIP);
        const planet = stellarOf(await gameData.data.Planet.get(EARTH));
        // The officers' Availability reads `b20034` because NovaParse
        // renumbers plug-in-private bits; b9010 is what the plug-in wrote.
        const quartersBit = await pluginControlBit(gameData, PLUGIN, 9010);

        // THE WARMTH PRECONDITION makeContext documents: makeOutfitsGrid
        // fetches every outfit (and every weapon they name) before any
        // context runs, so `getCached` answers for everything that exists.
        // Nothing here is a shortcut — it is what the menu does.
        const allOutfits: OutfitData[] = [];
        for (const id of ids.Outfit) {
            allOutfits.push(await gameData.data.Outfit.get(id));
        }
        for (const id of ids.Weapon) {
            await gameData.data.Weapon.get(id);
        }

        // The landed player: quarters aboard (they carry the Contribute bit
        // the officers Require and set b20034), and the bad Engineering
        // Officer already hired.
        const outfits = new DefaultMap<string, number>(() => 0,
            [[QUARTERS, 1], [BAD, 1]]);

        const outfitIds = new Set(ids.Outfit);
        const contextWithoutIdSpace = (): OutfitterContext => ({
            shipData,
            outfits,
            getOutfit: id => gameData.data.Outfit.getCached(id),
            getWeapon: id => gameData.data.Weapon.getCached(id),
            bits: new Set([quartersBit]),
            credits: 100_000_000,
            planet,
        });
        // Outfitter.outfitExists, i.e. MissionUniverse.hasOutfit over the
        // loaded oütf id list.
        const context = (): OutfitterContext => ({
            ...contextWithoutIdSpace(),
            outfitExists: id => outfitIds.has(id),
        });

        return {
            gameData,
            context,
            contextWithoutIdSpace,
            listed: () => visibleOutfits(allOutfits, context())
                .map(outfit => outfit.id),
            settle: async () => {
                // Every stock id an officer's Oxxx could name. `get`
                // resolves (to the aggregator's default) rather than
                // rejecting, which is the half of the bug that poisons
                // the cache.
                await Promise.all([...Array(64).keys()].map(n =>
                    gameData.data.Outfit.get(`nova:${500 + n}`)
                        .catch(() => undefined)));
            },
        };
    }

    /**
     * A bench PER SPEC, not a shared one: the cold-cache half of the bug
     * can only be observed once per aggregator, and jasmine runs these in
     * random order. Parsing is lazy, so this is cheap.
     */
    async function withBench(body: (b: Bench) => Promise<void>) {
        const b = await bench();
        if (!b) {
            pending(`Plug-in '${PLUGIN}' is not installed`);
            return;
        }
        await body(b);
    }

    it('keeps refusing the sibling grade after the selection moves away',
        () => withBench(async b => {
            // The shop lists both candidates; the bad one is owned, so it
            // is on show to be sold back, and the ordinary one is stocked.
            expect(b.listed()).toContain(ORDINARY);

            const ordinary = b.gameData.data.Outfit.getCached(ORDINARY);
            expect(ordinary).toBeDefined();
            if (!ordinary) {
                return;
            }

            // FIRST SELECTION (setOutfitSelected -> refreshTradeState).
            const first = canBuyOutfit(ordinary, b.contextWithoutIdSpace());
            expect(first.allowed).toBeFalse();
            expect(first.allowed ? undefined : first.reason)
                .toEqual('availability');

            // Select another outfit, then this one again — the frames in
            // between are all the background loads need.
            await b.settle();

            const second = canBuyOutfit(ordinary, b.contextWithoutIdSpace());
            expect(second.allowed)
                .withContext('re-selecting an already-filled post must not '
                    + 'make it buyable')
                .toBeFalse();
            expect(second.allowed ? undefined : second.reason)
                .toEqual('availability');

            // And with the menu's own wiring, which additionally hands the
            // rules the loaded oütf id list.
            const withIdSpace = canBuyOutfit(ordinary, b.context());
            expect(withIdSpace.allowed).toBeFalse();
            expect(withIdSpace.allowed ? undefined : withIdSpace.reason)
                .toEqual('availability');
        }));

    it('refuses every sibling of every post the player has filled',
        () => withBench(async b => {
            await b.settle();
            // The whole officer block, not just the one post in the report:
            // each of the six posts excludes its own two siblings, and the
            // player holds the bad Engineering candidate.
            for (const grade of [BAD, ORDINARY]) {
                const outfit = b.gameData.data.Outfit.getCached(grade);
                expect(outfit).toBeDefined();
                const check = canBuyOutfit(outfit!, b.context());
                expect(check.allowed)
                    .withContext(`${grade} (${outfit?.name})`)
                    .toBeFalse();
            }
            // A post the player has NOT filled is still open, so the
            // refusals above are the exclusion and not a blanket denial.
            const comm = b.gameData.data.Outfit.getCached(`${PLUGIN}:520`);
            expect(comm).toBeDefined();
            expect(canBuyOutfit(comm!, b.context()).allowed)
                .withContext('an unfilled post stays hireable')
                .toBeTrue();
        }));

    it('still resolves an Oxxx that names a real stock outfit stock-first',
        () => withBench(async b => {
            await b.settle();
            // Extra Outfits overrides stock oütf 197 (the Afterburner)
            // purely to add `!o548`, "not while you have my 2nd Generation
            // one". The override KEEPS the stock id, so `O548` has to
            // resolve under the WRITER's prefix while a plug-in outfit
            // naming a genuinely stock number still resolves to nova:
            // (review r14 L2). Owning the stock IR Missile Launcher
            // (nova:135) must still satisfy an `O135` written by the
            // plug-in.
            const afterburner = b.gameData.data.Outfit.getCached('nova:197');
            expect(afterburner?.availability).toContain('548');

            const ctx = b.context();
            const owned = new Map([...ctx.outfits, ['nova:135', 1]]);
            const probe: OutfitData = {
                ...afterburner!,
                id: `${PLUGIN}:9001`,
                writerPrefix: PLUGIN,
                availability: 'O135',
            };
            // O135 -> nova:135 (stock defines it), which is owned.
            expect(canBuyOutfit(probe, { ...ctx, outfits: owned }).allowed)
                .toBeTrue();
            // ...and with nothing owned it is refused, i.e. the term is
            // really being evaluated rather than defaulting to true.
            expect(canBuyOutfit(probe, ctx).allowed).toBeFalse();
            // And the same both ways round without an id list, which is
            // where the resolution has to fall back on getOutfit.
            const bare = b.contextWithoutIdSpace();
            expect(canBuyOutfit(probe, { ...bare, outfits: owned }).allowed)
                .toBeTrue();
            expect(canBuyOutfit(probe, bare).allowed).toBeFalse();
        }));
});
