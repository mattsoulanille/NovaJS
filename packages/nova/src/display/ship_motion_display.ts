/**
 * Display-side smoothing of the two sprite effects that follow a ship's
 * steering inputs: the banking sprite set (shän Flags 0x0001: "the first
 * set of sprites is used for level flight, the second for banking left,
 * and the third for banking right") and the engine glow (shän GlowImage).
 *
 * Both used to be a direct, per-display-frame function of the simulation's
 * `MovementState.turning` / `.accelerating`, so a ship whose steering
 * flickers those inputs for single ticks — an NPC converging on a heading,
 * or briefly turning retrograde for one tick (#357) — flickered between
 * its level and banked sprite sets and blinked its engine glow off and on.
 * The original waits before banking and fades its glow in and out.
 *
 * DISPLAY-ONLY: nothing here feeds back into the simulation or the wire.
 * The state lives with the display entity's AnimationGraphic and is driven
 * by the display world's clock (TimeResource), never Date.now.
 */

/**
 * How long a ship must turn continuously in the same direction before it
 * shows its bank-left / bank-right sprite set. The maintainer's estimate of
 * the original ("it waits for like half a second of turning before
 * rendering the turning frames", #357); to be tuned against the original.
 */
export const BANK_DELAY_MS = 500;

/**
 * How long `turning` may read zero inside a turn before the turn counts as
 * over: a shorter gap neither drops a bank already shown nor restarts the
 * BANK_DELAY_MS clock. A longer zero un-banks (back to level flight) and
 * the next turn starts the delay from scratch.
 *
 * Why not un-bank on the first zero frame: a ship holding a turn does not
 * always read a steady ±1. An NPC steering with `turnTo` snaps onto its
 * goal heading — and reads turning 0 for that frame — whenever the goal is
 * within one frame's turn, which while tracking a moving goal means
 * isolated zero frames inside a sustained turn (measured in a headless
 * browser on #357: zero runs of 1-2 display frames inside same-direction
 * turns of a Fed Destroyer, 37-75 ms at that run's 27 fps). The display
 * world also re-runs that snap on its own clock between snapshots.
 * Measured the other way, the player's held arrow key (keydown + repeat
 * keydowns, no keyup) gave an unbroken run of -1 for the whole hold, so
 * the hold costs a deliberately released key only this much extra bank.
 * 100 ms bridges those gaps (≈6 frames at 60 Hz) while staying far below
 * BANK_DELAY_MS, so a genuine wiggle — a direction change, which always
 * resets — still never banks. The hold is measured from the first ZERO
 * frame, not from the last frame, so a slow display (frames further apart
 * than the hold) never mistakes a steady turn for a gap.
 */
export const BANK_GAP_HOLD_MS = 100;

/**
 * How long the engine glow takes to fade fully in when thrust starts, and
 * fully out when it stops (a linear ramp both ways). The maintainer's
 * estimate of the original ("Engine glow also fades in and out. Takes ~1/2
 * a second", #357); to be tuned. The EV Nova Bible's shän text says
 * nothing about an engine-glow fade (WeapDecay is the WEAPON glow's).
 */
export const GLOW_FADE_MS = 500;

export type BankDirection = -1 | 0 | 1;
export type FrameSetName = 'normal' | 'left' | 'right';

export interface BankState {
    /** The direction of the turn in progress (0: not turning). */
    readonly direction: BankDirection;
    /** Display time the turn in progress started. */
    readonly since: number;
    /**
     * Display time of the first frame of the zero run the turn is in the
     * middle of, or null while `turning` reads `direction`. The gap hold
     * is measured from here — never from the last frame, so a slow or
     * stalled display (long frames) does not break a steady turn.
     */
    readonly zeroSince: number | null;
    /** Display time of the frame this state was computed for. */
    readonly at: number;
    /** The set shown: -1 bank left, 1 bank right, 0 level. */
    readonly banked: BankDirection;
}

export interface GlowState {
    /** Smoothed glow level in [0, 1] (before the shimmer multiplier). */
    readonly level: number;
    /** Display time `level` was computed at. */
    readonly at: number;
}

/**
 * Everything this module keeps for one graphic. `owner` is the display
 * entity the state was built for: a pooled AnimationGraphic is reused for
 * other entities, and a stale bank or glow must never carry over.
 */
export interface ShipMotionDisplayState {
    readonly owner: string;
    readonly bank: BankState;
    readonly glow: GlowState;
}

function level(now: number): BankState {
    return { direction: 0, since: now, zeroSince: null, at: now, banked: 0 };
}

function frameSet(banked: BankDirection): FrameSetName {
    return banked < 0 ? 'left' : banked > 0 ? 'right' : 'normal';
}

/**
 * The bank rule: (previous state, turning, now) → (state, frame set).
 *
 * - Banks only after `turning` has held the same sign for BANK_DELAY_MS.
 * - A change of direction restarts the delay at once (and levels the
 *   ship): a ±1 wiggle faster than the delay never banks.
 * - A zero no longer than BANK_GAP_HOLD_MS is bridged (bank and clock
 *   kept); a longer one un-banks and ends the turn.
 * - The display clock running backwards (a rebuilt world) starts afresh.
 */
export function stepBank(prev: BankState | undefined, turning: number,
    now: number): { state: BankState, frames: FrameSetName } {
    const sign = Math.sign(turning) as BankDirection;
    // No state yet, or the display clock ran backwards: start level.
    const p = !prev || now < prev.at ? level(now) : prev;
    // Is the turn in progress still alive? Yes while turning reads its
    // direction, and through a zero run no longer than the hold.
    const alive = p.direction !== 0
        && (p.zeroSince === null || now - p.zeroSince <= BANK_GAP_HOLD_MS);

    let state: BankState;
    if (sign === 0) {
        if (alive) {
            // Bridging a gap: keep the bank and the delay clock.
            state = { ...p, zeroSince: p.zeroSince ?? now, at: now };
        } else {
            state = level(now);
        }
    } else if (alive && sign === p.direction) {
        const banked = now - p.since >= BANK_DELAY_MS ? sign : p.banked;
        state = { ...p, zeroSince: null, at: now, banked };
    } else {
        // A new turn, or a reversal: level until the delay elapses again.
        state = {
            direction: sign, since: now, zeroSince: null, at: now,
            banked: BANK_DELAY_MS <= 0 ? sign : 0,
        };
    }
    return { state, frames: frameSet(state.banked) };
}

/**
 * The glow rule: a linear ramp of GLOW_FADE_MS toward the thrust target
 * (`accelerating` clamped to [0, 1]: an inertialess ship braking reads -1,
 * which never lit the glow). First sight of a ship starts AT the target,
 * so a ship that is already thrusting when it comes on screen (or a pooled
 * graphic handed to one) shows its glow without fading in.
 */
export function stepGlow(prev: GlowState | undefined, accelerating: number,
    now: number): GlowState {
    const target = Math.min(1, Math.max(0, accelerating));
    if (!prev || now < prev.at) {
        return { level: target, at: now };
    }
    const maxStep = GLOW_FADE_MS <= 0 ? Infinity
        : (now - prev.at) / GLOW_FADE_MS;
    const delta = target - prev.level;
    const level = Math.abs(delta) <= maxStep
        ? target : prev.level + Math.sign(delta) * maxStep;
    return { level, at: now };
}

/**
 * One display frame of both rules for the graphic drawing entity `owner`.
 * State built for a different entity (a pooled graphic reused) is
 * discarded first.
 */
export function stepShipMotionDisplay(
    prev: ShipMotionDisplayState | undefined, owner: string,
    turning: number, accelerating: number, now: number,
): { state: ShipMotionDisplayState, frames: FrameSetName, glow: number } {
    const own = prev?.owner === owner ? prev : undefined;
    const bank = stepBank(own?.bank, turning, now);
    const glow = stepGlow(own?.glow, accelerating, now);
    return {
        state: { owner, bank: bank.state, glow },
        frames: bank.frames,
        glow: glow.level,
    };
}
