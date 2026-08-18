import { WeaponData } from 'novadatainterface/weapon_data';

/**
 * ============================================================================
 * How far a weapon can reach, and what that means for a SUICIDE weapon
 * ============================================================================
 *
 * A wëap with AmmoType -999 destroys the ship that fires it (EVN Bible
 * ~:3124, "Ship is destroyed when weapon is fired"). That turns "when do
 * I pull the trigger?" from a matter of taste into a matter of
 * arithmetic: a ship gets exactly ONE shot ever, so firing it out of
 * range does not waste a round, it wastes the ship.
 *
 * The AI's ordinary fire rule is a single flat radius shared by every
 * weapon (NPC_FIRE_RANGE / ESCORT_FIRE_RANGE, both 1200px) — fine when
 * the cost of a miss is one round of ammo, ruinous for a weapon whose
 * cost is the hull. The Intelligent EMP Torpedo plug-in is the case that
 * makes this visible: its torpedo (a bay fighter) carries wëap 261 "CD
 * exp", a 45px/s shot that lives 100ms with a 120px proximity fuse — a
 * reach of ~124px against a trigger that would otherwise be pulled at
 * 1200. Every torpedo would blow itself up a full screen away from its
 * victim.
 *
 * So the fire control systems ask this module how far the shot can
 * actually get, and hold a suicide weapon until the victim is inside
 * that. It is a wëap-field rule, not a plug-in rule: any weapon with
 * AmmoType -999 gets it.
 */

/**
 * How far from the firing ship a shot from `weapon` can still touch a
 * target, in pixels.
 *
 * PROJECTILE: how far the shot flies before it expires
 * (speed x lifetime) plus its proximity-fuse radius, which is the
 * hurtbox the shot carries with it (projectile_plugin builds a circle of
 * exactly proxRadius). Deliberately NOT plus blastRadius: a blast only
 * happens where the shot detonates, and a shot that never reaches
 * anything never detonates (detonateWhenShotExpires aside), so the blast
 * extends what a connecting shot damages rather than how far it can
 * connect. Measuring center-to-center, this is a conservative
 * UNDER-estimate — the victim's own hull sticks out toward the shot — so
 * a ship that closes to this distance is comfortably inside the fuse.
 *
 * BEAM: the beam's drawn length, which is its reach.
 *
 * BAY: unbounded. A bay launches a ship rather than throwing something
 * at a target, so there is no range at which the launch fails.
 */
export function weaponReach(weapon: WeaponData): number {
    switch (weapon.type) {
        case 'ProjectileWeaponData':
            return weapon.physics.speed * weapon.shotDuration / 1000
                + weapon.proxRadius;
        case 'BeamWeaponData':
            return weapon.beamAnimation.length;
        case 'BayWeaponData':
            return Infinity;
    }
}

/**
 * Whether `weapon` may be fired at a victim `distanceSquared` away
 * (squared px, center to center).
 *
 * Only SUICIDE weapons are restricted; everything else is left to the
 * caller's own flat fire radius, exactly as before. Written as a
 * predicate over squared distance so callers never take a square root.
 */
export function suicideWeaponInReach(weapon: WeaponData,
    distanceSquared: number): boolean {
    if (!weapon.destroyShipWhenFiring) {
        return true;
    }
    const reach = weaponReach(weapon);
    return distanceSquared <= reach * reach;
}

/**
 * The shortest reach among the SUICIDE weapons this ship mounts, or
 * undefined when it mounts none.
 *
 * Used as an attack standoff: a ship whose killing blow only lands at
 * 124px has no business holding station at 250px. Taking the SHORTEST
 * (rather than, say, the longest) is what makes every suicide weapon
 * aboard usable — closing further than one of them needs costs nothing,
 * since the ship is being spent either way.
 *
 * `getWeapon` is the caller's cached lookup; ids whose data is not
 * cached yet are skipped, which is the same warmth-dependent treatment
 * every other fire-control decision in the escort/NPC systems already
 * gives an uncached weapon id.
 */
export function shortestSuicideReach(weaponIds: Iterable<string>,
    getWeapon: (id: string) => WeaponData | undefined): number | undefined {
    let shortest: number | undefined;
    for (const id of weaponIds) {
        const weapon = getWeapon(id);
        if (!weapon?.destroyShipWhenFiring) {
            continue;
        }
        const reach = weaponReach(weapon);
        if (shortest === undefined || reach < shortest) {
            shortest = reach;
        }
    }
    return shortest;
}

/**
 * The shortest reach among a ship's suicide weapons, read from its SYNCED
 * weapon states (WeaponState.suicideReach, copied from the data when the
 * states derived), or undefined when it mounts none. This is the form the
 * simulation's steering must use: `shortestSuicideReach` above takes a
 * data lookup, and a getCached lookup there is per-world cache warmth,
 * not shared state.
 */
export function shortestSuicideReachOfStates(
    weapons: Iterable<readonly [string, { suicideReach?: number }]>):
    number | undefined {
    let shortest: number | undefined;
    for (const [, state] of weapons) {
        if (state.suicideReach !== undefined
            && (shortest === undefined || state.suicideReach < shortest)) {
            shortest = state.suicideReach;
        }
    }
    return shortest;
}

/**
 * The synced-state form of suicideWeaponInReach: the fire trigger for a
 * suicide weapon from WeaponState.suicideReach (copied from the data at
 * derivation), so the decision never reads getCached — a cold cache on
 * one peer must not hold a trigger a warm peer pulls (review r14 M1).
 * A weapon with no suicideReach is not a suicide weapon: always true.
 */
export function suicideWeaponInReachState(
    state: { suicideReach?: number }, distanceSquared: number): boolean {
    const reach = state.suicideReach;
    return reach === undefined || distanceSquared <= reach * reach;
}
