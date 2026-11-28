import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { LimitsRule, roomRulesOf } from './room_rules.js';

/**
 * ============================================================================
 * The engine's population limits, per the room's `limits` rule
 * ============================================================================
 *
 * THE ORIGINAL (room rule 'original'). EVN Bible, Part I's engine limits:
 * "Max Shots On Screen 128", "Max Beams On Screen 64". Measured on the
 * original (docs/reference_experiments.md, "The shot cap, wave 58"): a
 * player at rest holding a gun that fires a 16-bolt starburst every second
 * (15 s bolts) built eight full rings, 128 bolts, and then fired NOTHING
 * until the oldest ring expired; from then on one new ring appeared each
 * time an old one died. So the cap is on every projectile in the system,
 * on screen or not (the oldest rings were off the play area when they held
 * the slots), and a full table refuses the NEW shot: nothing alive is
 * recycled. Every projectile counts the same, a submunition or a shot
 * fired from a ship.
 *
 * NOVAJS (room rule 'novajs', the default). Matthew: "I'd like to raise
 * this limit if possible ... firing a weapon and having the projectiles
 * never appear" was annoying, but some limit stays, because cheat plug-ins
 * make weapons that "sub into 5 copies of self; subs fire at nearest
 * target; sub limit 9999". So three numbers instead of one:
 *
 *  - a SOFT cap: a SUBMUNITION is refused while this many are alive;
 *  - a HARD cap: a DIRECTLY FIRED shot (a ship's gun, turret, point
 *    defense or launched missile: anything WeaponEntry.fireFromEntity
 *    spawns) is refused only at this higher count, so submunition floods
 *    can never take the last slots and a player's own shot essentially
 *    always appears;
 *  - a FAMILY BUDGET: all descendants of one directly fired shot, every
 *    generation, share this many spawns (ShotFamilyBudget below), so a
 *    self-replicating weapon stops growing however high its SubLimit.
 *
 * The numbers come from measurement (docs/novajs_enhancements.md, "Room
 * rules"): the sim step and the browser frame with that many alive.
 *
 * Where they apply: ProjectileWeaponEntry.fire (projectile_plugin.ts) and
 * BeamWeaponEntry.fire (beam_plugin.ts) check the cap for their own kind;
 * WeaponEntry.fireSubs (fire_weapon_plugin.ts) spends the family budget.
 * A refused shot is not a shot: the firing loop (weapon_plugin.ts) takes
 * no ammo for it, and unless the kind's `refusalReloads` says otherwise
 * does not restart the reload either, so the trigger fires again on the
 * first tick a slot is free. Bay fighters are ships, not shots.
 *
 * GUESS (both rules): a parent shot that expires into submunitions still
 * holds its own slot while its children spawn (it is removed right after
 * them), so at the very edge of a full table a burst comes out one short.
 * The wave-58 rig could not tell 15 bolts from 16 in a ring.
 *
 * Deterministic: the counts are the world's own entities, read through
 * cached queries; the rule is synced room state (core/room_rules.ts); the
 * family budget is a synced number on each shot. The same on every peer
 * and after any rollback.
 */

/** When a new shot of one kind (projectile or beam) may spawn. */
export interface SpawnCaps {
    /** A submunition is refused while this many of its kind are alive. */
    readonly soft: number;
    /** A directly fired one is refused while this many are alive. */
    readonly hard: number;
    /**
     * Whether a directly fired shot the cap refuses still costs its
     * weapon a reload (no ammo either way). False: the trigger fires again
     * on the first tick a slot is free.
     */
    readonly refusalReloads: boolean;
}

export interface EngineLimits {
    readonly shots: SpawnCaps;
    readonly beams: SpawnCaps;
    /**
     * How many descendants (every generation, projectiles and beams
     * alike) one directly fired shot may have. Infinity: no budget.
     */
    readonly familyBudget: number;
    /**
     * Ships in the system (ship/ship_cap.ts): while this many are there,
     * a new NPC (traffic, a fleet member, a planet's defender) and a bay
     * launch are refused. The pilots' own ships always enter.
     */
    readonly ships: number;
}

/**
 * The tables. Change the NovaJS numbers here; the specs read them from
 * this table rather than repeating them.
 */
export const ENGINE_LIMITS: Readonly<Record<LimitsRule, EngineLimits>> = {
    original: {
        shots: { soft: 128, hard: 128, refusalReloads: false },
        beams: { soft: 64, hard: 64, refusalReloads: false },
        familyBudget: Infinity,
        ships: 64,
    },
    novajs: {
        shots: { soft: 256, hard: 512, refusalReloads: false },
        beams: { soft: 128, hard: 256, refusalReloads: false },
        familyBudget: 256,
        ships: 128,
    },
};

/** The original's shot cap (the Bible's 128). */
export const MAX_SHOTS = ENGINE_LIMITS.original.shots.hard;

/** The limits `entities` runs under (its room's `limits` rule). */
export function engineLimitsOf(
    entities: { get(uuid: string): Entity | undefined }): EngineLimits {
    return ENGINE_LIMITS[roomRulesOf(entities).limits];
}

/**
 * Whether one more shot may spawn while `alive` of its kind are alive:
 * a submunition under the soft cap, a directly fired shot under the hard
 * one. Pure.
 */
export function spawnAllowed(alive: number, caps: SpawnCaps,
    submunition: boolean): boolean {
    return alive < (submunition ? caps.soft : caps.hard);
}

/**
 * The spawns a shot's descendants may still make, every generation
 * together (EngineLimits.familyBudget). A directly fired shot carries
 * none and has the whole budget. When a shot subs, each child spawned
 * spends one, and what is left is split evenly among the children it
 * spawned (the first ones take the remainder), so a family can never
 * spawn more than the budget in all, whatever its shape, and no shared
 * counter is needed: every shot carries its own share, synced like any
 * other component. A child refused by the soft cap spends nothing.
 * Unused under a rule with no budget (Infinity), where nothing sets it.
 */
export const ShotFamilyBudget = new Component<number>('ShotFamilyBudget');

/**
 * The budget each of `spawned` children inherits from a parent that had
 * `remaining` left after spawning them (`remaining` already net of the
 * spawns). Pure.
 */
export function splitFamilyBudget(remaining: number, spawned: number)
    : number[] {
    if (spawned <= 0) {
        return [];
    }
    const share = Math.floor(remaining / spawned);
    const extra = remaining - share * spawned;
    const shares: number[] = [];
    for (let i = 0; i < spawned; i++) {
        shares.push(share + (i < extra ? 1 : 0));
    }
    return shares;
}
