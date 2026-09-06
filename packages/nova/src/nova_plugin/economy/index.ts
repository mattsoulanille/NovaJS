/**
 * economy: prices.
 *
 * Trade goods and tier pricing, and öops price events.
 */
export * from './trade_logic.js';
export * from './price_events.js';

import { Domain, domainPlugin } from '../core/index.js';

export const EconomyDomain: Domain = {
    name: 'economy',
    dependsOn: ['core', 'missions', 'ncb', 'ship'],
    plugins: [],
};
export const EconomyDomainPlugin = domainPlugin(EconomyDomain);
