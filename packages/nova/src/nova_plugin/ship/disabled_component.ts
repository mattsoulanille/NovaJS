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
 * coasts to rest (exponential drag, DISABLED_COAST_TIME_CONSTANT_S). It
 * can still command its escorts, and it can still be destroyed (armor
 * reaching 0 follows the normal death path).
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
 * How a disabled ship coasts to rest: EXPONENTIAL drag on its velocity
 * (reference "A disabled ship's coast, wave 25"). Each sim step the speed
 * is multiplied by exp(-dt / DISABLED_COAST_TIME_CONSTANT_S), so it loses
 * about 23% a second whatever it started at, and the hulk drifts a total
 * of about (start speed) x tau before it stops.
 *
 * MEASURED on the original: a trader flying a straight line at 34-38
 * px/s took one Disable Gun hit; its track at 10 fps fits
 * v = 34.4 e^(-t / 3.74 s) (residual sum of squares 9, against 149 for
 * the best constant deceleration), about x0.991 per 1/30 s tick (x0.9956
 * per NovaJS 1/60 s step). It came to rest about 12 s and 125 px after
 * the hit and stayed there. ONLY ONE HULL AT ONE STARTING SPEED was
 * measured: that the time constant is the same for every hull and every
 * speed is a GUESS (wave 23's warship disabled at about 230 px/s drifted
 * on for seconds, which fits it).
 *
 * (Replaced a constant 45 px/s^2 brake, a tuning guess that stopped this
 * very hulk in 0.8 s after 25 px.)
 */
export const DISABLED_COAST_TIME_CONSTANT_S = 3.74;

/**
 * Below this speed (px/s) a coasting hulk snaps to rest, so the
 * exponential does not creep on forever. Chosen from the measured rest:
 * 34.4 e^(-12 / 3.74) = 1.4 px/s, so the measured coast stops 12.0 s and
 * 123 px after the hit (measured: about 12 s and 125 px). At 1.4 px/s the
 * snap is 0.02 px a step, invisible. A hull disabled at 300 px/s stops
 * after about 20 s and 1,100 px.
 */
export const DISABLED_REST_SPEED = 1.4;

/**
 * A coasting hulk's speed after one sim step of `deltaS` seconds: the
 * exponential drag, then the snap to rest below DISABLED_REST_SPEED.
 * Math.exp is the deterministic one in every simulating context
 * (nova_ecs deterministic_math, installed by makeSystem).
 */
export function disabledCoastSpeed(speed: number, deltaS: number): number {
    const next = speed * Math.exp(-deltaS / DISABLED_COAST_TIME_CONSTANT_S);
    return next < DISABLED_REST_SPEED ? 0 : next;
}

/**
 * Repair margin: a self-repair brings armor to (threshold + this fraction
 * of max armor), capped at max. MEASURED (reference "Wave-37 leftovers,
 * wave 38", A10): Repair Droids lifted a disabled player's armor bar from
 * 20% to 51 of 151 px, 33.8% — the first bar pixel over the one-third
 * line — in both runs. The bar resolves about 0.7% of the armor, so the
 * margin is 1% (GUESS within that pixel): a freshly repaired
 * 33%-threshold ship sits at 34%, and any real hit disables it again.
 * Not zero: a ship parked exactly AT the threshold satisfies
 * `isBelowDisableThreshold` (<=) and would re-disable on the next tick.
 * (Was 0.10, i.e. 43%.)
 */
export const REPAIR_MARGIN_FRACTION = 0.01;

/**
 * Repair-system outfit (oütf ModType 49) delay range, ms. The Bible only
 * says the outfit "will occasionally repair the ship when it's disabled";
 * TUNABLE: modeled as one seeded-random draw in [min, max) made at the
 * moment of disabling, uniform, so peers agree and the wait feels
 * "occasional" (tens of seconds) without stranding anyone for minutes.
 * The reference's Repair Droids (stock oütf 437) repaired 10.9 s and
 * 25.7 s after the disable (wave 38, A10): both inside this window, so it
 * stays until more readings narrow it.
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
