import "jasmine";
import {
    buttonRowY,
    CAPTURE_FRAME,
    COMM_ESCORT,
    COMM_HAGGLE,
    COMM_PLANET,
    COMM_SHIP,
    commButtonSlots,
    fitImage,
    frameOrigin,
    PLUNDER_BUTTONS,
    PLUNDER_FRAME,
} from './hail_layout.js';
import { frameFor } from './hail_dialog.js';

/**
 * These pin the measurements taken off the original-hardware captures, so a
 * later edit that "tidies" a constant has to argue with the screenshot it
 * came from. Each expectation names the reference it was read on.
 */
describe('frameOrigin', () => {
    it('lands every measured frame on its reference pixel', () => {
        // The original blits a centred frame at round((1920-w)/2); on a
        // 1920x1080 screen that is 960 - floor(w/2), 540 - floor(h/2).
        const at = (w: number, h: number) => {
            const o = frameOrigin(w, h);
            return { x: 960 + o.x, y: 540 + o.y };
        };
        // 8511 on hail/hail.png.
        expect(at(423, 215)).toEqual({ x: 749, y: 433 });
        // 8512 on hail/hail_planet.png.
        expect(at(540, 295)).toEqual({ x: 690, y: 393 });
        // 8513 on hail/hail_escort.png.
        expect(at(424, 259)).toEqual({ x: 748, y: 411 });
        // 8514 on hail/beg_mercy.png.
        expect(at(262, 107)).toEqual({ x: 829, y: 487 });
        // 8515 on space/board_ship.png.
        expect(at(309, 198)).toEqual({ x: 806, y: 441 });
        // The 8518/8519/8520 stack on every p_properties capture.
        expect(at(413, 227)).toEqual({ x: 754, y: 427 });
    });

    it('always returns whole pixels', () => {
        // Odd-sized frames are the reason this exists: -w/2 would put the
        // art on a half pixel and drag its glyphs a pixel left.
        for (const [w, h] of [[423, 215], [309, 198], [413, 227]]) {
            const o = frameOrigin(w, h);
            expect(Number.isInteger(o.x)).toBe(true);
            expect(Number.isInteger(o.y)).toBe(true);
        }
    });
});

describe('comm frame layouts', () => {
    it('matches the PICT art sizes', () => {
        expect([COMM_SHIP.width, COMM_SHIP.height]).toEqual([423, 215]);
        expect([COMM_PLANET.width, COMM_PLANET.height]).toEqual([540, 295]);
        expect([COMM_ESCORT.width, COMM_ESCORT.height]).toEqual([424, 259]);
        expect([COMM_HAGGLE.width, COMM_HAGGLE.height]).toEqual([262, 107]);
        expect([PLUNDER_FRAME.width, PLUNDER_FRAME.height]).toEqual([309, 198]);
        expect([CAPTURE_FRAME.width, CAPTURE_FRAME.height]).toEqual([267, 128]);
    });

    it('keeps every well and pane inside its frame', () => {
        for (const f of [COMM_SHIP, COMM_PLANET, COMM_ESCORT, COMM_HAGGLE]) {
            for (const r of [f.responseWell, f.infoWell, f.imagePane]) {
                if (!r) {
                    continue;
                }
                expect(r.x).toBeGreaterThanOrEqual(0);
                expect(r.y).toBeGreaterThanOrEqual(0);
                expect(r.x + r.width).toBeLessThanOrEqual(f.width);
                expect(r.y + r.height).toBeLessThanOrEqual(f.height);
            }
        }
    });

    it('puts the text pens inside the wells they belong to', () => {
        for (const f of [COMM_SHIP, COMM_PLANET, COMM_ESCORT, COMM_HAGGLE]) {
            expect(f.responseText.x)
                .toBeGreaterThanOrEqual(f.responseWell.x);
            // The pen is quoted as ink minus INK_TO_BOX, so it may sit a
            // couple of pixels above the well's top edge.
            expect(f.responseText.y)
                .toBeGreaterThanOrEqual(f.responseWell.y - 4);
            if (f.infoWell) {
                expect(f.infoText.x).toBeGreaterThanOrEqual(f.infoWell.x);
                expect(f.infoText.y)
                    .toBeGreaterThanOrEqual(f.infoWell.y - 4);
            }
        }
    });

    it('reproduces the reference button rows', () => {
        // hail/hail.png: three pills at frame y 125 / 153 / 181, x=21.
        expect([0, 1, 2].map(i => buttonRowY(COMM_SHIP, i)))
            .toEqual([125, 153, 181]);
        expect(COMM_SHIP.buttonX).toBe(21);
        // hail/hail_escort.png: four at 141 / 169 / 197 / 225.
        expect([0, 1, 2, 3].map(i => buttonRowY(COMM_ESCORT, i)))
            .toEqual([141, 169, 197, 225]);
        // hail/hail_planet.png: three at 184 / 214 / 244 (30px pitch).
        expect([0, 1, 2].map(i => buttonRowY(COMM_PLANET, i)))
            .toEqual([184, 214, 244]);
        // hail/beg_mercy.png: two at 39 / 74 (35px pitch).
        expect([0, 1].map(i => buttonRowY(COMM_HAGGLE, i))).toEqual([39, 74]);
    });

    it('keeps the last button row inside the frame', () => {
        const rows = new Map([[COMM_SHIP, 3], [COMM_PLANET, 3],
            [COMM_ESCORT, 4], [COMM_HAGGLE, 2]]);
        for (const [frame, n] of rows) {
            // Button sprites are 25 tall.
            expect(buttonRowY(frame, n - 1) + 25)
                .toBeLessThanOrEqual(frame.height);
        }
    });
});

describe('frameFor', () => {
    it('picks the frame each variant is drawn on', () => {
        expect(frameFor('main', 'ship')).toBe(COMM_SHIP);
        expect(frameFor('main', 'planet')).toBe(COMM_PLANET);
        expect(frameFor('main', 'escort')).toBe(COMM_ESCORT);
    });

    it('uses the haggle frame on the haggle page whatever the variant', () => {
        expect(frameFor('haggle', 'ship')).toBe(COMM_HAGGLE);
        expect(frameFor('haggle', 'planet')).toBe(COMM_HAGGLE);
    });
});

describe('commButtonSlots', () => {
    it('always opens with Greetings and ends with Close Channel', () => {
        // Every ship/planet reference shows Greetings on the top row —
        // NovaJS used to draw no Greetings button at all.
        for (const context of [{}, { assist: { free: false } },
            { bribe: { amount: 1 } }]) {
            const slots = commButtonSlots('ship', context);
            expect(slots[0]).toBe('greetings');
            expect(slots[slots.length - 1]).toBe('close');
        }
    });

    it('fills the offer slot with the offer that exists', () => {
        // request_assistance.png.
        expect(commButtonSlots('ship', { assist: { free: false } }))
            .toEqual(['greetings', 'assist', 'close']);
        // hail_hostile.png.
        expect(commButtonSlots('ship', { bribe: { amount: 20000 } }))
            .toEqual(['greetings', 'beg', 'close']);
    });

    it('offers Beg For Mercy to a hostile ship that will not be bought',
        () => {
            // Ruling #297: every IFF-hostile ship shows Beg For Mercy in
            // place of Request Assistance; whether the plea is priced or
            // refused is the press's business.
            expect(commButtonSlots('ship', { mercyRefused: 'No way.' }))
                .toEqual(['greetings', 'beg', 'close']);
        });

    it('prefers assistance over a bribe when somehow both are offered', () => {
        expect(commButtonSlots('ship',
            { assist: { free: true }, bribe: { amount: 1 } })[1])
            .toBe('assist');
    });

    it('drops the middle row when nothing is on offer', () => {
        expect(commButtonSlots('ship', {})).toEqual(['greetings', 'close']);
    });

    it('gives the planet comm its Demand Tribute row', () => {
        // hail_planet.png: Greetings / Demand Tribute / Close Channel. The
        // tribute row is a greyed seam, but it must still occupy the second
        // row so Close Channel stays on the reference's third.
        expect(commButtonSlots('planet', {}))
            .toEqual(['greetings', 'tribute', 'close']);
    });

    it('turns the planet\'s middle row into Offer Bribe when a shut port '
        + 'will bargain', () => {
            // hail_planet.png is a FRIENDLY Earth, so it shows the tribute
            // seam; a port refusing clearance puts its price in the same slot,
            // the way a hostile ship's slot becomes Beg For Mercy. Close
            // Channel still lands on the reference's third row.
            expect(commButtonSlots('planet', { bribe: { amount: 3000 } }))
                .toEqual(['greetings', 'bribe', 'close']);
        });
});

describe('fitImage', () => {
    it('centres a picture in its pane', () => {
        // 8511's pane is 207x202 at frame (211,6); a 200x200 ship pict.
        const fit = fitImage(COMM_SHIP.imagePane!, 200, 200);
        expect(fit.x).toBe(211 + 207 / 2);
        expect(fit.y).toBe(6 + 202 / 2);
    });

    it('never upscales a picture smaller than the pane', () => {
        expect(fitImage(COMM_SHIP.imagePane!, 200, 200).scale).toBe(1);
        expect(fitImage(COMM_SHIP.imagePane!, 64, 64).scale).toBe(1);
    });

    it('scales an oversized picture down to fit both axes', () => {
        // 8512's pane is 314x285: a 628x400 picture is limited by width.
        const fit = fitImage(COMM_PLANET.imagePane!, 628, 400);
        expect(fit.scale).toBeCloseTo(314 / 628, 6);
        expect(628 * fit.scale).toBeLessThanOrEqual(314);
        expect(400 * fit.scale).toBeLessThanOrEqual(285);
    });

    it('survives a zero-sized picture', () => {
        expect(fitImage(COMM_SHIP.imagePane!, 0, 0).scale).toBe(1);
    });
});

describe('PLUNDER_BUTTONS', () => {
    it('reproduces board_ship.png row for row', () => {
        // Energy / Cargo / Ammo across the top, Credits + Capture Ship
        // below, then a centred Abort — the sprite lefts and widths were
        // template-matched against the reference's cap sprites.
        expect(PLUNDER_BUTTONS.map(b => [b.label, b.x, b.y, b.width]))
            .toEqual([
                ['Energy', 16, 110, 63],
                ['Cargo', 110, 110, 63],
                ['Ammo', 204, 110, 63],
                ['Credits', 35, 138, 63],
                ['Capture Ship', 129, 138, 120],
                ['Abort', 91, 166, 100],
            ]);
    });

    it('keeps every pill inside the frame', () => {
        for (const b of PLUNDER_BUTTONS) {
            expect(b.x + b.width + 26)
                .toBeLessThanOrEqual(PLUNDER_FRAME.width);
            expect(b.y + 25).toBeLessThanOrEqual(PLUNDER_FRAME.height);
        }
    });

    it('centres Abort under the grid', () => {
        const abort = PLUNDER_BUTTONS.find(b => b.label === 'Abort')!;
        const centre = abort.x + (abort.width + 26) / 2;
        expect(centre).toBeCloseTo(PLUNDER_FRAME.width / 2, 0);
    });

    it('centres the capture-assignment pills in their frame', () => {
        const centre = CAPTURE_FRAME.buttonX
            + (CAPTURE_FRAME.buttonWidth + 26) / 2;
        expect(centre).toBeCloseTo(CAPTURE_FRAME.width / 2, 0);
    });
});
