import 'jasmine';
import { beamShrinkFraction } from './beam_display_plugin.js';

const FRAME = 1000 / 30;

/** wëap Decay for beams: shrink over the Count + 16 - CoronaFalloff tail. */
describe('beamShrinkFraction', () => {
    // Pulse Laser: Count 15 (damage window), 31 frames on screen.
    const COUNT = 15 * FRAME;
    const ON_SCREEN = 31 * FRAME;

    it('is full length for the whole Count', () => {
        expect(beamShrinkFraction(100, COUNT, ON_SCREEN, 0)).toEqual(1);
        expect(beamShrinkFraction(100, COUNT, ON_SCREEN, COUNT - 1)).toEqual(1);
        expect(beamShrinkFraction(100, COUNT, ON_SCREEN, COUNT)).toEqual(1);
    });

    it('shrinks linearly to nothing over the tail', () => {
        const tail = ON_SCREEN - COUNT;
        expect(beamShrinkFraction(100, COUNT, ON_SCREEN, COUNT + tail / 4))
            .toBeCloseTo(0.75, 9);
        expect(beamShrinkFraction(100, COUNT, ON_SCREEN, COUNT + tail / 2))
            .toBeCloseTo(0.5, 9);
        expect(beamShrinkFraction(100, COUNT, ON_SCREEN, ON_SCREEN)).toEqual(0);
        expect(beamShrinkFraction(100, COUNT, ON_SCREEN, ON_SCREEN + 5)).toEqual(0);
    });

    it('never shrinks a beam without Decay', () => {
        expect(beamShrinkFraction(0, COUNT, COUNT, COUNT * 2)).toEqual(1);
        // A missing decay (older data) reads as none.
        expect(beamShrinkFraction(undefined as unknown as number, COUNT, ON_SCREEN, ON_SCREEN))
            .toEqual(1);
    });

    it('never shrinks a beam with no tail', () => {
        // Mining Laser: falloff past 16 leaves onScreen == Count.
        expect(beamShrinkFraction(20, COUNT, COUNT, COUNT)).toEqual(1);
    });
});
