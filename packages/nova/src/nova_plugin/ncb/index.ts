/**
 * ncb: Nova Control Bits and the ranks they grant.
 *
 * The NCB expression parser/evaluator, the ControlBits / ActiveRanks /
 * AggressionSuppressGovts components, rank logic (privileges, salaries,
 * price mods), conditional dësc text and the per-plug-in bit namespacing
 * used by saves.
 */
export * from './control_bit_namespaces.js';
export * from './rank_logic.js';
export * from './ncb.js';
export * from './desc_text.js';
export * from './ncb_plugin.js';
// Both ncb_plugin (the io-ts codec) and rank_logic (a plain alias) name
// their rank set `ActiveRanks`; the codec's type is the one the world
// carries.
export type { ActiveRanks } from './ncb_plugin.js';

import { Domain, domainPlugin } from '../core/index.js';
import { NCBPlugin } from './ncb_plugin.js';

export const NcbDomain: Domain = {
    name: 'ncb',
    dependsOn: ['core'],
    plugins: [NCBPlugin],
};
export const NcbDomainPlugin = domainPlugin(NcbDomain);
