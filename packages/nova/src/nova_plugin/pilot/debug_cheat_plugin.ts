import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { System } from 'nova_ecs/system';
import { CreditsComponent } from '../player/index.js';
import { LegalRecordsComponent } from '../reputation/index.js';
import { ControlPlayerWeapons } from '../combat/index.js';
import { CloakControlSystem } from '../ship/index.js';
import { ShipControlEvent, ShipControlStateComponent } from '../player/index.js';

/**
 * ============================================================================
 * Debug cheats (sim side)
 * ============================================================================
 *
 * The status-bar debug buttons (status_bar.ts) drive two developer
 * cheats through the ordinary control-event input path, exactly like
 * the plunder dialog: a button click becomes a synthetic
 * `debugGiveCredits` / `debugClearRecord` control edge (no keybind),
 * which browser.ts forwards to the sim as a control-event input. So the
 * cheat rides input records and replays identically on every peer,
 * mutating only the acting player's own per-player state.
 *
 * The system is edge-triggered on ShipControlEvent (the event the input
 * path emits, targeted at the acting ship), and it acts only on a
 * 'start' edge, so a held/decayed control never re-applies the cheat.
 */

/** Credits granted by the "Give 1M Credits" debug button. */
export const DEBUG_CREDITS_GRANT = 1_000_000;

/**
 * Applies the debug cheats to the acting ship's per-player state.
 * Both components are Optional: only player ships carry Credits /
 * LegalRecords, and the cheats no-op on any other controlled ship.
 */
export const DebugCheatSystem = new System({
    name: 'DebugCheatSystem',
    events: [ShipControlEvent] as const,
    args: [ShipControlStateComponent, Optional(CreditsComponent),
        Optional(LegalRecordsComponent)] as const,
    step(controls, credits, records) {
        if (controls.get('debugGiveCredits') === 'start' && credits) {
            credits.credits += DEBUG_CREDITS_GRANT;
        }
        // "Clear Legal Record": drop every stored per-govt record so each
        // govt reads as its neutral default (InitialRec, 0 for stock
        // govts) again — a previously hostile record (record < -CrimeTol)
        // returns to neutral. Mutated in place like applyCrime's set().
        if (controls.get('debugClearRecord') === 'start' && records) {
            records.clear();
        }
    },
    // #237 pins (shared: ShipControlState; Credits, LegalRecords): among
    // the ShipControlEvent handlers, after combat's weapon controls and
    // before ship's cloak toggle.
    after: [ControlPlayerWeapons],
    before: [CloakControlSystem],
});

export const DebugCheatPlugin: Plugin = {
    name: 'DebugCheatPlugin',
    build(world) {
        world.addSystem(DebugCheatSystem);
    },
    remove(world) {
        world.removeSystem(DebugCheatSystem);
    },
};
