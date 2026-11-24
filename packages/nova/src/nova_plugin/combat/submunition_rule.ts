import { SubmunitionType, WeaponData } from 'novadatainterface/weapon_data';

/**
 * ============================================================================
 * When does a shot fire its submunitions?
 * ============================================================================
 *
 * How a shot ended, as far as its submunitions care:
 *
 *  - 'expired': it ran out its life (wëap Count) without detonating. A
 *    beam always ends this way (below).
 *  - 'proximity': its proximity fuse (wëap ProxRadius) fired before it
 *    touched anything (projectile_plugin's ProjectileProximityFuseSystem).
 *  - 'directHit': a projectile's sprite struck a body (a ship, or anything
 *    else it can hit).
 *
 * Measured on the original (docs/reference_experiments.md, "Submunitions
 * wave 10"): a direct hit never fires submunitions. Subs come from exactly
 * two events, the Bible's "when the shot reaches the end of its life or
 * detonates because something wanders into its proximity radius": the
 * shot expiring (unless the wëap sets Flags2 0x0020, parsed as
 * `subIfExpire: false`), or its proximity fuse firing before the body is
 * touched. 18 direct hits over three runs (prox 0-20, two shot sizes, two
 * target sizes, guided and unguided, Flags2 0x0020 or not) subbed none;
 * every prox detonation and every expiry did.
 *
 * NovaJS DEPARTS DELIBERATELY from the original on one point: a direct hit
 * by a shot whose wëap ProxRadius is greater than zero DOES fire its
 * subs. On the original a small fuse (12 px or less against a 24 px
 * target) loses the race to the body, so the subs of e.g. the stock
 * Polaron Multi-Torp. (prox 10) almost never appear. Matthew's ruling
 * (2026-11-23): "I suspect that a plugin author who sets a proximity fuse
 * above zero would always want the submunitions to fire. [...] Prox
 * radius > 0 can serve as the flag that forces subs to fire". A wëap with
 * ProxRadius 0 (or negative) keeps the original's rule and never subs on
 * a direct hit; the Extra Outfits plug-in's Interference Missile (prox 0,
 * 6 Optimated IR Missiles) relies on exactly that: its description says
 * that if it hits its target before the missiles fire, they do nothing.
 * ProxSafety plays no part here: a shot inside its safety window strikes
 * nothing at all (projectileMayStrike), so it can make no direct hit.
 *
 * Beams are not under this rule. The original has no beam submunitions
 * (the wëap bytes a projectile reads as SubCount..SubLimit are filler in
 * a beam's record); beams launching subs, and beams as subs, are a
 * NovaJS extension of Matthew's, whose rule is that a beam subs at the
 * far end of its ray when it ends, whatever it hit, subject only to
 * Flags2 0x0020 (beam_plugin's BeamSystem passes 'expired'). A beam's
 * weapon data has no ProxRadius, so this function would treat it as 0
 * anyway.
 *
 * This is the ONE place the rule lives: every caller routes its sub
 * decision through WeaponEntry.fireSubs, which asks this function per
 * submunition entry.
 *
 * Pure and deterministic: a switch on plain values.
 */
export type ShotEnd = 'expired' | 'proximity' | 'directHit';

export function submunitionFires(
    weapon: Pick<WeaponData, 'type'> & { proxRadius?: number },
    sub: Pick<SubmunitionType, 'subIfExpire'>, end: ShotEnd): boolean {
    switch (end) {
        case 'directHit':
            return (weapon.proxRadius ?? 0) > 0;
        case 'proximity':
            return true;
        case 'expired':
            return sub.subIfExpire;
    }
}
