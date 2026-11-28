import * as PIXI from 'pixi.js';

/**
 * Display objects a venue's modal shield lets the pointer through to: the
 * status bar's debug buttons (display/status_bar.ts registers them).
 *
 * The original's spaceport venues are modal — nothing behind one reacts
 * until it is closed — and so are ours (see {@link makeVenueShield}). The
 * status bar is not part of the original's spaceport, though, and the
 * original's has no buttons at all: ours carries NovaJS debug cheats, and
 * "Give 1M Credits" is meant to work with a venue open (the open venue
 * re-reads the balance: Spaceport.creditsChangedOutside, commit 950365a1).
 * So the venue shields stop short of those buttons. The alert-style dialogs
 * (quantity, confirm, prompt) and the player info dialog keep their own
 * full shields, which block the status bar too.
 */
const passThrough = new Set<PIXI.DisplayObject>();

/** Lets the pointer reach `object` through every venue shield. */
export function addShieldPassThrough(object: PIXI.DisplayObject) {
    passThrough.add(object);
}

/** Undoes {@link addShieldPassThrough} (the object is being destroyed). */
export function removeShieldPassThrough(object: PIXI.DisplayObject) {
    passThrough.delete(object);
}

const SHIELD_EXTENT = 8000;

/**
 * A venue's modal shield: an invisible, interactive layer covering the
 * whole screen, placed at the bottom of a landed venue or venue sub-dialog
 * (the outfitter, shipyard, trade center, bar, Mission BBS; the bar's hire
 * and news dialogs, the shipyard's hangar) so a click anywhere outside the
 * venue's frame lands on it and goes no further. Without it only the
 * frame sprite caught the pointer, and the spaceport's buttons left
 * uncovered around a venue still worked: with the outfitter open, the
 * Trade Center button below it opened the trade center on top (Matthew's
 * 2026-11-27 playtest), whose Done then handed the keyboard back to the
 * spaceport UNDER the outfitter.
 *
 * Its hit area excludes the registered pass-through objects (above), so
 * the debug buttons beneath it still take the click.
 */
export function makeVenueShield(name = 'VenueShield'): PIXI.Container {
    const shield = new PIXI.Container();
    shield.name = name;
    shield.eventMode = 'static';
    const global = new PIXI.Point();
    const local = new PIXI.Point();
    shield.hitArea = {
        contains(x: number, y: number): boolean {
            if (Math.abs(x) > SHIELD_EXTENT || Math.abs(y) > SHIELD_EXTENT) {
                return false;
            }
            local.set(x, y);
            shield.worldTransform.apply(local, global);
            for (const object of passThrough) {
                if (object.destroyed || !object.worldVisible) {
                    continue;
                }
                if (object.getBounds().contains(global.x, global.y)) {
                    return false;
                }
            }
            return true;
        },
    };
    return shield;
}
