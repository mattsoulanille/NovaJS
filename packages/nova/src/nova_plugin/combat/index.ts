/**
 * combat: shooting and being shot.
 *
 * Firing (FireWeaponPlugin, exit points, blind spots, point defence,
 * guidance), the weapons and fold plugins, projectiles, beams, blasts,
 * ship explosions, jamming, targeting (TargetPlugin, hostility, flocks)
 * and the aggression record, plus asteroids and mining.
 *
 * Above `npc` because the firing gates consult NPC pacification and
 * formation state.
 */
export * from './aggression.js';
export * from './aggression_plugin.js';
export * from './flock.js';
export * from './point_defense.js';
export * from './hostility.js';
export * from './blind_spots.js';
export * from './guidance.js';
export * from './fire_weapon_plugin.js';
export * from './exit_point.js';
export * from './weapon_plugin.js';
export * from './beam_plugin.js';
export * from './jamming_plugin.js';
export * from './asteroid_plugin.js';
export * from './blast_plugin.js';
export * from './fold_plugin.js';
export * from './projectile_plugin.js';
export * from './ship_explosion_plugin.js';
export * from './target_plugin.js';

import { Domain, domainPlugin } from '../core/index.js';
import { FireWeaponPlugin } from './fire_weapon_plugin.js';
import { ProjectilePlugin } from './projectile_plugin.js';
import { WeaponPlugin } from './weapon_plugin.js';
import { FoldPlugin } from './fold_plugin.js';
import { JammingPlugin } from './jamming_plugin.js';
import { AggressionPlugin } from './aggression_plugin.js';
import { TargetPlugin } from './target_plugin.js';
import { BeamPlugin } from './beam_plugin.js';
import { BlastPlugin } from './blast_plugin.js';
import { ShipExplosionPlugin } from './ship_explosion_plugin.js';
import { AsteroidPlugin } from './asteroid_plugin.js';

export const CombatDomain: Domain = {
    name: 'combat',
    dependsOn: ['core', 'ncb', 'npc', 'player', 'reputation', 'ship'],
    plugins: [FireWeaponPlugin, ProjectilePlugin, WeaponPlugin, FoldPlugin, JammingPlugin, AggressionPlugin, TargetPlugin, BeamPlugin, BlastPlugin, ShipExplosionPlugin, AsteroidPlugin],
};
export const CombatDomainPlugin = domainPlugin(CombatDomain);
