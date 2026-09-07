/**
 * reputation: how governments regard a ship.
 *
 * Legal records, combat rating, damage attribution and crime charging
 * (ReputationPlugin), IFF disposition, stellar landing clearance, the
 * government disposition tables and the hail response/bribe logic that
 * is a pure function of govt and record.
 */
export * from './reputation.js';
export * from './govt_disposition.js';
// Explicit so `stellarRecord` (by the planet's govt) does not collide with
// missions' stellarRecord(StellarInfo, ...) — which mission_logic's facade
// re-exports — for a module importing both domains; every other export
// keeps its name.
export {
    MIN_STATUS_IGNORED, MIN_STATUS_NEVER, contributeBits, govtRequirementsMet,
    isMissionDestination, stellarClearance, clearanceDenial, planetClearance,
    stellarRecord as govtStellarRecord,
} from './stellar_clearance.js';
export type {
    ClearanceDenial, StellarClearance, ClearanceStellar, ClearancePlayer,
    MissionDestinations,
} from './stellar_clearance.js';
export * from './iff_plugin.js';
export * from './hail.js';
export * from './reputation_plugin.js';
// iff_plugin's `Disposition` (hostile/friendly/neutral, what the HUD
// colours) and govt_disposition's (ally/neutral/enemy, the gövt table)
// share a name; the IFF one is what other domains read.
export type { Disposition } from './iff_plugin.js';

import { Domain, domainPlugin } from '../core/index.js';
import { ReputationPlugin } from './reputation_plugin.js';
import { IffPlugin } from './iff_plugin.js';

export const ReputationDomain: Domain = {
    name: 'reputation',
    dependsOn: ['core', 'ncb', 'ship'],
    plugins: [ReputationPlugin, IffPlugin],
};
export const ReputationDomainPlugin = domainPlugin(ReputationDomain);
