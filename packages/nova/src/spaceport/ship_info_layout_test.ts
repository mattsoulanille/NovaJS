import 'jasmine';
import { SHIP_INFO_PICT_AREA, shipInfoPictPlacement } from './ship_info.js';

/**
 * The ship-info dialog's picture well, against the original-hardware
 * captures ui_screenshots/original_macos_screenshots/shipyard/
 * {shuttle,heavy_shuttle,ida_frigate}_info.png (1920x1080, dialog centred,
 * so screen = centre-anchored + (960, 540)). In all three the 600x400 info
 * PICT is blitted 1:1 at screen x 660..1259, y 278..677, flush against the
 * frame bevel's 3px inner shadow. Before this was pinned, the picture was
 * scaled to 590 wide (0.983) and centred 3.5px low, leaving a black gap
 * inside the bevel on the left and top.
 */
describe('ship info picture well', () => {
    const toScreen = (x: number, y: number) => ({ x: x + 960, y: y + 540 });

    it('is the 600x400 opening at screen (660, 278)', () => {
        expect(toScreen(SHIP_INFO_PICT_AREA.x, SHIP_INFO_PICT_AREA.y))
            .toEqual({ x: 660, y: 278 });
        expect(SHIP_INFO_PICT_AREA.width).toBe(600);
        expect(SHIP_INFO_PICT_AREA.height).toBe(400);
    });

    it('blits a stock 600x400 info PICT 1:1, filling the well exactly', () => {
        const place = shipInfoPictPlacement(600, 400);
        expect(place.scale).toBe(1);
        expect(toScreen(place.x, place.y)).toEqual({ x: 660, y: 278 });
    });

    it('centres a smaller picture (the 200x200 browse fallback) unscaled',
        () => {
            const place = shipInfoPictPlacement(200, 200);
            expect(place.scale).toBe(1);
            expect(toScreen(place.x, place.y)).toEqual({ x: 860, y: 378 });
        });

    it('keeps an odd-sized picture on whole pixels', () => {
        const place = shipInfoPictPlacement(201, 151);
        expect(Number.isInteger(place.x)).toBeTrue();
        expect(Number.isInteger(place.y)).toBeTrue();
    });

    it('scales oversized plug-in art down to fit, never past the well', () => {
        const place = shipInfoPictPlacement(1200, 600);
        expect(place.scale).toBe(0.5);
        expect(toScreen(place.x, place.y)).toEqual({ x: 660, y: 328 });
        expect(1200 * place.scale).toBeLessThanOrEqual(600);
        expect(600 * place.scale).toBeLessThanOrEqual(400);
    });
});
