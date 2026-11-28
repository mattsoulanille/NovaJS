import { Query } from 'nova_ecs/query';
import { RunQueryFunction } from 'nova_ecs/arg_types';
import { ProjectileComponent } from '../core/index.js';

/**
 * ============================================================================
 * The original's shot cap: at most 128 projectiles alive in a system
 * ============================================================================
 *
 * EVN Bible, Part I's engine limits: "Max Shots On Screen 128". Measured on
 * the original (docs/reference_experiments.md, "The shot cap, wave 58"): a
 * player at rest holding a gun that fires a 16-bolt starburst every second
 * (15 s bolts) built eight full rings, 128 bolts, and then fired NOTHING
 * until the oldest ring expired; from then on one new ring appeared each
 * time an old one died. So the cap is on every projectile in the system,
 * on screen or not (the oldest rings were off the play area when they held
 * the slots), and a full table refuses the NEW shot: nothing alive is
 * recycled.
 *
 * NovaJS applies it where a projectile is spawned
 * (ProjectileWeaponEntry.fire), so it covers guns, missiles, turrets, point
 * defense and submunitions alike. A refused shot is not a shot: the
 * firing loop (weapon_plugin.ts) consumes no ammo and does not restart the
 * reload for it, so the trigger fires again on the first tick a slot is
 * free. Beams and bay fighters are not projectiles and are not counted (the
 * Bible gives beams a cap of their own, 64, not applied here).
 *
 * GUESS: a parent shot that expires into submunitions still holds its own
 * slot while its children spawn (it is removed right after them), so at the
 * very edge of a full table a burst comes out one short. The rig could not
 * tell 15 bolts from 16 in a ring.
 *
 * Why it matters beyond fidelity: without it a few plug-in weapons (the
 * Alternate Missles "DVrger missile", 109 projectiles a shot, the Hex Trap
 * Missile, thousands) let one player fill a system with thousands of
 * projectiles, which every peer simulates and draws.
 *
 * Deterministic: the count is the world's own projectile entities, read
 * through a cached query, the same on every peer and after any rollback.
 */
export const MAX_SHOTS = 128;

const LiveShots = new Query([ProjectileComponent] as const, 'LiveShots');

/** Whether one more projectile may be spawned in this world now. */
export function shotSlotFree(runQuery: RunQueryFunction): boolean {
    return runQuery(LiveShots).length < MAX_SHOTS;
}
