import 'jasmine';
import { OutfitData } from 'novadatainterface/outfit_data';
import {
    getPluginGameData, pluginControlBit,
} from '../communication/simulation_test_fixture.js';
import {
    canBuyOutfit, OutfitterContext, playerContribute, requirementsMet,
} from './outfitter_rules.js';

/**
 * The Extra Outfits plug-in's crew system, against the plug-in's real
 * data. Matthew reported being able to hire engineers with no Crew
 * Quarters aboard; these specs pin what each of the two gates involved
 * actually does, because only one of them was NovaJS's fault.
 *
 *   oütf 525 Crew Quarters      Contribute bit 22, OnPurchase sets b9009
 *   oütf 526/527/530 Soldier / Engineer / Ensign
 *                               Require bits 0+22, Availability `b9009`
 *   oütf 533 Officer Quarters   Contribute bit 23
 *   oütf 513/514/515 Engineering Officer (bad / normal / good)
 *                               Require bits 0+23,
 *                               Availability `b9010 & !O<other> & !O<other>`
 *
 * Bit 0 comes from the SHIP — every stock hull contributes 0x1 — which
 * is why every Require in this plug-in carries it.
 */
describe('Extra Outfits crew requirements against real plug-in data', () => {
    const PLUGIN = 'extra-outfits';
    /** Terrapin: Contribute exactly 0x1, so bits 22/23 can only come from
     * the quarters outfits themselves. */
    const SHIP = 'nova:136';
    const QUARTERS = `${PLUGIN}:525`;
    const ENGINEER = `${PLUGIN}:527`;
    const OFFICER_QUARTERS = `${PLUGIN}:533`;
    const OFFICER_BAD = `${PLUGIN}:513`;
    const OFFICER = `${PLUGIN}:514`;
    const OFFICER_GOOD = `${PLUGIN}:515`;

    async function bench() {
        const gameData = await getPluginGameData(PLUGIN);
        if (!gameData) {
            return undefined;
        }
        const shipData = await gameData.data.Ship.get(SHIP);
        const outfits = new Map<string, OutfitData>();
        for (const id of [QUARTERS, ENGINEER, OFFICER_QUARTERS, OFFICER_BAD,
            OFFICER, OFFICER_GOOD]) {
            outfits.set(id, await gameData.data.Outfit.get(id));
        }
        const context = (owned: [string, number][], bits: number[]):
            OutfitterContext => ({
                shipData,
                outfits: new Map(owned),
                getOutfit: id => outfits.get(id),
                getWeapon: () => undefined,
                bits: new Set(bits),
                credits: 100000000,
            });
        // The plug-in's own bit numbers, as NovaParse renumbered them (see
        // nova_plugin/ncb/control_bit_namespaces.ts).
        const [B9009, B9010] = await Promise.all(
            [9009, 9010].map(raw => pluginControlBit(gameData, PLUGIN, raw)));
        return { outfits, context, shipData, B9009, B9010 };
    }

    it('denies an Engineer with no Crew Quarters aboard', async () => {
        const b = await bench();
        if (!b) {
            pending('Extra Outfits plug-in not installed');
            return;
        }
        // b9009 is set, as it would be for a player who has owned quarters
        // before, so the Availability gate passes and Require is what
        // decides. Without it the item is merely hidden (0x4000).
        const check = canBuyOutfit(b.outfits.get(ENGINEER)!,
            b.context([], [b.B9009]));
        expect(check.allowed).toBe(false);
        expect(check.allowed || check.reason).toBe('require');
    });

    it('allows an Engineer once Crew Quarters supply the bit', async () => {
        const b = await bench();
        if (!b) {
            pending('Extra Outfits plug-in not installed');
            return;
        }
        const context = b.context([[QUARTERS, 1]], [b.B9009]);
        expect(requirementsMet(b.outfits.get(ENGINEER)!, context)).toBe(true);
        expect(canBuyOutfit(b.outfits.get(ENGINEER)!, context))
            .toEqual({ allowed: true });
    });

    it('takes the crew bit away again when the quarters are sold',
        async () => {
            const b = await bench();
            if (!b) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            // Contribute is derived from what is owned right now, so it is
            // not a latch: drop the quarters and their bit goes with them.
            // (The plug-in's raw bit 22 is namespaced to a physical bit of
            // its own, so compare against the quarters' contribute rather
            // than a literal bit position.)
            const quartersBits = BigInt(b.outfits.get(QUARTERS)!.contribute);
            expect(quartersBits).not.toBe(0n);
            expect(playerContribute(b.context([[QUARTERS, 1]], [])) & quartersBits)
                .toBe(quartersBits);
            expect(playerContribute(b.context([], [])) & quartersBits).toBe(0n);
        });

    it('keeps the three Engineering Officer grades mutually exclusive',
        async () => {
            const b = await bench();
            if (!b) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            // Officer Quarters supply Require bit 23; b9010 opens
            // Availability. The grades then exclude each other with Oxxx
            // terms naming the PLUG-IN's own ids (there is no stock outfit
            // 513-515), which is what resolving Oxxx per plug-in fixes.
            const owned: [string, number][] =
                [[OFFICER_QUARTERS, 1], [OFFICER, 1]];
            const context = b.context(owned, [b.B9010]);
            for (const other of [OFFICER_BAD, OFFICER_GOOD]) {
                const check = canBuyOutfit(b.outfits.get(other)!, context);
                expect(check.allowed).withContext(other).toBe(false);
                expect(check.allowed || check.reason)
                    .withContext(other).toBe('availability');
            }
            // With no grade owned, any of them may be hired.
            const empty = b.context([[OFFICER_QUARTERS, 1]], [b.B9010]);
            for (const grade of [OFFICER_BAD, OFFICER, OFFICER_GOOD]) {
                expect(canBuyOutfit(b.outfits.get(grade)!, empty))
                    .withContext(grade).toEqual({ allowed: true });
            }
        });
});
