import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';

const WeaponState = t.intersection([t.type({
    count: t.number,
    firing: t.boolean,
}), t.partial({
    target: t.string,
    /**
     * The weapon's fire group, copied from its game data when the
     * state is derived. Carried in synced state so weapon selection
     * (secondary cycling, primary fire) never reads `getCached` at
     * input-application time — a cache-warmth-gated read there is
     * per-world state, and provably made an offline replay select a
     * different secondary than the live session.
     */
    fireGroup: t.string,
    /**
     * For a SUICIDE weapon (wëap AmmoType -999, WeaponData
     * destroyShipWhenFiring) the reach of its one shot in px, copied from
     * its game data when the state is derived — for the same reason as
     * fireGroup: an escort carrying one closes to this distance instead
     * of the ordinary standoff (escort_command_plugin attackStandoff), and
     * a steering decision must never read `getCached` (review r13 MEDIUM:
     * a cold cache on one peer fell back to the 250px standoff while a
     * warm one closed to 124px). Absent for every other weapon.
     */
    suicideReach: t.number,
    /**
     * Simulation time of the last shot this weapon ACTUALLY emitted, set
     * by WeaponsSystem on the same branch that stamps the local
     * `lastFired` reload clock — i.e. only when `fireFromEntity` really
     * returned a spawned entity.
     *
     * This exists because `firing` above is the held INTENT (the trigger
     * is down / the NPC wants to shoot), which is emphatically not the
     * same as a shot leaving the ship: a turret or beamTurret with no
     * target returns undefined from fireFromEntity, a point-defense
     * weapon with nothing in range does too, and a weapon out of ammo or
     * mid-reload never gets that far. The DISPLAY weapon-glow overlay
     * (shän WeapImage) must track real emission rather than intent, so it
     * needs a real-emission signal that survives the trip to the display
     * world — and WeaponsState is already delta-registered and mirrored,
     * where the per-weapon WeaponsComponent local state that holds the
     * reload clock is NOT (snapshot_policies calls it "mutable
     * unregistered simulation state").
     *
     * Deterministic: written straight from `time.time` on a branch every
     * peer takes identically. Optional so snapshots taken before the
     * field existed still decode.
     */
    lastFired: t.number,
})]);
export type WeaponState = t.TypeOf<typeof WeaponState>;

export const WeaponsState = map(t.string /* weapon id */, WeaponState);
export type WeaponsState = t.TypeOf<typeof WeaponsState>;
export const WeaponsStateComponent = new Component<WeaponsState>('WeaponsStateComponent');
