/**
 * ============================================================================
 * Hyperspace jump readiness — the ONE predicate
 * ============================================================================
 *
 * "Can this ship start a hyperspace jump right now?" is asked in three
 * places, and they must never disagree:
 *
 *  1. THE GATE. PlayerJumpControl (jump_plugin.ts) — the simulation system
 *     that actually attaches the JumpComponent. This is the authority; the
 *     other two only report on it.
 *  2. THE CUE. JumpReadyBeepSystem (display/ui_sound_triggers_plugin.ts)
 *     beeps nova:154 the moment the answer flips to yes, and nova:153 when
 *     the player presses hyperjump while the answer is no.
 *  3. THE READOUT. The status bar's Hyperspace destination is drawn dim
 *     until the answer is yes (display/status_bar.ts).
 *
 * A copy of the fuel/distance arithmetic that drifts from the gate makes the
 * beep and the readout LIE to the player, so all three quote the functions
 * below instead of re-deriving the rule.
 *
 * PURE AND IMPORT-FREE on purpose. It is read from both the simulation
 * (jump_plugin) and the display world, so it pulls in no ECS, no PIXI, and
 * not even the constants: callers pass JUMP_DISTANCE (jump_plugin.ts) and
 * FUEL_PER_JUMP (health_plugin.ts) in, exactly as ui_sound_logic.ts already
 * did. That keeps this module free of any import cycle with the plugin that
 * owns the gate, and keeps it trivially unit-testable.
 *
 * Bible citations for the two numeric conditions live with the constants in
 * jump_plugin.ts (no-jump zone: "Jump Distance", 1000 px, adjusted by
 * "hyperspace dist mod" outfits) and health_plugin.ts (fuel "100 = 1 jump").
 */

/** Why a jump cannot start, in the order the simulation gate checks them. */
export type JumpBlocker =
    /** A disabled ship cannot spin up its hyperdrive. */
    | 'disabled'
    /** A jump sequence is already running on this ship. */
    | 'jumping'
    /** No hyperspace route is selected, so there is nowhere to go. */
    | 'noRoute'
    /** Inside the no-jump zone around the system center. */
    | 'tooClose'
    /** Under one jump's worth of fuel. */
    | 'noFuel';

export interface JumpReadinessInputs {
    /** A jump route is selected (JumpRouteComponent.route.length > 0). */
    hasRoute: boolean;
    /** Distance from the system center (movement.position.length). */
    distance: number;
    /** The ship's no-jump radius; see {@link jumpRadiusFor}. */
    jumpRadius: number;
    /** Current fuel (FuelComponent.current). */
    fuel: number;
    /** Fuel a jump costs (FUEL_PER_JUMP). */
    fuelPerJump: number;
    /** The ship carries a DisabledComponent. Optional: a caller that cannot
     * see the flag (a pure fuel/distance question) leaves it out. */
    disabled?: boolean;
    /** The ship already carries a JumpComponent. Optional, as above. */
    jumping?: boolean;
}

/**
 * A ship's no-jump radius: the standard JUMP_DISTANCE adjusted by its
 * "hyperspace dist mod" outfits (ShipPhysicsComponent.jumpDistanceMod),
 * floored at zero so a large negative mod cannot invert the test.
 */
export function jumpRadiusFor(jumpDistance: number,
    jumpDistanceMod: number): number {
    return Math.max(0, jumpDistance + jumpDistanceMod);
}

/**
 * The first reason this ship may not start a jump, or undefined when it may.
 * The order matches PlayerJumpControl's early returns, so the blocker names
 * the same condition the gate would have refused on.
 */
export function jumpBlocker(inputs: JumpReadinessInputs):
    JumpBlocker | undefined {
    if (inputs.disabled) {
        return 'disabled';
    }
    if (inputs.jumping) {
        return 'jumping';
    }
    if (!inputs.hasRoute) {
        return 'noRoute';
    }
    if (inputs.distance < inputs.jumpRadius) {
        return 'tooClose';
    }
    if (inputs.fuel < inputs.fuelPerJump) {
        return 'noFuel';
    }
    return undefined;
}

/** Whether this ship may start a hyperspace jump right now. */
export function canJump(inputs: JumpReadinessInputs): boolean {
    return jumpBlocker(inputs) === undefined;
}
