import 'jasmine';
import {
    advanceWeaponFlash, applyIonizationTint, continuousRawSet, foldSetIndex,
    IONIZATION_TINTED_LAYERS, weapDecayAlphaPerSecond,
} from './ship_animation_plugin.js';

// The stock folding ship (Argosy nova:138 -> rlëD nova:1020) has SIX
// base sets of 36 frames, as does the Asteroid Miner from the
// extra-outfits plug-in (extra-outfits:807 -> rlëD nova:1128). These
// are pure-math specs, so they take the set count as a literal rather
// than reading game data.
const STOCK_FOLD_SETS = 6;

describe('foldSetIndex (fold progress -> base sprite set)', () => {
    // PINNED TO THE ACTUAL ART. Frame 0 (heading up) of each of the six
    // sets was decoded out of both ships' rlëD sheets and inspected: set 0
    // is the fully DEPLOYED pose (Argosy nacelles splayed out; miner claws
    // swept wide open) and set 5 is the folded rest pose (nacelles tucked
    // flush to the hull; claws wrapped tight against the body). The Bible
    // never says which end of a fold sequence is which, so this direction
    // is ground truth from the sprites, not from the docs. If this test
    // ever "fails" the art has not changed — the mapping has.
    it('shows the LAST set at rest (folded): nacelles in, claws wrapped', () => {
        expect(foldSetIndex(0, STOCK_FOLD_SETS)).toBe(STOCK_FOLD_SETS - 1);
    });

    it('shows set 0 fully unfolded: nacelles out, claws open to fire', () => {
        expect(foldSetIndex(1, STOCK_FOLD_SETS)).toBe(0);
    });

    it('maps intermediate progress linearly, running set N -> set 0', () => {
        // 6 sets -> 5 gaps, traversed in reverse: progress p -> (1-p)*5.
        expect(foldSetIndex(0.2, 6)).toBe(4); // 4.0
        expect(foldSetIndex(0.4, 6)).toBe(3); // 3.0
        expect(foldSetIndex(0.5, 6)).toBe(3); // 2.5 -> 3 (round-half-up)
        expect(foldSetIndex(0.8, 6)).toBe(1); // 1.0
    });

    it('is monotonically non-increasing in progress', () => {
        let previous = foldSetIndex(0, STOCK_FOLD_SETS);
        for (let p = 0; p <= 1.0001; p += 0.05) {
            const index = foldSetIndex(p, STOCK_FOLD_SETS);
            expect(index).toBeLessThanOrEqual(previous);
            previous = index;
        }
    });

    it('clamps out-of-range progress into [0, baseSetCount-1]', () => {
        expect(foldSetIndex(-1, 6)).toBe(5);
        expect(foldSetIndex(2, 6)).toBe(0);
    });

    it('degenerates safely for a single-set (or empty) sheet', () => {
        expect(foldSetIndex(0, 1)).toBe(0);
        expect(foldSetIndex(1, 1)).toBe(0);
        expect(foldSetIndex(0.5, 0)).toBe(0);
    });
});

describe('weapDecayAlphaPerSecond (shän WeapDecay -> alpha/second)', () => {
    it('reads WeapDecay as percent of full alpha per 30ths-of-a-second frame', () => {
        // 100 => a full fade in one frame.
        expect(weapDecayAlphaPerSecond(100)).toBe(30);
        // The Bible's "good median" 50 => two frames (~67 ms).
        expect(weapDecayAlphaPerSecond(50)).toBe(15);
    });

    it('makes lower numbers decay slower (the Bible\'s stated direction)', () => {
        expect(weapDecayAlphaPerSecond(5))
            .toBeLessThan(weapDecayAlphaPerSecond(50));
        // 5 is the most common stock value (Fed Destroyer family, incl. the
        // Fed Carrier nova:214): 20 frames, ~0.67 s to fade out.
        expect(1 / weapDecayAlphaPerSecond(5)).toBeCloseTo(0.6667, 4);
    });

    it('treats 0 and negatives as no decay at all', () => {
        expect(weapDecayAlphaPerSecond(0)).toBe(0);
        expect(weapDecayAlphaPerSecond(-1)).toBe(0);
    });
});

describe('advanceWeaponFlash (weapon overlay trigger + decay)', () => {
    it('snaps to fully opaque while firing', () => {
        expect(advanceWeaponFlash(0, true, 15, 1 / 60)).toBe(1);
        expect(advanceWeaponFlash(0.3, true, 15, 1 / 60)).toBe(1);
    });

    it('decays linearly once firing stops', () => {
        const rate = weapDecayAlphaPerSecond(5); // 1.5 alpha/s
        expect(advanceWeaponFlash(1, false, rate, 0.1)).toBeCloseTo(0.85, 6);
        expect(advanceWeaponFlash(0.85, false, rate, 0.1)).toBeCloseTo(0.7, 6);
    });

    it('reaches exactly transparent and never goes negative', () => {
        expect(advanceWeaponFlash(0.1, false, 15, 1)).toBe(0);
        expect(advanceWeaponFlash(0, false, 15, 1)).toBe(0);
    });

    it('takes 1/rate seconds to fade from a full flash', () => {
        const rate = weapDecayAlphaPerSecond(50); // 15 alpha/s -> 1/15 s
        let alpha = advanceWeaponFlash(0, true, rate, 1 / 60);
        let frames = 0;
        while (alpha > 0 && frames < 1000) {
            alpha = advanceWeaponFlash(alpha, false, rate, 1 / 60);
            frames++;
        }
        expect(alpha).toBe(0);
        expect(frames).toBe(4); // 1/15 s at 60 fps
    });

    it('snaps straight off when WeapDecay is 0 (no fade)', () => {
        expect(advanceWeaponFlash(1, false, weapDecayAlphaPerSecond(0), 1 / 60))
            .toBe(0);
    });
});

describe('continuousRawSet (spin phase -> raw set index)', () => {
    it('advances setsPerSecond sets each second', () => {
        // 6 sets/second: at t=0 set 0, at t=1000ms set 6 (before mod).
        expect(continuousRawSet(0, 6)).toBe(0);
        expect(continuousRawSet(1000, 6)).toBe(6);
        expect(continuousRawSet(500, 6)).toBe(3);
    });

    it('is monotonic and floors within a set interval', () => {
        // A set lasts 1/6 s ~= 166.7ms; anything inside it holds one index.
        expect(continuousRawSet(100, 6)).toBe(0);
        expect(continuousRawSet(166, 6)).toBe(0);
        expect(continuousRawSet(167, 6)).toBe(1);
    });

    it('composes with rotation via a per-sheet modulo', () => {
        // The Manticore base image holds 3 sets; the raw index wraps.
        const raw = continuousRawSet(1000, 6); // 6
        expect(raw % 3).toBe(0);
        expect(continuousRawSet(1167, 6) % 3).toBe(7 % 3); // 1
    });
});

/**
 * A ship is drawn as a stack of shän sprite layers, and the ionization
 * colour has to reach the ones the ship's structure is actually made of.
 * The Aurora Thunderforge (shän nova:380) is the case that exposed it:
 * its base image is only the fore and aft sections, the whole spinning
 * drum between them is the alt image, and tinting only the base left the
 * middle of an ionized ship its normal colour.
 */
describe('applyIonizationTint (which sprite layers take the ion colour)', () => {
    const IONIZED_GREY = 0x888888;
    const NO_TINT = 0xffffff;

    // Stand-ins for SpriteSheetSprite: only `.pixiSprite.tint` matters.
    function fakeSprites(...layers: string[]) {
        return new Map(layers.map(
            layer => [layer, { pixiSprite: { tint: NO_TINT } }]));
    }
    const tints = (sprites: ReturnType<typeof fakeSprites>) =>
        Object.fromEntries([...sprites].map(
            ([layer, sprite]) => [layer, sprite.pixiSprite.tint]));

    it('tints the alt image along with the base image', () => {
        const sprites = fakeSprites('baseImage', 'altImage');
        applyIonizationTint(sprites, true, IONIZED_GREY);
        expect(tints(sprites))
            .toEqual({ baseImage: IONIZED_GREY, altImage: IONIZED_GREY });
    });

    it('leaves the additive effect layers untinted', () => {
        // glow/light/weap are BLEND_MODES.ADD overlays: light the ship
        // emits, not a surface of it. Tinting them would dim that light.
        const sprites = fakeSprites(
            'baseImage', 'glowImage', 'lightImage', 'weapImage',
            'shieldImage');
        applyIonizationTint(sprites, true, IONIZED_GREY);
        expect(tints(sprites)).toEqual({
            baseImage: IONIZED_GREY,
            glowImage: NO_TINT,
            lightImage: NO_TINT,
            weapImage: NO_TINT,
            shieldImage: NO_TINT,
        });
    });

    it('clears the tint off every structural layer when not ionized', () => {
        const sprites = fakeSprites('baseImage', 'altImage');
        applyIonizationTint(sprites, true, IONIZED_GREY);
        applyIonizationTint(sprites, false, IONIZED_GREY);
        expect(tints(sprites))
            .toEqual({ baseImage: NO_TINT, altImage: NO_TINT });
    });

    it('drops the alpha byte of the ion colour', () => {
        // wëap IonizeColor is stored like an HTML colour; PIXI tints are
        // RGB only.
        const sprites = fakeSprites('baseImage');
        applyIonizationTint(sprites, true, 0xff112233);
        expect(tints(sprites)).toEqual({ baseImage: 0x112233 });
    });

    it('does nothing for a layer the ship does not have', () => {
        const sprites = fakeSprites('baseImage');
        expect(() => applyIonizationTint(sprites, true, IONIZED_GREY))
            .not.toThrow();
        expect(IONIZATION_TINTED_LAYERS).toContain('altImage');
    });
});
