/**
 * What the status bar's target pane shows in its bottom-left readout.
 * Pure so the rule is testable without PIXI:
 *  - A DISABLED target reads "Disabled" (bright text, replacing the
 *    shield/armor percent entirely — matching the original game's
 *    presentation, see ui_screenshots/status_bar/ship_disabled.jpg).
 *  - Otherwise shields show while any remain, then armor percent.
 */
export type TargetReadout =
    | { kind: 'disabled' }
    | { kind: 'shield', percent: number }
    | { kind: 'armor', percent: number }
    | { kind: 'none' };

export function targetReadout(disabled: boolean, shield?: number,
    armor?: number): TargetReadout {
    if (disabled) {
        return { kind: 'disabled' };
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
