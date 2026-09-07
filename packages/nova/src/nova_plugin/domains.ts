import { CoreDomain, Domain } from './core/index.js';
import { PlayerDomain } from './player/index.js';
import { ShipDomain } from './ship/index.js';
import { NcbDomain } from './ncb/index.js';
import { ReputationDomain } from './reputation/index.js';
import { TravelDomain } from './travel/index.js';
import { NpcDomain } from './npc/index.js';
import { CombatDomain } from './combat/index.js';
import { SpawnDomain } from './spawn/index.js';
import { EscortsDomain } from './escorts/index.js';
import { MissionsDomain } from './missions/index.js';
import { EconomyDomain } from './economy/index.js';
import { EncountersDomain } from './encounters/index.js';
import { PilotDomain } from './pilot/index.js';

/**
 * Every domain under nova_plugin/, lowest first: each entry's
 * `dependsOn` names only earlier entries. domain_graph_test checks
 * that this list, the directories on disk and the import graph agree.
 *
 * The files that stay at nova_plugin/'s root (this one, system_plugin,
 * make_system, snapshot_policies, server_plugin, nova_plugin) are the
 * composition root: they may import any domain and no domain imports
 * them.
 */
export const DOMAINS: readonly Domain[] = [
    CoreDomain,
    PlayerDomain,
    ShipDomain,
    NcbDomain,
    ReputationDomain,
    TravelDomain,
    NpcDomain,
    CombatDomain,
    SpawnDomain,
    EscortsDomain,
    MissionsDomain,
    EconomyDomain,
    EncountersDomain,
    PilotDomain,
];
