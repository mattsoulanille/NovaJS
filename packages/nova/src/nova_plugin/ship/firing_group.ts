import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';

/**
 * ============================================================================
 * Firing groups: friendly-fire immunity within a fleet / owner chain
 * ============================================================================
 *
 * In the original game an NPC and its escorts simply CANNOT hit each
 * other: their shots pass through each other. NovaJS models that with a
 * shared group identity, the "firing group":
 *
 *  - Fleet spawns (npc_spawn_plugin) stamp the leader AND its escorts
 *    with FiringGroupComponent { group: leaderUuid }.
 *  - Weapons fire (fire_weapon_plugin's fireFromEntity / fireSubs)
 *    stamps every spawned weapon entity — projectile, beam, or bay
 *    fighter — with the firer's group, falling back to the firer's
 *    owner-chain root (OwnerComponent.owner ?? firer uuid). Blasts
 *    inherit their projectile's group or not as BLAST_FLOCK_RULE below
 *    says (projectile_plugin).
 *  - The weapon collision handlers (projectile_plugin, beam_plugin,
 *    blast_plugin) drop any hit where the weapon's group matches the
 *    victim's effective group (see victimFiringGroup) BEFORE emitting
 *    DamagedEvent, so group members never register as aggressors
 *    against each other.
 *
 * This generalizes — and replaces — the old owner-uuid special case
 * that made bay fighters immune to their carrier: a bay fighter fired
 * from a carrier is stamped with the carrier's group (or the carrier
 * uuid), so the fighter, the carrier, its other fighters, and — when
 * the carrier leads a fleet — the whole fleet share one group, and the
 * fighter's own shots inherit it in turn.
 *
 * Determinism: group ids are entity uuids from the deterministic id
 * factory, the component is serializer-registered (delta-registered in
 * fire_weapon_plugin, so it is hashed, snapshotted, and carried on the
 * wire), and the pair check below is a couple of string compares —
 * cheap enough for the collision hot path.
 */

export const FiringGroup = t.intersection([t.type({
    /**
     * The shared group id: the fleet leader's uuid, the carrier's
     * owner-chain root for bay fighters, or the firing ship's uuid for
     * a lone ship's weapons.
     */
    group: t.string,
}), t.partial({
    /**
     * The firing ship's government (GovtData id) at fire time, carried
     * on WEAPON entities only (ships read their own GovtComponent), for
     * the same-govt clause below (SAME_GOVT_FIRING_IMMUNITY).
     */
    govt: t.string,
    /**
     * BLAST entities only, and only under BLAST_FLOCK_RULE
     * 'flockAlwaysSpared': the blast spares its group EXCEPT the ship
     * that fired it (wëap Flags 0x0100 unset). Never written under the
     * default rule.
     */
    hurtsFirer: t.boolean,
})]);
export type FiringGroup = t.TypeOf<typeof FiringGroup>;
export const FiringGroupComponent = new Component<FiringGroup>('FiringGroup');

/** The weapon effect a friendly-fire check is made for. */
export type FiringWeaponKind = 'projectile' | 'beam' | 'blast';

/**
 * Which weapon effects extend friendly-fire immunity to EVERY ship of
 * the firer's government, not just its fleet/owner group.
 *
 * Measured on the original (docs/reference_experiments.md, "NPC friendly
 * fire wave 10"): an NPC's unguided bolts flew THROUGH a ship of its own
 * government on the line of fire (100% shield over ~45 s) and hit the
 * player behind it, but its beam stopped on that ship and took its
 * shield down, and its bolt's 150 px blast splashed it. Allied and
 * neutral governments get no immunity at all (their ships took the
 * bolts), so only an exact govt match counts. A guided missile hits only
 * its target anyway (proxHitAll), so the projectile row decides nothing
 * new for it.
 *
 * Not measured: whether the clause outlasts the victim being disabled
 * (firingImmune's carve-out cancels it with the group immunity).
 */
export const SAME_GOVT_FIRING_IMMUNITY: Readonly<Record<FiringWeaponKind, boolean>> = {
    projectile: true,
    beam: false,
    blast: false,
};

/**
 * ============================================================================
 * WHO A BLAST SPARES — an open rule, behind this one switch
 * ============================================================================
 *
 * Direct hits (projectile and beam) always pass through the firer's flock.
 * Whether a BLAST — a wëap BlastRadius splash, which is area damage rather
 * than a shot that connects — spares the flock too is not settled. The
 * only data bit is wëap Flags 0x0100, which the Bible words as "Weapon's
 * blast doesn't hurt the player" (parsed, inverted, as
 * ProjectileWeaponData.blastHurtsFiringShip). It speaks of the FIRING ship;
 * what it means for the rest of the firer's fleet or carrier group is what
 * the reference Mac is being asked. The candidate readings:
 *
 *  - 'firerFlagSparesFlock' (CURRENT, the behaviour NovaJS has shipped):
 *    0x0100 set -> the blast carries the firing group and spares the whole
 *    flock, firer included; 0x0100 unset -> it carries no group and hurts
 *    EVERY ship in its radius, the firer's leader, carrier and wingmates
 *    included. The flag that is about the firer decides for the flock.
 *  - 'flockAlwaysSpared': a blast spares the flock exactly as a direct hit
 *    does, whatever the flag; 0x0100 unset only adds the firing ship
 *    itself back in.
 *  - 'onlyFirerSpared': a blast spares nobody but its firing ship, and that
 *    only with 0x0100 set; the flock always takes splash.
 *
 * Whatever this says, a flock member's splash never makes a ship HOSTILE to
 * its own flock (npc_targeting.ts's NpcAggressionSystem and
 * aggression_plugin's AggressionDamageSystem skip the pair; see
 * npc/allegiance.ts's sameFlock). Only who takes the damage changes.
 *
 * Deterministic in every mode: a compile-time constant read at blast spawn.
 */
export type BlastFlockRule =
    'firerFlagSparesFlock' | 'flockAlwaysSpared' | 'onlyFirerSpared';
export const BLAST_FLOCK_RULE: BlastFlockRule = 'firerFlagSparesFlock';

/**
 * The friendly-fire identity a new blast carries under `rule`: the firing
 * group it spares (if any) and, separately, a firer to ignore outright.
 *
 * `group` is the shot's firing group (fire_weapon_plugin stamps one on every
 * projectile; the owner-chain root stands in for a legacy group-less one),
 * `firer` the ship that actually fired it (SourceComponent). Pure.
 */
export function blastFriendlyFire(rule: BlastFlockRule,
    blastHurtsFiringShip: boolean, group: FiringGroup | undefined,
    firer: string | undefined): { group?: FiringGroup, ignoreFirer?: string } {
    switch (rule) {
        case 'firerFlagSparesFlock':
            return blastHurtsFiringShip || !group ? {} : { group };
        case 'flockAlwaysSpared':
            if (!group) {
                return {};
            }
            return blastHurtsFiringShip
                ? { group: { ...group, hurtsFirer: true } } : { group };
        case 'onlyFirerSpared':
            return blastHurtsFiringShip || firer === undefined
                ? {} : { ignoreFirer: firer };
    }
}

/**
 * The pair-immunity predicate: should a weapon with the given firing
 * group/govt pass through (NOT hit) a victim with the given effective
 * group/govt?
 *
 * `kind` is the weapon effect being judged: a projectile also passes
 * through every ship of its firer's government, a beam or a blast does
 * not (SAME_GOVT_FIRING_IMMUNITY). Undefined (a caller with no weapon
 * effect in hand, like the guided-lock provocation in flock.ts) leaves
 * only the group test.
 *
 * A weapon with no group (none of our creation paths produce one, but
 * wire/legacy entities might) is never immune to anything: with
 * undefined on both sides an ownerless weapon would otherwise match
 * every group-less victim and sail through e.g. asteroids.
 *
 * `victimDisabled` cancels immunity entirely: a DISABLED ship is dead in
 * space and loses its fleet/carrier friendly-fire protection, so a
 * fleetmate's — and the player's own — shots connect (to finish it off,
 * or to keep it soft for boarding). The collision callers pass the
 * victim's DisabledComponent presence; other callers (e.g. the
 * guided-lock provocation in flock.ts) leave it at its false default so
 * their group semantics are unchanged.
 */
export function firingImmune(
    weaponGroup: string | undefined, victimGroup: string | undefined,
    weaponGovt: string | undefined, victimGovt: string | undefined,
    victimDisabled = false, kind?: FiringWeaponKind): boolean {
    if (victimDisabled) {
        return false;
    }
    if (weaponGroup !== undefined && weaponGroup === victimGroup) {
        return true;
    }
    // Same-govt immunity, for the weapon effects that have it (see
    // SAME_GOVT_FIRING_IMMUNITY).
    if (kind !== undefined && SAME_GOVT_FIRING_IMMUNITY[kind]
        && weaponGovt !== undefined && weaponGovt === victimGovt) {
        return true;
    }
    return false;
}

/**
 * Whether the "a disabled victim loses friendly-fire immunity" carve-out
 * applies to this pair — i.e. what to pass as `victimDisabled` above.
 *
 * It never applies to the shot's OWN FIRER. The carve-out exists so a
 * fleetmate (or the player) can finish off, or keep soft, a hulk that is
 * dead in space; a ship's own weapon passing back through itself is a
 * different thing entirely, and no version of the original game does it.
 *
 * The case that makes this visible is a wëap with AmmoType -999, which
 * destroys the firer AS THE SHOT LEAVES: the ship drops to zero armor,
 * ShipDisableSystem marks it disabled on the same tick, and its own shot
 * — still sitting on top of it, with a proximity fuse wide enough to
 * cover it — would detonate on the corpse instead of flying on to the
 * target. That is the entire Intelligent EMP Torpedo plug-in failing at
 * the last inch. The same hole is reachable without -999 at all: any
 * ship disabled while its own shots are still in flight used to be hit
 * by them.
 *
 * `weaponSource` is the SourceComponent of the shot — the entity that
 * actually fired it, which for a bay fighter's gun is the fighter and
 * not the carrier. Undefined (no source recorded) leaves the carve-out
 * exactly as it was.
 */
export function disabledCancelsImmunity(victimUuid: string,
    victimDisabled: boolean, weaponSource: string | undefined): boolean {
    return victimDisabled && victimUuid !== weaponSource;
}

/**
 * A potential victim's effective firing group: its explicit group if it
 * has one (fleet members, bay fighters), else its owner-chain root
 * (weapon entities and legacy owned entities), else its own uuid (a
 * lone ship is its own one-member group). Callers pass the victim's
 * component values so this stays a pure string pick usable anywhere.
 */
export function victimFiringGroup(group: FiringGroup | undefined,
    ownerUuid: string | undefined, uuid: string): string {
    return group?.group ?? ownerUuid ?? uuid;
}
