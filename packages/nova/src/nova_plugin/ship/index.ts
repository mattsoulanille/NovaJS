/**
 * ship: what a ship entity is, independent of who flies it or what
 * shoots at it.
 *
 * The ship, outfit, health (shield/armor/fuel/ionization), cargo, cloak,
 * ionization and death plugins; the disabled, boarding, target, fold,
 * firing-group and weapons-state components; the projectile/blast owner
 * components; the ship-explosion and blast value types; makeShip.
 *
 * No firing, targeting or AI: those are `combat` and `npc`, which read
 * these components.
 */
export * from './blast_data.js';
export * from './boarding_component.js';
export * from './weapons_state.js';
export * from './weapon_range.js';
export * from './outfit_plugin.js';
export * from './disabled_component.js';
export * from './health_plugin.js';
export * from './target_component.js';
export * from './ship_plugin.js';
export * from './cargo_plugin.js';
export * from './ship_explosion.js';
export * from './death_plugin.js';
export * from './cloak_plugin.js';
export * from './firing_group.js';
export * from './fold_state.js';
export * from './ionization_plugin.js';
export * from './make_ship.js';
export * from './weapon_components.js';

import { Domain, domainPlugin } from '../core/index.js';
import { ShipPlugin } from './ship_plugin.js';
import { DeathPlugin } from './death_plugin.js';
import { OutfitPlugin } from './outfit_plugin.js';
import { HealthPlugin } from './health_plugin.js';
import { CloakPlugin } from './cloak_plugin.js';
import { IonizedPlugin } from './ionization_plugin.js';
import { CargoPlugin } from './cargo_plugin.js';

export const ShipDomain: Domain = {
    name: 'ship',
    dependsOn: ['core', 'player'],
    plugins: [ShipPlugin, DeathPlugin, OutfitPlugin, HealthPlugin, CloakPlugin, IonizedPlugin, CargoPlugin],
};
export const ShipDomainPlugin = domainPlugin(ShipDomain);
