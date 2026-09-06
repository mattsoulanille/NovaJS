/**
 * travel: moving between and landing on things.
 *
 * Planets and landing (PlanetPlugin, makePlanet), the ship controller
 * that applies control input to a ship, hyperspace jumps and jump
 * readiness, hypergate transit and its destination resolver, transit
 * recovery for interrupted trips, and the afterburner.
 */
export * from './planet_plugin.js';
export * from './ship_controller_plugin.js';
export * from './jump_readiness.js';
export * from './jump_plugin.js';
export * from './afterburner_plugin.js';
export * from './gate_destination_resolver.js';
export * from './gate_transit_plugin.js';
export * from './make_planet.js';
export * from './transit_recovery.js';

import { Domain, domainPlugin } from '../core/index.js';
import { ShipController } from './ship_controller_plugin.js';
import { PlanetPlugin } from './planet_plugin.js';
import { JumpPlugin } from './jump_plugin.js';
import { GateTransitPlugin } from './gate_transit_plugin.js';
import { AfterburnerPlugin } from './afterburner_plugin.js';

export const TravelDomain: Domain = {
    name: 'travel',
    dependsOn: ['core', 'ncb', 'player', 'reputation', 'ship'],
    plugins: [ShipController, PlanetPlugin, JumpPlugin, GateTransitPlugin, AfterburnerPlugin],
};
export const TravelDomainPlugin = domainPlugin(TravelDomain);
