import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { OutfitsState } from './outfit_plugin.js';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';

/**
 * ============================================================================
 * Ship disabling (EVN Bible)
 * ============================================================================
 *
 * A ship whose armor falls to or below its disable threshold — 33% of max
 * armor, or 10% when the shïp Flags 0x0010 bit is set (ShipData
 * .disableArmorFraction) — becomes DISABLED: dead in space. While disabled
 * it cannot thrust, turn, or fire; it decloaks; its shield, armor, and fuel
 * ("energy") recharges are suspended; its running lights go dark; and it
 * slowly decelerates to rest. It can still command its escorts, and it can
 * still be destroyed (armor reaching 0 follows the normal death path).
 *
 * This module holds the component, its wire type, the tuning constants, and
 * the pure transition helpers, with no system imports — so gameplay systems
 * (movement control, weapons, cloak, health recharge, NPC AI, display) can
 * all import the component without cycling on disabled_plugin.ts, which
 * imports several of them for system ordering.
 *
 * DETERMINISM / ROLLBACK: DisabledComponent is real simulation state. It is
 * event-driven (set on the tick armor crosses the threshold, removed on
 * repair) rather than re-derived per tick because it carries the rolled
 * repair time; it is serializer-registered (disabled_plugin.ts), so rollback
 * snapshots and wire baselines carry it through the default codec path.
 * The repair delay is rolled from the seeded RandomResource at the entry
 * transition, which every peer simulates identically.
 */

/**
 * Present on a ship while it is disabled.
 *
 * `repairAt` is the sim time (ms) at which the ship's repair system brings
 * it back online, or null when the ship has no self-repair (no repair
 * outfit and not player-controlled) and must wait for outside help.
 */
export const DisabledState = t.intersection([
    t.type({
        repairAt: t.union([t.number, t.null]),
    }),
    // Additive (t.partial: wire/save records without it stay decodable).
    t.partial({
        /**
         * A spawn-disabled derelict (gövt Flags1 0x0800): disabled with
         * FULL shields and armor — the original's derelicts read
         * "disabled" yet take a whole hull's worth of shots to destroy
         * (Matthew's playtest observation, 2026-08-14). ShipDisableSystem
         * must NOT re-enable a hulk just because its armor sits above the
         * disable threshold; only an external repair (boarding) clears it.
         */
        hulk: t.literal(true),
    }),
]);
export type DisabledState = t.TypeOf<typeof DisabledState>;
export const DisabledComponent = new Component<DisabledState>('DisabledComponent');

/**
 * How hard a disabled ship brakes toward rest, in px/s^2 (velocity-space
 * units of MovementState). TUNABLE: the Bible doesn't give a rate; stock
 * ship speeds land around 75-120 px/s after ShipSpeedConversionFactor, so
 * 30 px/s^2 coasts a full-speed ship to a stop over ~3-4 s — visibly
 * "drifting to a halt" rather than parking instantly.
 */
export const DISABLED_DECELERATION = 30;

/**
 * Repair margin: a self-repair brings armor to (threshold + this fraction
 * of max armor), capped at max. TUNABLE: 10% of max armor above the
 * threshold means a freshly repaired 33%-threshold ship sits at 43% — a
 * stray hit knocks it down without instantly re-disabling it.
 */
export const REPAIR_MARGIN_FRACTION = 0.10;

/**
 * Repair-system outfit (oütf ModType 49) delay range, ms. The Bible only
 * says the outfit "will occasionally repair the ship when it's disabled";
 * TUNABLE: modeled as one seeded-random draw in [min, max) made at the
 * moment of disabling, uniform, so peers agree and the wait feels
 * "occasional" (tens of seconds) without stranding anyone for minutes.
 */
export const OUTFIT_REPAIR_DELAY_MIN_MS = 10_000;
export const OUTFIT_REPAIR_DELAY_MAX_MS = 30_000;

/**
 * Player-inherent repair delay range, ms. Every player-controlled ship
 * carries an inherent repair-droid equivalent so a disabled player is
 * never soft-locked; it is deliberately slower than the purchasable
 * ModType 49 outfit (which takes precedence when owned) so the outfit
 * stays worth buying. TUNABLE.
 */
export const PLAYER_REPAIR_DELAY_MIN_MS = 20_000;
export const PLAYER_REPAIR_DELAY_MAX_MS = 45_000;

/** Whether an armor stat is at or below the ship's disable threshold. */
export function isBelowDisableThreshold(
    armor: { current: number, max: number },
    disableArmorFraction: number): boolean {
    return armor.max > 0 && armor.current <= disableArmorFraction * armor.max;
}

/**
 * The armor value a self-repair restores: slightly above the disable
 * threshold (see REPAIR_MARGIN_FRACTION), capped at max.
 */
export function repairedArmor(max: number, disableArmorFraction: number): number {
    return Math.min(max, (disableArmorFraction + REPAIR_MARGIN_FRACTION) * max);
}

/**
 * Rolls the sim time at which a freshly disabled ship self-repairs, or
 * null when it can't. `random()` is a [0, 1) draw from the seeded
 * RandomResource. A repair-system outfit repairs on the outfit schedule;
 * otherwise a player-controlled ship falls back to the slower inherent
 * repair droid; otherwise there is no self-repair.
 */
export function rollRepairTime(now: number, hasRepairOutfit: boolean,
    isPlayerControlled: boolean, random: () => number): number | null {
    if (hasRepairOutfit) {
        return now + OUTFIT_REPAIR_DELAY_MIN_MS + random()
            * (OUTFIT_REPAIR_DELAY_MAX_MS - OUTFIT_REPAIR_DELAY_MIN_MS);
    }
    if (isPlayerControlled) {
        return now + PLAYER_REPAIR_DELAY_MIN_MS + random()
            * (PLAYER_REPAIR_DELAY_MAX_MS - PLAYER_REPAIR_DELAY_MIN_MS);
    }
    return null;
}

/**
 * Whether the ship owns a repair-system outfit (oütf ModType 49).
 * Returns undefined only when outfit game data is not yet cached (retry
 * next step), matching the ProvideFromCache contract — this feeds the
 * derived RepairComponent (see disabled_plugin.ts), which follows the
 * CloakComponent model: derived from outfits, re-derived on restore,
 * skipped from snapshots.
 */
export function deriveRepair(outfits: OutfitsState,
    gameData: SimulationGameDataInterface):
    { hasRepairSystem: boolean } | undefined {
    for (const [id, state] of outfits) {
        if (state.count <= 0) {
            continue;
        }
        const outfit = gameData.data.Outfit.getCached(id);
        if (!outfit) {
            return undefined;
        }
        if (outfit.repairSystem) {
            return { hasRepairSystem: true };
        }
    }
    return { hasRepairSystem: false };
}

export const RepairComponent =
    new Component<{ hasRepairSystem: boolean }>('RepairComponent');
