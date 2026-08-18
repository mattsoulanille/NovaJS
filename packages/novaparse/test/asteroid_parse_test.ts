import "jasmine";
import { debrisSpinFor } from "../src/parsers/asteroid_parse.js";

/**
 * The mini-asteroid spïn a mined röid's resource-boxes are drawn with:
 * spïn 501-504 by röid family (blocks of four from röid 128), never spïn
 * 500 "Boxes", which is a ship's jettisoned-cargo crate.
 */
describe("debrisSpinFor", () => {
    it("maps the stock röid families onto spïn 501-504 in id order", () => {
        // Metal 128-131 -> 501 "Micro Metal"
        for (const id of [128, 129, 130, 131]) {
            expect(debrisSpinFor(id)).toBe(501);
        }
        // Ice 132-135 -> 502 "Micro Ice"
        for (const id of [132, 133, 134, 135]) {
            expect(debrisSpinFor(id)).toBe(502);
        }
        // Dust 136-139 -> 503 "Micro Silicates"
        expect(debrisSpinFor(136)).toBe(503);
        expect(debrisSpinFor(139)).toBe(503);
        // Crystal 140-143 -> 504
        expect(debrisSpinFor(140)).toBe(504);
        expect(debrisSpinFor(143)).toBe(504);
    });

    it("never yields the cargo-box spïn 500 and clamps out-of-range röids", () => {
        for (let id = 128; id <= 143; id++) {
            expect(debrisSpinFor(id)).not.toBe(500);
        }
        // Plug-in röids past the four stock families keep the last one.
        expect(debrisSpinFor(144)).toBe(504);
        expect(debrisSpinFor(200)).toBe(504);
        expect(debrisSpinFor(100)).toBe(501);
    });
});
