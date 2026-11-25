/**
 * What the status bar's target pane shows in its bottom-left readout.
 * Pure so the rule is testable without PIXI:
 *  - A DISABLED target reads "Disabled" (bright text, replacing the
 *    shield/armor percent entirely — matching the original game's
 *    presentation, see ui_screenshots/status_bar/ship_disabled.jpg).
 *  - A rescue ship WAITING for its pilot (mïsn ShipStart 2,
 *    npc/system_hold.ts's waitingForRescue) reads "Waiting" the same way
 *    (reference "Contraband / rescue / A14, wave 19": "UFS Enterprise,
 *    Waiting"; then "Shield: 100%" once released). Both words are the
 *    stock STR# 2002 "misc strings" 346 / 347 (TARGET_DISABLED_TEXT,
 *    TARGET_WAITING_TEXT).
 *  - Otherwise shields show while any remain, then armor percent.
 */
export type TargetReadout =
    | { kind: 'disabled' }
    | { kind: 'waiting' }
    | { kind: 'shield', percent: number }
    | { kind: 'armor', percent: number }
    | { kind: 'none' };

/** STR# 2002 index 346 (0-based), the disabled target's readout. */
export const TARGET_DISABLED_INDEX = 346;
export const TARGET_DISABLED_TEXT = 'Disabled';
/** STR# 2002 index 347, a waiting rescue ship's readout. */
export const TARGET_WAITING_INDEX = 347;
export const TARGET_WAITING_TEXT = 'Waiting';

/** `status`: true (or 'disabled') for a disabled target, 'waiting' for a
 * rescue ship waiting for its pilot, false otherwise. */
export function targetReadout(status: boolean | 'disabled' | 'waiting',
    shield?: number, armor?: number): TargetReadout {
    if (status === true || status === 'disabled') {
        return { kind: 'disabled' };
    }
    if (status === 'waiting') {
        return { kind: 'waiting' };
    }
    if (shield && shield > 0) {
        return { kind: 'shield', percent: shield };
    }
    if (typeof armor === 'number') {
        // Stat.percent is current / max * 100, which is NaN for a stat
        // whose max is 0 — the stock Escape Pod (shïp nova:895) has no
        // shield and no armor at all. Nothing to have is 0% of it, not
        // "NaN%".
        return { kind: 'armor', percent: Number.isFinite(armor) ? armor : 0 };
    }
    return { kind: 'none' };
}
