import { decodeCloakModVal, getDefaultCloakData } from 'novadatainterface/cloak_data';
import { decodeCloakScannerModVal, getDefaultCloakScannerData } from 'novadatainterface/cloak_scanner_data';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import {
    applyCloakDrain,
    applyCloakToggle,
    applyDecloakOnHit,
    CloakCapability,
    CloakScannerCapability,
    deriveCloak,
    deriveCloakScanner,
    isCloaked,
    isTargetable,
    ShieldLike,
} from './cloak_plugin.js';
import { getValidTargets } from '../npc/npc_plugin.js';
import { OutfitsState } from './outfit_plugin.js';

/** A gameData stub exposing only the Outfit.getCached the deriver uses. */
function mockGameData(outfits: { [id: string]: OutfitData | undefined }) {
    return {
        data: {
            Outfit: {
                getCached: (id: string) => outfits[id],
            },
        },
    } as any;
}

function cloakOutfit(id: string, modVal: number): OutfitData {
    return {
        ...getDefaultOutfitData(),
        id,
        cloak: decodeCloakModVal(modVal),
    };
}

function scannerOutfit(id: string, modVal: number): OutfitData {
    return {
        ...getDefaultOutfitData(),
        id,
        cloakScanner: decodeCloakScannerModVal(modVal),
    };
}

function scannerCapability(over: Partial<CloakScannerCapability> = {}): CloakScannerCapability {
    return {
        ...getDefaultCloakScannerData(),
        hasScanner: true,
        isCloakScanner: true,
        ...over,
    };
}

function plainOutfit(id: string): OutfitData {
    return { ...getDefaultOutfitData(), id, cloak: getDefaultCloakData() };
}

function capability(over: Partial<CloakCapability> = {}): CloakCapability {
    return { ...getDefaultCloakData(), canCloak: true, isCloak: true, ...over };
}

describe('deriveCloak', () => {
    it('reports canCloak false when the ship owns no cloak outfits', () => {
        const outfits: OutfitsState = new Map([['nova:1', { count: 1 }]]);
        const result = deriveCloak(outfits,
            mockGameData({ 'nova:1': plainOutfit('nova:1') }));
        expect(result?.canCloak).toBe(false);
    });

    it('derives the capability from a cloak outfit (Polaris v1.1 0x0409)', () => {
        const outfits: OutfitsState = new Map([['nova:269', { count: 1 }]]);
        const result = deriveCloak(outfits,
            mockGameData({ 'nova:269': cloakOutfit('nova:269', 0x0409) }));
        expect(result?.canCloak).toBe(true);
        expect(result?.shieldPerSecond).toBe(4);
        expect(result?.deactivatesWhenHit).toBe(true);
        expect(result?.hidesFromRadar).toBe(true);
    });

    it('ignores cloak outfits with zero count', () => {
        const outfits: OutfitsState = new Map([['nova:269', { count: 0 }]]);
        const result = deriveCloak(outfits,
            mockGameData({ 'nova:269': cloakOutfit('nova:269', 0x0409) }));
        expect(result?.canCloak).toBe(false);
    });

    it('merges multiple cloaks: OR booleans, min-nonzero drain', () => {
        const outfits: OutfitsState = new Map([
            ['a', { count: 1 }], // 0x0409: 4 shield/sec, decloak-on-hit, faster fade
            ['b', { count: 1 }], // 0x0006: drops shields + visible on radar
        ]);
        const result = deriveCloak(outfits, mockGameData({
            a: cloakOutfit('a', 0x0409),
            b: cloakOutfit('b', 0x0006),
        }));
        expect(result?.canCloak).toBe(true);
        // b sets visible-on-radar, so merged is NOT radar-hiding (OR of
        // hidesFromRadar: a hides=true, b hides=false -> true).
        expect(result?.hidesFromRadar).toBe(true);
        expect(result?.dropsShieldsOnActivate).toBe(true); // from b
        expect(result?.deactivatesWhenHit).toBe(true);     // from a
        // a drains 4 shield/sec, b drains 0 -> min nonzero is 4.
        expect(result?.shieldPerSecond).toBe(4);
    });

    it('returns undefined when outfit data is not cached yet', () => {
        const outfits: OutfitsState = new Map([['missing', { count: 1 }]]);
        const result = deriveCloak(outfits, mockGameData({ missing: undefined }));
        expect(result).toBeUndefined();
    });
});

describe('applyCloakToggle', () => {
    it('turns a cloak on and off', () => {
        const cloak = capability();
        expect(applyCloakToggle(false, cloak).next).toBe(true);
        expect(applyCloakToggle(true, cloak).next).toBe(false);
    });

    it('is a no-op when the ship cannot cloak', () => {
        const cloak = capability({ canCloak: false });
        expect(applyCloakToggle(false, cloak).next).toBe(false);
    });

    it('requests a shield drop only when activating a drops-shields cloak', () => {
        const cloak = capability({ dropsShieldsOnActivate: true });
        expect(applyCloakToggle(false, cloak).dropShields).toBe(true);  // on
        expect(applyCloakToggle(true, cloak).dropShields).toBe(false);  // off
        const noDrop = capability({ dropsShieldsOnActivate: false });
        expect(applyCloakToggle(false, noDrop).dropShields).toBe(false);
    });
});

describe('applyCloakDrain', () => {
    it('drains shields per second while cloaked', () => {
        const shield: ShieldLike = { current: 100, min: -5 };
        const cloak = capability({ shieldPerSecond: 4 });
        const active = applyCloakDrain(true, cloak, 0.5, shield);
        expect(shield.current).toBe(98); // 100 - 4 * 0.5
        expect(active).toBe(true);
    });

    it('does nothing when not cloaked', () => {
        const shield: ShieldLike = { current: 100, min: 0 };
        const cloak = capability({ shieldPerSecond: 4 });
        expect(applyCloakDrain(false, cloak, 1, shield)).toBe(false);
        expect(shield.current).toBe(100);
    });

    it('decloaks and clamps when shields hit the floor', () => {
        const shield: ShieldLike = { current: 1, min: 0 };
        const cloak = capability({ shieldPerSecond: 8 });
        const active = applyCloakDrain(true, cloak, 1, shield); // 1 - 8 -> floor
        expect(active).toBe(false);
        expect(shield.current).toBe(0);
    });

    it('stays cloaked with no drain bits set', () => {
        const shield: ShieldLike = { current: 100, min: 0 };
        const cloak = capability({ shieldPerSecond: 0, fuelPerSecond: 0 });
        expect(applyCloakDrain(true, cloak, 10, shield)).toBe(true);
        expect(shield.current).toBe(100);
    });

    it('drains fuel per second while cloaked', () => {
        const fuel: ShieldLike = { current: 100, min: 0 };
        const cloak = capability({ fuelPerSecond: 2 });
        const active = applyCloakDrain(true, cloak, 3, undefined, fuel);
        expect(fuel.current).toBe(94); // 100 - 2 * 3
        expect(active).toBe(true);
    });

    it('decloaks and clamps when fuel runs out', () => {
        const fuel: ShieldLike = { current: 1, min: 0 };
        const cloak = capability({ fuelPerSecond: 8 });
        const active = applyCloakDrain(true, cloak, 1, undefined, fuel);
        expect(active).toBe(false);
        expect(fuel.current).toBe(0);
    });

    it('decloaks immediately when a fuel-draining cloak has no fuel stat', () => {
        const cloak = capability({ fuelPerSecond: 8 });
        expect(applyCloakDrain(true, cloak, 1, undefined, undefined)).toBe(false);
    });

    it('drains both shields and fuel when both bits are set', () => {
        const shield: ShieldLike = { current: 100, min: 0 };
        const fuel: ShieldLike = { current: 100, min: 0 };
        const cloak = capability({ shieldPerSecond: 4, fuelPerSecond: 2 });
        const active = applyCloakDrain(true, cloak, 1, shield, fuel);
        expect(shield.current).toBe(96);
        expect(fuel.current).toBe(98);
        expect(active).toBe(true);
    });
});

describe('applyDecloakOnHit', () => {
    it('decloaks on hit when the deactivates-when-hit bit is set', () => {
        const cloak = capability({ deactivatesWhenHit: true });
        expect(applyDecloakOnHit(true, cloak)).toBe(false);
    });

    it('stays cloaked on hit when the bit is clear', () => {
        const cloak = capability({ deactivatesWhenHit: false });
        expect(applyDecloakOnHit(true, cloak)).toBe(true);
    });

    it('leaves an already-decloaked ship decloaked', () => {
        const cloak = capability({ deactivatesWhenHit: true });
        expect(applyDecloakOnHit(false, cloak)).toBe(false);
    });
});

describe('cloak targeting exclusion', () => {
    it('isCloaked/isTargetable reflect the active flag', () => {
        expect(isCloaked(undefined)).toBe(false);
        expect(isCloaked({ active: false })).toBe(false);
        expect(isCloaked({ active: true })).toBe(true);
        expect(isTargetable(undefined)).toBe(true);
        expect(isTargetable({ active: true })).toBe(false);
    });

    it('a cloaked ship is untargetable by a plain ship', () => {
        expect(isTargetable({ active: true }, undefined)).toBe(false);
    });

    it('a cloaked ship is targetable by a scanner that targets cloaked ships', () => {
        const scanner = scannerCapability({ targetsCloaked: true });
        expect(isTargetable({ active: true }, scanner)).toBe(true);
    });

    it('a scanner without the targets-cloaked bit does not help', () => {
        const scanner = scannerCapability({ targetsCloaked: false, revealsOnRadar: true });
        expect(isTargetable({ active: true }, scanner)).toBe(false);
    });

    it('an uncloaked ship is targetable regardless of scanner', () => {
        expect(isTargetable(undefined, undefined)).toBe(true);
        expect(isTargetable({ active: false }, scannerCapability())).toBe(true);
    });

    it('getValidTargets drops cloaked ships and yourself', () => {
        const self = 'me';
        const targets: Array<readonly [string, unknown, { active: boolean } | undefined]> = [
            ['me', {}, undefined],                 // self: excluded
            ['visible', {}, undefined],            // uncloaked: included
            ['also-visible', {}, { active: false }], // has state, not cloaked
            ['ghost', {}, { active: true }],       // cloaked: excluded
        ];
        expect(getValidTargets(targets, self)).toEqual(['visible', 'also-visible']);
    });
});

describe('deriveCloakScanner', () => {
    it('reports hasScanner false with no scanner outfits', () => {
        const outfits: OutfitsState = new Map([['nova:1', { count: 1 }]]);
        const result = deriveCloakScanner(outfits,
            mockGameData({ 'nova:1': plainOutfit('nova:1') }));
        expect(result?.hasScanner).toBe(false);
    });

    it('derives the scanner capability from a scanner outfit', () => {
        const outfits: OutfitsState = new Map([['s', { count: 1 }]]);
        const result = deriveCloakScanner(outfits,
            mockGameData({ s: scannerOutfit('s', 0x0009) })); // radar + targets cloaked
        expect(result?.hasScanner).toBe(true);
        expect(result?.revealsOnRadar).toBe(true);
        expect(result?.targetsCloaked).toBe(true);
        expect(result?.revealsOnScreen).toBe(false);
    });

    it('ORs bits across multiple scanners', () => {
        const outfits: OutfitsState = new Map([
            ['a', { count: 1 }], // 0x0001 radar
            ['b', { count: 1 }], // 0x0008 targets cloaked
        ]);
        const result = deriveCloakScanner(outfits, mockGameData({
            a: scannerOutfit('a', 0x0001),
            b: scannerOutfit('b', 0x0008),
        }));
        expect(result?.revealsOnRadar).toBe(true);
        expect(result?.targetsCloaked).toBe(true);
    });

    it('returns undefined when outfit data is not cached yet', () => {
        const outfits: OutfitsState = new Map([['missing', { count: 1 }]]);
        const result = deriveCloakScanner(outfits, mockGameData({ missing: undefined }));
        expect(result).toBeUndefined();
    });
});
