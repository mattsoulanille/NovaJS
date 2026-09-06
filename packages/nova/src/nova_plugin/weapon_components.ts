import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';

/**
 * The three weapon components that half the simulation needs to NAME
 * without needing anything else fire_weapon_plugin does.
 *
 * They live in this leaf module — which imports nothing local — purely
 * to keep the import graph acyclic. fire_weapon_plugin re-exports all
 * three, so every existing `import { OwnerComponent } from
 * './fire_weapon_plugin.js'` keeps working; what changed is that
 * fire_weapon_plugin itself now reaches into the rest of the simulation
 * (hostility.ts, ship_plugin.ts, flock.ts) to decide what a point
 * defense turret shoots at. Those modules in turn want OwnerComponent
 * and SourceComponent, and a module-scope `new System({args:
 * [SourceComponent, ...]})` in a cycle reads the binding before
 * fire_weapon_plugin's body has run — a TDZ ReferenceError at load, not
 * a type error. Importing the components from here instead of from
 * fire_weapon_plugin removes the back edge outright.
 */

// An object wrapper around one string because DeltaMaker drafts every
// registered component with immer, which needs draftable data. Tracker
// issue: let the delta system carry primitive component data.
export const OwnerComponentType = t.type({ owner: t.string });
export type OwnerComponentType = t.TypeOf<typeof OwnerComponentType>;

/**
 * Who a spawned weapon entity (projectile, beam, bay fighter) belongs
 * to: the uuid of the ship whose side it is on, which for an escort's or
 * a bay fighter's shots is the escort/fighter itself rather than the
 * player.
 */
export const OwnerComponent = new Component<OwnerComponentType>('Owner');

/** The uuid of the entity a weapon entity was fired FROM. */
export const SourceComponent = new Component<string>('Source');

/**
 * "Point defense may aim at this."
 *
 * Two unrelated resource flags mean it, and both land here:
 *  - a homing wëap WITHOUT Flags 0x0080 ("Weapon can't be targeted by
 *    point defense systems", EVN Bible ~:3189) — projectile_plugin;
 *  - a shïp WITH Flags2 0x0008 ("Ship can be fired on by point defense
 *    systems", ~:2572) — fire_weapon_plugin's
 *    ShipPointDefenseVulnerabilitySystem.
 * Which is exactly the Bible's own description of what a PD turret
 * shoots: "incoming guided weapons and nearby ships" (~:3103).
 */
export const VulnerableToPD = new Component<undefined>('VulnerableToPD');
