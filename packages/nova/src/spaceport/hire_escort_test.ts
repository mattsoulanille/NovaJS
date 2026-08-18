import 'jasmine';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { hirePrice, NO_SHIPS_FOR_HIRE } from './hire_escort.js';

function makeShip(ship: Partial<ShipData>): ShipData {
    return { ...getDefaultShipData(), ...ship };
}

describe('hirePrice', () => {
    it('charges 10% of the ship price', () => {
        // The reference screenshot: a 300,000 cr Thunderhead hires
        // for 30,000 cr.
        expect(hirePrice(makeShip({ price: 300_000 }))).toEqual(30_000);
        expect(hirePrice(makeShip({ price: 17_500 }))).toEqual(1_750);
    });
});

/**
 * Matthew's item 6: hiring with nothing available shows a dialog saying
 * so, instead of an empty shipyard grid.
 */
describe('NO_SHIPS_FOR_HIRE', () => {
    it("is stock Nova's own wording, verbatim", () => {
        // STR# 2002 ("misc strings") index 223, Nova Data 5.ndat. Its
        // sibling at 222 is the shipyard's
        // "There are no ships available for purchase here." — note the
        // hire string has NO trailing "here".
        expect(NO_SHIPS_FOR_HIRE)
            .toBe('There are no ships available for hire.');
    });
});
