import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import {
    deriveIff,
    dispositionColor,
    IFF_FRIENDLY_COLOR,
    IFF_HOSTILE_COLOR,
    IFF_NEUTRAL_COLOR,
    planetBlipColor,
    planetDisposition,
    PLANET_FLAT_COLOR,
    PLANET_FORBIDDEN_COLOR,
    PLANET_HOSTILE_COLOR,
    PLANET_NEUTRAL_COLOR,
    PLANET_UNLANDABLE_COLOR,
    shipBlipColor,
    shipDisposition,
    SHIP_DISABLED_COLOR,
    targetCornerStyle,
} from './iff_plugin.js';
import { OutfitsState } from '../ship/outfit_plugin.js';
import { planetClearance } from './stellar_clearance.js';

function stellar(over: Partial<PlanetData> = {}): PlanetData {
    return { ...getDefaultPlanetData(), ...over };
}

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

function iffOutfit(id: string): OutfitData {
    return { ...getDefaultOutfitData(), id, iff: true };
}

function plainOutfit(id: string): OutfitData {
    return { ...getDefaultOutfitData(), id };
}

function govt(over: Partial<GovtData>): GovtData {
    return { ...getDefaultGovtData(), ...over };
}

describe('deriveIff', () => {
    it('reports hasIff false when the ship owns no IFF outfit', () => {
        const outfits: OutfitsState = new Map([['nova:1', { count: 1 }]]);
        const result = deriveIff(outfits,
            mockGameData({ 'nova:1': plainOutfit('nova:1') }));
        expect(result?.hasIff).toBe(false);
    });

    it('reports hasIff true when an IFF outfit is owned', () => {
        const outfits: OutfitsState = new Map([['nova:185', { count: 1 }]]);
        const result = deriveIff(outfits,
            mockGameData({ 'nova:185': iffOutfit('nova:185') }));
        expect(result?.hasIff).toBe(true);
    });

    it('ignores an IFF outfit with a zero count', () => {
        const outfits: OutfitsState = new Map([['nova:185', { count: 0 }]]);
        const result = deriveIff(outfits,
            mockGameData({ 'nova:185': iffOutfit('nova:185') }));
        expect(result?.hasIff).toBe(false);
    });

    it('returns undefined until the outfit data is cached', () => {
        const outfits: OutfitsState = new Map([['nova:185', { count: 1 }]]);
        const result = deriveIff(outfits, mockGameData({}));
        expect(result).toBeUndefined();
    });
});

describe('shipDisposition', () => {
    it('is neutral for a ship with no government', () => {
        expect(shipDisposition(undefined, undefined)).toBe('neutral');
    });

    it('is hostile when the ship govt always attacks the player', () => {
        const ship = govt({ id: 'nova:200' });
        ship.flags.alwaysAttacksPlayer = true;
        expect(shipDisposition(ship, undefined)).toBe('hostile');
    });

    it('is hostile for a xenophobic govt', () => {
        const ship = govt({ id: 'nova:200' });
        ship.flags.xenophobic = true;
        expect(shipDisposition(ship, undefined)).toBe('hostile');
    });

    it('neverAttacksPlayer overrides alwaysAttacksPlayer', () => {
        const ship = govt({ id: 'nova:200' });
        ship.flags.alwaysAttacksPlayer = true;
        ship.flags.neverAttacksPlayer = true;
        expect(shipDisposition(ship, undefined)).toBe('neutral');
    });

    it('is hostile when the ship govt enemies intersect the player classes', () => {
        const ship = govt({ id: 'nova:200', enemies: [2, 10] });
        const player = govt({ id: 'nova:128', classes: [10] });
        expect(shipDisposition(ship, player)).toBe('hostile');
    });

    it('is friendly when the ship govt allies intersect the player classes', () => {
        const ship = govt({ id: 'nova:200', allies: [1, 12] });
        const player = govt({ id: 'nova:128', classes: [12] });
        expect(shipDisposition(ship, player)).toBe('friendly');
    });

    it('is friendly when ship and player share a government', () => {
        const ship = govt({ id: 'nova:128' });
        const player = govt({ id: 'nova:128', classes: [1] });
        expect(shipDisposition(ship, player)).toBe('friendly');
    });

    it('prefers hostile over friendly when both would apply', () => {
        const ship = govt({ id: 'nova:200', enemies: [10], allies: [10] });
        const player = govt({ id: 'nova:128', classes: [10] });
        expect(shipDisposition(ship, player)).toBe('hostile');
    });

    it('is neutral for an unrelated government', () => {
        const ship = govt({ id: 'nova:200', enemies: [2], allies: [3] });
        const player = govt({ id: 'nova:128', classes: [10] });
        expect(shipDisposition(ship, player)).toBe('neutral');
    });
});

describe('dispositionColor', () => {
    it('maps dispositions to the IFF radar palette', () => {
        expect(dispositionColor('hostile')).toBe(IFF_HOSTILE_COLOR);
        expect(dispositionColor('friendly')).toBe(IFF_FRIENDLY_COLOR);
        expect(dispositionColor('neutral')).toBe(IFF_NEUTRAL_COLOR);
    });
});

describe('shipBlipColor', () => {
    it('leaves every ship flat without an IFF outfit', () => {
        // undefined means "use the status bar's dimRadar colour" — the
        // ïntf-supplied flat colour the radar falls back to.
        for (const d of ['neutral', 'friendly', 'hostile'] as const) {
            expect(shipBlipColor(d, false)).toBeUndefined();
        }
    });

    it('colours by disposition once the player owns IFF', () => {
        expect(shipBlipColor('hostile', true)).toBe(IFF_HOSTILE_COLOR);
        expect(shipBlipColor('friendly', true)).toBe(IFF_FRIENDLY_COLOR);
        expect(shipBlipColor('neutral', true)).toBe(IFF_NEUTRAL_COLOR);
    });

    it('draws a DISABLED ship grey with OR without IFF', () => {
        expect(shipBlipColor('neutral', false, true))
            .toBe(SHIP_DISABLED_COLOR);
        expect(shipBlipColor('neutral', true, true))
            .toBe(SHIP_DISABLED_COLOR);
    });

    it('puts disabled AHEAD of hostile red, and of friendly green', () => {
        // Dead in space trumps every allegiance — the same priority the
        // gray corner set gives it (hostility.ts's styleForTarget).
        expect(shipBlipColor('hostile', true, true))
            .toBe(SHIP_DISABLED_COLOR);
        expect(shipBlipColor('friendly', true, true))
            .toBe(SHIP_DISABLED_COLOR);
        expect(shipBlipColor('hostile', true, true))
            .not.toBe(IFF_HOSTILE_COLOR);
    });

    it('uses the same grey the unlandable stellar blip uses', () => {
        expect(SHIP_DISABLED_COLOR).toBe(0x808080);
        expect(SHIP_DISABLED_COLOR).toBe(PLANET_UNLANDABLE_COLOR);
    });
});

describe('targetCornerStyle', () => {
    it('follows the political disposition when the target is not ' +
        'attacking the player', () => {
            expect(targetCornerStyle('neutral', false)).toBe('neutral');
            expect(targetCornerStyle('friendly', false)).toBe('friendly');
            expect(targetCornerStyle('hostile', false)).toBe('hostile');
        });

    it('a ship attacking the player is hostile regardless of politics ' +
        '(e.g. a brave trader fighting back)', () => {
            expect(targetCornerStyle('neutral', true)).toBe('hostile');
            expect(targetCornerStyle('friendly', true)).toBe('hostile');
            expect(targetCornerStyle('hostile', true)).toBe('hostile');
        });
});

describe('planetDisposition', () => {
    it('reads a cleared stellar as neutral (blue)', () => {
        expect(planetDisposition({ cleared: true })).toBe('neutral');
    });

    it('reads a record-based refusal as hostile (red)', () => {
        expect(planetDisposition({ cleared: false, reason: 'hostile' }))
            .toBe('hostile');
    });

    it('reads a shut port and a missing travel permit as forbidden (orange)',
        () => {
            expect(planetDisposition({ cleared: false, reason: 'forbidden' }))
                .toBe('forbidden');
            expect(planetDisposition({ cleared: false, reason: 'permit' }))
                .toBe('forbidden');
        });

    it('never disagrees with the landing gate: it IS the clearance verdict',
        () => {
            const shut = stellar({ minStatus: 100 });
            expect(planetDisposition(planetClearance({ planet: shut })))
                .toBe('hostile');
            // ...and a bribe turns the same stellar blue.
            expect(planetDisposition(planetClearance({
                planet: shut, bribedUntil: 100, now: 0,
            }))).toBe('neutral');
        });
});

describe('planetBlipColor', () => {
    it('draws every stellar the measured flat yellow without an IFF outfit',
        () => {
            // Sampled off the original-hardware captures: the stationary
            // stellar blip on space/in_space*.png is pure #FFFF00.
            expect(PLANET_FLAT_COLOR).toBe(0xffff00);
            for (const d of ['neutral', 'forbidden', 'hostile'] as const) {
                expect(planetBlipColor(d, false)).toBe(PLANET_FLAT_COLOR);
            }
        });

    it('colours by disposition once the player owns IFF', () => {
        expect(planetBlipColor('neutral', true)).toBe(PLANET_NEUTRAL_COLOR);
        expect(planetBlipColor('forbidden', true)).toBe(PLANET_FORBIDDEN_COLOR);
        expect(planetBlipColor('hostile', true)).toBe(PLANET_HOSTILE_COLOR);
    });

    it('uses the palette Matthew specified: yellow / orange / red / grey',
        () => {
            // Neutral is the SAME yellow the references show, so a landable
            // neutral port looks identical with and without IFF (Matthew's
            // correction, 2026-08-15).
            expect(PLANET_NEUTRAL_COLOR).toBe(0xffff00);
            expect(PLANET_NEUTRAL_COLOR).toBe(PLANET_FLAT_COLOR);
            expect(PLANET_FORBIDDEN_COLOR).toBe(0xff7f00);
            expect(PLANET_HOSTILE_COLOR).toBe(0xff0000);
            expect(PLANET_UNLANDABLE_COLOR).toBe(0x808080);
        });

    it('draws an unlandable stellar (Jupiter) grey with OR without IFF',
        () => {
            expect(planetBlipColor('unlandable', false))
                .toBe(PLANET_UNLANDABLE_COLOR);
            expect(planetBlipColor('unlandable', true))
                .toBe(PLANET_UNLANDABLE_COLOR);
        });
});

describe('planetDisposition: the unlandable tier', () => {
    it('reads unlandable regardless of clearance', () => {
        // The spöb can-land bit (landable.ts) is a fact about the stellar,
        // checked FIRST, so a cleared or a hostile clearance both yield
        // 'unlandable' for Jupiter.
        expect(planetDisposition({ cleared: true }, false)).toBe('unlandable');
        expect(planetDisposition({ cleared: false, reason: 'hostile' }, false))
            .toBe('unlandable');
        expect(planetDisposition({ cleared: true }, true)).toBe('neutral');
    });
});
