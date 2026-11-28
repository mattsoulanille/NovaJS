/**
 * Credit formatting for the spaceport's price readouts, shared by the
 * outfitter and the shipyard so the two panes cannot drift apart. Kept
 * free of PIXI so the content functions that use it stay unit-testable.
 */

function addCommas(p: number) {
    return p.toLocaleString('en-US');
}

const MILLION = 1_000_000;

/**
 * A credit amount as the spaceport panes print it: "10,000 cr" below a
 * million, and "1.500M cr" at or above it — three digits of millions
 * fraction, TRUNCATED (never rounded up: a pane must not show more money
 * than the player has, or "Can't afford this item!" reads as a lie).
 *
 * The fraction is the thousands digit group, zero-padded on the LEFT:
 * 1,092,513 is "1.092M cr". It used to be the remainder's leading digits
 * with the zeros dropped ("1.925M cr" for 1,092,513 — almost twice the
 * balance the status bar and the afford check were using; Matthew's
 * 2026-11-27 playtest).
 */
export function formatPrice(p: number) {
    const whole = Math.floor(p);
    if (whole >= MILLION) {
        const thousandths = Math.floor((whole % MILLION) / 1000);
        return addCommas(Math.floor(whole / MILLION)) + "."
            + String(thousandths).padStart(3, "0") + "M cr";
    }
    return addCommas(p) + " cr";
};
