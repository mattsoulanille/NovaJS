import 'jasmine';
import { OutfitData } from 'novadatainterface/outfit_data';
import { ShipData } from 'novadatainterface/ship_data';
import {
    getIntegrationGameData, getPluginGameData, makePluginNovaParse,
    pluginControlBit,
} from '../communication/simulation_test_fixture.js';
import {
    canBuyOutfit, OutfitterContext, playerContribute, requirementsMet,
} from './outfitter_rules.js';

/**
 * Require/Contribute flag namespacing, against real plug-in data.
 *
 * The Bible's Contribute/Require space is ONE global 64-bit flag set, and
 * plug-ins written independently of one another claim the same bits.
 * NovaParse therefore resolves each plug-in's flag bits into its own
 * namespace (see novaparse/src/flag_namespace.ts): a plug-in outfit's
 * Require is satisfied only by same-plug-in contributions plus the stock
 * "base set" bits, and never by an unrelated plug-in that happened to
 * pick the same bit number.
 *
 * The collision pinned here is a real one:
 *
 *   Nuke:445           Missile Launcer   Contribute bits 22, 31 (tech 1)
 *   extra-outfits:525  Crew Quarters     Contribute bit 22
 *   extra-outfits:527  Engineer          Require bits 0+22
 *
 * With both plug-ins installed and the raw bits compared, owning the
 * (cheap, everywhere-stocked) Nuke launcher unlocked every crew outfit in
 * Extra Outfits.
 */
describe('Require/Contribute namespacing across plug-ins', () => {
    const NUKE = 'Nuke';
    const EXTRA = 'extra-outfits';
    /** Terrapin: Contribute exactly 0x1 (stock bit 0). */
    const SHIP = 'nova:136';
    const LAUNCHER = `${NUKE}:445`;
    const QUARTERS = `${EXTRA}:525`;
    const ENGINEER = `${EXTRA}:527`;

    function makeContext(shipData: ShipData,
        outfits: Map<string, OutfitData>,
        owned: [string, number][], bits: number[]): OutfitterContext {
        return {
            shipData,
            outfits: new Map(owned),
            getOutfit: id => outfits.get(id),
            getWeapon: () => undefined,
            bits: new Set(bits),
            credits: 100000000,
        };
    }

    async function bench() {
        const gameData = await getPluginGameData([NUKE, EXTRA]);
        if (!gameData) {
            return undefined;
        }
        const shipData = await gameData.data.Ship.get(SHIP);
        const outfits = new Map<string, OutfitData>();
        for (const id of [LAUNCHER, QUARTERS, ENGINEER]) {
            outfits.set(id, await gameData.data.Outfit.get(id));
        }
        // Extra Outfits' b9009, as NovaParse renumbered it (plug-in
        // control bits are namespaced too; see
        // nova_plugin/ncb/control_bit_namespaces.ts).
        const B9009 = await pluginControlBit(gameData, EXTRA, 9009);
        return {
            outfits, shipData, B9009,
            context: (owned: [string, number][], bits: number[]) =>
                makeContext(shipData, outfits, owned, bits),
        };
    }

    it('does not let another plug-in\'s bit 22 satisfy Extra Outfits\' '
        + 'Engineer', async () => {
            const b = await bench();
            if (!b) {
                pending('Nuke and/or Extra Outfits plug-in not installed');
                return;
            }
            // b9009 opens the Availability gate, so Require decides.
            const check = canBuyOutfit(b.outfits.get(ENGINEER)!,
                b.context([[LAUNCHER, 1]], [b.B9009]));
            expect(check.allowed).toBe(false);
            expect(check.allowed || check.reason).toBe('require');
        });

    it('still lets Crew Quarters (same plug-in) satisfy the Engineer',
        async () => {
            const b = await bench();
            if (!b) {
                pending('Nuke and/or Extra Outfits plug-in not installed');
                return;
            }
            const context = b.context([[QUARTERS, 1]], [b.B9009]);
            expect(requirementsMet(b.outfits.get(ENGINEER)!, context))
                .toBe(true);
            expect(canBuyOutfit(b.outfits.get(ENGINEER)!, context))
                .toEqual({ allowed: true });
        });

    it('gives the two plug-ins\' bit 22 distinct physical bits',
        async () => {
            const b = await bench();
            if (!b) {
                pending('Nuke and/or Extra Outfits plug-in not installed');
                return;
            }
            const launcher = BigInt(b.outfits.get(LAUNCHER)!.contribute);
            const quarters = BigInt(b.outfits.get(QUARTERS)!.contribute);
            expect(launcher & quarters).toBe(0n);
            // Bit 22 is not in the stock base set, so both land above 63.
            expect(quarters >> 64n).not.toBe(0n);
            // Bit 31 IS stock (the Starbridge hull contributes it), so
            // the Nuke launcher's bit 31 keeps its stock position: a
            // plug-in can deliberately contribute to a stock requirement.
            expect(launcher >> 31n & 1n).toBe(1n);
        });
});

/**
 * The mapping itself, over the real Nuke + Extra Outfits data.
 */
describe('Flag namespace map over real plug-in data', () => {
    const PLUGINS = ['Nuke', 'extra-outfits'];

    it('is identical when the same data is parsed again', async () => {
        const first = makePluginNovaParse(PLUGINS);
        const second = makePluginNovaParse(PLUGINS);
        if (!first || !second) {
            pending('Nuke and/or Extra Outfits plug-in not installed');
            return;
        }
        const a = await first.flagMap;
        const b = await second.flagMap;
        expect(a.report).toEqual(b.report);
        expect(a.namespaceOrder).toEqual(b.namespaceOrder);
        // Namespaces follow the (reverse-sorted) plug-in load order: 'e'
        // sorts after 'N', so extra-outfits loads, and allocates, first.
        expect(a.namespaceOrder).toEqual(['nova', 'extra-outfits', 'Nuke']);
        // Extra Outfits gets the first private bits, ascending by raw bit;
        // Nuke's lone private bit (22) comes after all of them.
        const extra = a.report.namespaces[0];
        expect(extra.privateBits[0].physicalBit).toBe(64);
        expect(extra.privateBits.map(p => p.bit))
            .toEqual([...extra.privateBits.map(p => p.bit)].sort((x, y) => x - y));
        expect(a.report.namespaces[1]).toEqual({
            namespace: 'Nuke',
            privateBits: [{ bit: 22, physicalBit: 64 + extra.privateBits.length }],
        });
    });

    it('has the stock base set and reports the bit-22 collision', async () => {
        const novaParse = makePluginNovaParse(PLUGINS);
        if (!novaParse) {
            pending('Nuke and/or Extra Outfits plug-in not installed');
            return;
        }
        const map = await novaParse.flagMap;
        // Stock hulls contribute 0/4/5/6/16/30/31, the Exotic Ships &
        // Weapons License 32..40 (38 also being what the capital ships
        // require), and the Illegal blasters/launchers (oütf 320-332)
        // contribute 41.
        expect(map.report.baseSet).toEqual(
            [0, 4, 5, 6, 16, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41]);
        expect(map.report.collisions).toEqual([
            { bit: 22, namespaces: ['extra-outfits', 'Nuke'] },
        ]);
        // Nothing is unsatisfiable. Extra Outfits' 2nd-generation
        // Afterburner / Solar Panels / Battery Pack require bit 47, and
        // what contributes it is a RÄNK — extra-outfits:204 — which is
        // exactly the use the EVN Bible gives rank Contribute: "These can
        // be used to prevent the player from buying certain items or doing
        // certain missions until achieving a certain rank."
        //
        // Before ränks were plumbed through, ränk was not part of the flag
        // space at all, so that Require looked like an authoring bug and
        // those three outfits could never be bought however the player
        // played. Both the diagnostic and the lockout are fixed by the same
        // change (novaparse's FLAG_RESOURCE_TYPES now includes ränk).
        expect(map.report.unsatisfiable.map(u => [u.namespace, u.bit]))
            .toEqual([]);
    });
});

/**
 * ARPIA's "all 64 bits" contributors (oütf 493 Keycard;blank outfit, shïp
 * 461 Sylvatha;Pace) satisfy every stock Require, exactly as they do in
 * the original engine, because every base-set bit keeps its position;
 * their other 48 bits become ARPIA-private and satisfy only ARPIA's own
 * Requires.
 */
describe('ARPIA all-bits contributors under flag namespacing', () => {
    it('cover the whole base set plus only ARPIA-private bits', async () => {
        const novaParse = makePluginNovaParse(['arpia']);
        if (!novaParse) {
            pending('ARPIA plug-in not installed');
            return;
        }
        const map = await novaParse.flagMap;
        const keycard = BigInt((await novaParse.data.Outfit.get('arpia:493')).contribute);
        const sylvatha = BigInt((await novaParse.data.Ship.get('arpia:461')).contribute);
        const baseMask = map.report.baseSet.reduce(
            (m, bit) => m | (1n << BigInt(bit)), 0n);
        expect(keycard & baseMask).toBe(baseMask);
        expect(sylvatha & baseMask).toBe(baseMask);
        // Nothing below 64 outside the base set...
        const low64 = (1n << 64n) - 1n;
        expect(keycard & low64 & ~baseMask).toBe(0n);
        // ...and every ARPIA-private bit above it.
        const arpia = map.report.namespaces.find(n => n.namespace === 'arpia')!;
        const arpiaMask = arpia.privateBits.reduce(
            (m, p) => m | (1n << BigInt(p.physicalBit)), 0n);
        expect(keycard & ~low64).toBe(arpiaMask);
        // The stock Medium Blaster (Require 0+32) is unlocked by it.
        const blaster = BigInt((await novaParse.data.Outfit.get('nova:129')).require);
        expect(blaster & keycard).toBe(blaster);
    });
});

/**
 * Stock Requires against stock contributions, with plug-ins loaded: bits
 * in the base set keep their positions no matter who references them.
 *
 *   nova:129 Medium Blaster                    Require bits 0+32
 *   nova:439 Exotic Ships & Weapons License    Contribute bits 32..40
 */
describe('Stock Require/Contribute under flag namespacing', () => {
    const SHIP = 'nova:136';
    const BLASTER = 'nova:129';
    const LICENSE = 'nova:439';

    async function benchFrom(gameData:
        NonNullable<Awaited<ReturnType<typeof getPluginGameData>>>) {
        const shipData = await gameData.data.Ship.get(SHIP);
        const outfits = new Map<string, OutfitData>();
        for (const id of [BLASTER, LICENSE]) {
            outfits.set(id, await gameData.data.Outfit.get(id));
        }
        const context = (owned: [string, number][]): OutfitterContext => ({
            shipData,
            outfits: new Map(owned),
            getOutfit: id => outfits.get(id),
            getWeapon: () => undefined,
            bits: new Set(),
            credits: 100000000,
        });
        return { outfits, context };
    }

    it('gates the Medium Blaster behind the Exotic License (stock only)',
        async () => {
            const b = await benchFrom(await getIntegrationGameData());
            expect(requirementsMet(b.outfits.get(BLASTER)!, b.context([])))
                .toBe(false);
            expect(requirementsMet(b.outfits.get(BLASTER)!,
                b.context([[LICENSE, 1]]))).toBe(true);
            // Stock bits stay at their stock positions.
            expect(BigInt(b.outfits.get(BLASTER)!.require)).toBe(
                (1n << 0n) | (1n << 32n));
            expect(playerContribute(b.context([[LICENSE, 1]])) >> 32n & 1n)
                .toBe(1n);
        });

    it('gates the Medium Blaster behind the Exotic License (plug-ins loaded)',
        async () => {
            const gameData = await getPluginGameData(['Nuke', 'extra-outfits']);
            if (!gameData) {
                pending('Nuke and/or Extra Outfits plug-in not installed');
                return;
            }
            const b = await benchFrom(gameData);
            expect(requirementsMet(b.outfits.get(BLASTER)!, b.context([])))
                .toBe(false);
            expect(requirementsMet(b.outfits.get(BLASTER)!,
                b.context([[LICENSE, 1]]))).toBe(true);
            expect(BigInt(b.outfits.get(BLASTER)!.require)).toBe(
                (1n << 0n) | (1n << 32n));
        });
});
