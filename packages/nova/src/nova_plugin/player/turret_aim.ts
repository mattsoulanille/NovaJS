import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { ControlledByComponent, findControlledEntity } from './ship_control.js';

/**
 * How a PLAYER's own projectile turrets (wëap Guidance 4) aim: the exact
 * intercept (`accurate`, NovaJS's) or the original's first-order lead
 * (reference "A turret's lead, and a lead into a blind sector (the T
 * leftover), wave 50": 47 shots within 0.6 +- 0.9 deg of first order,
 * 7-30 deg off the intercept).
 *
 * MAINTAINER RULING (Matthew, 2026-11-27): "the original game's turrets
 * are rather inaccurate. We can have a toggle for the player ship to use
 * one or the other." So NPC turrets (escorts and bay fighters included)
 * always lead to first order, and each player picks for their OWN ship
 * with the Enhancements toggle "Accurate turret aim" (enhancements.ts
 * `enhAccurateTurretAim`, default ON = exact).
 *
 * It changes the simulation, so it is SYNCED state on the player's ship,
 * not a client-only pref: the client stamps it on the ship it inserts
 * (client/fleet_insertion.ts, every entry and re-entry rides the addEntity
 * record) and sends a `setTurretAim` input record when the pref changes in
 * flight (applySetTurretAim), so every peer aims that player's turrets the
 * same way. Like StrictPlayComponent it is the pilot's, carried across a
 * change of hull (missions/mission_ship_change.ts PLAYER_STATE_COMPONENTS).
 * Replaced, never mutated.
 */
export const TurretAimType = t.type({ accurate: t.boolean });
export type TurretAim = t.TypeOf<typeof TurretAimType>;
export const TurretAimComponent = new Component<TurretAim>('TurretAim');

/**
 * Whether `firer`'s projectile turrets aim at the exact intercept: only a
 * player-controlled ship (ControlledByComponent) can, as its TurretAim
 * says; a player ship without one (none is inserted without it; a spec's
 * hand-built ship) takes the toggle's default, accurate. Everything else
 * leads to first order. A pure function of synced state.
 */
export function aimsTurretsAccurately(firer: Entity): boolean {
    if (!firer.components.has(ControlledByComponent)) {
        return false;
    }
    return firer.components.get(TurretAimComponent)?.accurate ?? true;
}

/**
 * Applies a peer's `setTurretAim` input to the ship it controls (and only
 * that one). The payload is a boolean the wire codec already checked;
 * a peer with no ship in this world changes nothing.
 */
export function applySetTurretAim(world: World, peerId: string | undefined,
    accurate: boolean) {
    const found = findControlledEntity(world, peerId);
    if (!found) {
        return;
    }
    found.entity.components.set(TurretAimComponent, { accurate: accurate === true });
}
