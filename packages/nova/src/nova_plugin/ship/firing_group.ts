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
 *    inherit their projectile's group (projectile_plugin).
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
     * on WEAPON entities only (ships read their own GovtComponent).
     * Unused until the same-govt clause below is enabled.
     */
    govt: t.string,
})]);
export type FiringGroup = t.TypeOf<typeof FiringGroup>;
export const FiringGroupComponent = new Component<FiringGroup>('FiringGroup');

/**
 * Whether friendly-fire immunity extends to ALL ships of the same
 * government, not just the same fleet/owner group.
 *
 * DISABLED pending Matthew's research: he suspects the original game
 * MAY make all NPCs of the same govt immune to each other's fire, but
 * is not sure. The clause is wired end to end (both collision sides'
 * govt ids reach firingImmune), so enabling it is this one-line flip.
 */
export const SAME_GOVT_FIRING_IMMUNITY = false;

/**
 * The pair-immunity predicate: should a weapon with the given firing
 * group/govt pass through (NOT hit) a victim with the given effective
 * group/govt?
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
    victimDisabled = false): boolean {
    if (victimDisabled) {
        return false;
    }
    if (weaponGroup !== undefined && weaponGroup === victimGroup) {
        return true;
    }
    // Same-govt immunity (see SAME_GOVT_FIRING_IMMUNITY): present but
    // disabled pending Matthew's research on the original game.
    if (SAME_GOVT_FIRING_IMMUNITY
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
