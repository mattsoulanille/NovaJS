import 'jasmine';
import { OutfitData } from 'novadatainterface/outfit_data';
import {
    getPluginGameData, pluginControlBit,
} from '../communication/simulation_test_fixture.js';
import {
    availabilityTest, canBuyOutfit, maxBuyCount, offeredToday,
    outfitBuyRandomDayRoll, OutfitterContext, stellarOf, visibleOutfits,
} from './outfitter_rules.js';

/**
 * ONE OFFICER PER POST — Extra Outfits' bridge officers, against the real
 * plug-in data.
 *
 * Playtest report (Matthew, 2026-08-19): "I seem to be able to buy multiple
 * of a certain type of officer from extra-outfits (v18)."
 *
 * THE PLUG-IN'S RULE, read off the oütfs (ExtraOutfits v18 Part 1):
 *
 *   oütf 533 "Officer Quarters"  Max 1, Contribute 0x800000, OnPurchase
 *                                `b9010`, OnSell `!b9010`. Its dësc: "This
 *                                addition has six quarters so there is
 *                                enough room to support up to six Officers."
 *   oütf 504-521                 six POSTS of three CANDIDATES each (a
 *                                poor one, an ordinary one and a good one),
 *                                every one of them Max 1, Require
 *                                0x800001, DispWeight 50, Flags 0x0100,
 *                                Availability `b9010 & !O<other> &
 *                                !O<other>` naming the OTHER TWO candidates
 *                                for the same post, and BuyRandom 50 / 25 /
 *                                15 respectively. OnPurchase and OnSell are
 *                                both empty.
 *
 * So a post is filled at most once by TWO independent gates: Max 1 stops a
 * second copy of one candidate, and the pairwise `!Oxxx` exclusions stop a
 * second CANDIDATE for the same post. Nothing else — no bit is set on
 * purchase, and crön 604 "Take Away Officers" only clears b9010 when the
 * quarters go (see outfitter_officer_quarters_integration_test.ts).
 *
 * Both gates are pinned below, because both have been broken before: the
 * `Oxxx` half resolved plug-in-private ids into the stock namespace, where
 * outfit 505 does not exist, so every exclusion silently passed and all
 * three candidates for a post could be bought (see resolveOutfitReference's
 * comment in outfitter_rules.ts, which names these very outfits).
 *
 * WHAT IS *NOT* A GATE, and is what makes the shop look like it sells three
 * First Officers: with no candidate hired yet all three are legitimately on
 * offer, and NovaJS shows all three at once because the oütf BuyRandom day
 * roll is switched off (day_roll.ts). In the original their 50 / 25 / 15
 * chances mean most days bring at most one candidate for a post. The last
 * case below pins the roll so that turning it on is one constant.
 */
describe('Extra Outfits bridge officers', () => {
    const PLUGIN = 'extra-outfits';
    const QUARTERS = `${PLUGIN}:533`;
    /** Earth: TechLevel 7, which stocks the low-tech candidates. */
    const EARTH = 'nova:128';
    /** Terrapin: mass and hardpoints to spare, so nothing else denies. */
    const SHIP = 'nova:136';

    /** [poor, ordinary, good] oütf ids, per post, and the post's name. */
    const POSTS: readonly [number, number, number, string][] = [
        [504, 505, 506, 'First Officer'],
        [507, 508, 509, 'Operations Officer'],
        [510, 511, 512, 'Tactical Officer'],
        [513, 514, 515, 'Engineering Officer'],
        [516, 517, 518, 'Sensor Officer'],
        [519, 520, 521, 'Comm Officer'],
    ];

    interface Bench {
        outfits: Map<string, OutfitData>;
        /** b9010 as renumbered under this plug-in set. */
        b9010: number;
        context(owned?: [string, number][]): OutfitterContext;
        /** The ids the grid would show, for the given owned set. */
        listed(owned?: [string, number][]): string[];
    }

    async function bench(): Promise<Bench | undefined> {
        const gameData = await getPluginGameData(PLUGIN);
        if (!gameData) {
            return undefined;
        }
        const ids = await gameData.ids;
        const outfits = new Map<string, OutfitData>();
        for (const id of ids.Outfit) {
            outfits.set(id, await gameData.data.Outfit.get(id));
        }
        const shipData = await gameData.data.Ship.get(SHIP);
        const planet = stellarOf(await gameData.data.Planet.get(EARTH));
        const b9010 = await pluginControlBit(gameData, PLUGIN, 9010);
        // Every case here starts with the quarters aboard: they carry the
        // Contribute bit the officers Require and set the bit they test.
        const context = (owned: [string, number][] = []): OutfitterContext => ({
            shipData,
            outfits: new Map([[QUARTERS, 1], ...owned]),
            getOutfit: id => outfits.get(id),
            getWeapon: () => undefined,
            bits: new Set([b9010]),
            credits: 1e9,
            planet,
        });
        return {
            outfits, b9010, context,
            listed: owned => visibleOutfits([...outfits.values()],
                context(owned)).map(o => o.id),
        };
    }

    /** The denial reason of a check, or undefined when it was allowed. */
    function reasonOf(check: ReturnType<typeof canBuyOutfit>):
        string | undefined {
        return check.allowed ? undefined : check.reason;
    }

    /** The candidate ids of one post, in [poor, ordinary, good] order. */
    function ids(post: readonly [number, number, number, string]): string[] {
        return [post[0], post[1], post[2]].map(n => `${PLUGIN}:${n}`);
    }

    it('parses each post as three Max-1 candidates that exclude each other',
        async () => {
            const b = await bench();
            if (!b) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            const quarters = b.outfits.get(QUARTERS)!;
            expect(quarters.max).toBe(1);
            expect(quarters.onPurchase).toBe(`b${b.b9010}`);
            expect(quarters.onSell).toBe(`!b${b.b9010}`);

            const buyRandoms = [50, 25, 15];
            for (const post of POSTS) {
                const members = ids(post);
                members.forEach((id, index) => {
                    const outfit = b.outfits.get(id)!;
                    const others = members.filter(other => other !== id);
                    expect(outfit.max).withContext(id).toBe(1);
                    // No bit is set or cleared by hiring: the exclusion is
                    // carried entirely by the Oxxx terms below.
                    expect(outfit.onPurchase).withContext(id).toBe('');
                    expect(outfit.onSell).withContext(id).toBe('');
                    // 0x0100 only, so a candidate whose Availability has
                    // gone false still SHOWS (greyed) — there is no 0x4000.
                    expect(outfit.hideUnlessRequirementsMet)
                        .withContext(id).toBe(true);
                    expect(outfit.hideUnlessAvailable).withContext(id)
                        .toBe(false);
                    expect(outfit.displayWeight).withContext(id).toBe(50);
                    expect(outfit.buyRandom).withContext(id)
                        .toBe(buyRandoms[index]);
                    // `b<9010> & !O<other> & !O<other>`, in the plug-in's
                    // own order — the two ids are the OTHER candidates for
                    // this post and nothing else.
                    const terms = outfit.availability.split(' & ');
                    expect(terms[0]).withContext(id).toBe(`b${b.b9010}`);
                    expect(terms.slice(1).sort()).withContext(id).toEqual(
                        others.map(other =>
                            `!O${other.slice(PLUGIN.length + 1)}`).sort());
                });
            }
        });

    it('offers every candidate for a post while it is unfilled', async () => {
        const b = await bench();
        if (!b) {
            pending('Extra Outfits plug-in not installed');
            return;
        }
        for (const post of POSTS) {
            for (const id of ids(post)) {
                const outfit = b.outfits.get(id)!;
                // Earth does not stock the exotic tech levels; only the
                // candidates it does stock can say anything here.
                if (reasonOf(canBuyOutfit(outfit, b.context()))
                    === 'notStocked') {
                    continue;
                }
                expect(availabilityTest(outfit, b.context()))
                    .withContext(id).toBe(true);
                expect(canBuyOutfit(outfit, b.context()))
                    .withContext(id).toEqual({ allowed: true });
            }
        }
    });

    it('refuses a second candidate for a post that is already filled',
        async () => {
            const b = await bench();
            if (!b) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            for (const post of POSTS) {
                const members = ids(post);
                for (const hired of members) {
                    const owned: [string, number][] = [[hired, 1]];
                    for (const other of members.filter(m => m !== hired)) {
                        const outfit = b.outfits.get(other)!;
                        expect(availabilityTest(outfit, b.context(owned)))
                            .withContext(`${other} with ${hired} aboard`)
                            .toBe(false);
                        const check = canBuyOutfit(outfit, b.context(owned));
                        expect(check.allowed)
                            .withContext(`${other} with ${hired} aboard`)
                            .toBe(false);
                        // 'notStocked' wins for a candidate Earth does not
                        // stock; every candidate it DOES stock is refused
                        // for the exclusion, which is the caption the
                        // outfitter renders as "Can't have any of this
                        // item!" (denialCaption, owned 0).
                        expect(['availability', 'notStocked'])
                            .withContext(`${other} with ${hired} aboard`)
                            .toContain(reasonOf(check)!);
                        expect(maxBuyCount(outfit, b.context(owned)))
                            .withContext(`${other} with ${hired} aboard`)
                            .toBe(0);
                    }
                }
            }
        });

    it('refuses a second COPY of the candidate already hired (Max 1)',
        async () => {
            const b = await bench();
            if (!b) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            for (const post of POSTS) {
                for (const hired of ids(post)) {
                    const outfit = b.outfits.get(hired)!;
                    const context = b.context([[hired, 1]]);
                    // Its own Availability still passes — it excludes the
                    // OTHER candidates, not itself — so Max is the only
                    // thing standing between the player and a second copy.
                    expect(availabilityTest(outfit, context))
                        .withContext(hired).toBe(true);
                    const check = canBuyOutfit(outfit, context);
                    expect(check.allowed).withContext(hired).toBe(false);
                    // 'notStocked' for the exotic-tech candidates Earth
                    // does not carry; 'maxCount' — the outfitter's "Can't
                    // have any more!" — for the rest.
                    expect(['maxCount', 'notStocked']).withContext(hired)
                        .toContain(reasonOf(check)!);
                    expect(maxBuyCount(outfit, context))
                        .withContext(hired).toBe(0);
                    // And exactly one when the post is empty: the bulk
                    // quantity dialog can never prefill two.
                    expect(maxBuyCount(outfit, b.context()))
                        .withContext(hired).toBeLessThanOrEqual(1);
                }
            }
        });

    it('leaves the excluded candidates on the shelf, greyed, not hidden',
        async () => {
            const b = await bench();
            if (!b) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            // Tactical Officer: Earth stocks the poor (TechLevel 3) and
            // ordinary (4) candidates, so both are visible either way.
            const [poor, ordinary] = ids(POSTS[2]);
            expect(b.listed()).toContain(poor);
            expect(b.listed()).toContain(ordinary);
            // Hiring the ordinary one refuses the poor one but must not
            // remove it: no 0x4000, so the Bible has it show greyed.
            const owned: [string, number][] = [[ordinary, 1]];
            expect(b.listed(owned)).toContain(poor);
            expect(canBuyOutfit(b.outfits.get(poor)!, b.context(owned))
                .allowed).toBe(false);
            // Selling the hire puts the whole post back on offer.
            expect(canBuyOutfit(b.outfits.get(poor)!, b.context()))
                .toEqual({ allowed: true });
        });

    it('has the day roll ready to thin the candidate list to one', async () => {
        const b = await bench();
        if (!b) {
            pending('Extra Outfits plug-in not installed');
            return;
        }
        // The roll's master switch is off (day_roll's
        // BUY_RANDOM_DAY_ROLL_ENABLED), so today every candidate is
        // offered — which is why all three show at once.
        for (const id of ids(POSTS[0])) {
            expect(offeredToday(b.outfits.get(id)!,
                { day: 430000, stellarId: 128 })).withContext(id).toBe(true);
        }
        // The mechanism underneath is live and deterministic: the same
        // (outfit, stellar, day) always rolls the same 0-99 number, and
        // different days differ. With the switch on, the three candidates'
        // 50 / 25 / 15 would leave most days showing at most one of them.
        const good = b.outfits.get(`${PLUGIN}:506`)!;
        const at = (day: number) => outfitBuyRandomDayRoll(good,
            { day, stellarId: 128 });
        expect(at(430000)).toBe(at(430000));
        const rolls = new Set<number>();
        for (let day = 430000; day < 430100; day++) {
            rolls.add(at(day));
        }
        expect(rolls.size).toBeGreaterThan(50);
        // Rolls are per stellar too, so two worlds do not carry the same
        // candidate on the same day by construction.
        expect(new Set([128, 129, 130, 131].map(stellarId =>
            outfitBuyRandomDayRoll(good, { day: 430000, stellarId })))
            .size).toBeGreaterThan(1);
    });
});
