import { loadPilotProfile, PilotProfile } from '../title/client_prefs.js';
import {
    mostRecentlyActivatedRank, rankConversationName,
    rankConversationNamesForGovt,
} from '../nova_plugin/ncb/index.js';
import { displayName } from '../nova_plugin/core/index.js';
import { MissionUniverse } from './mission_universe.js';

/**
 * The player-identity wildcard values (<PN>, <PNN>, <PSN>, <PST>, and the
 * rank tags <PRK>/<SRK>/<PSR>) for expandMissionText, from the active pilot
 * profile, the player's current hull, and their active ränks.
 *
 * The ship NAME follows the convention the title screen and the sigma
 * reference screenshot use ("Are you Matt, Captain of the Starbridge
 * 525?"): the hull's type name plus the pilot's stable ship number.
 */
export interface PlayerIdentitySubs {
    playerName?: string;
    playerNickname?: string;
    playerShipName?: string;
    playerShipType?: string;
    rankName?: string;
    rankShortName?: string;
    /** <PRKnnn> / <SRKnnn>, see mission_text.ts. */
    rankForGovt?(govtNumber: number):
        { convName: string, shortName: string } | undefined;
    /** <RRK>, see mission_text.ts. */
    recentRankName?: string;
}

/**
 * The gövt a dësc's bare `nnn` in <PRKnnn> / <SRKnnn> names. Stock-first,
 * like every other bare number in the data (mission_logic's
 * resolveNumberedResource): `nova:nnn` when stock defines it. The text
 * expansion has no mission prefix in hand — the identity substitutions
 * are shared by every dësc the client shows — so a plug-in's own
 * government is found the only other way it can be: among the govts
 * the player's ACTIVE ranks are affiliated with, by resource number.
 */
function rankGovtId(universe: MissionUniverse,
    ranks: Iterable<string> | undefined, govtNumber: number):
    string | undefined {
    const stock = `nova:${govtNumber}`;
    if (universe.getGovt(stock)) {
        return stock;
    }
    for (const id of ranks ?? []) {
        const affil = universe.getRank(id)?.affilGovt;
        if (affil && affil.endsWith(`:${govtNumber}`)) {
            return affil;
        }
    }
    return undefined;
}

export async function playerIdentitySubs(universe: MissionUniverse,
    shipId?: string,
    /** Profile override for tests; defaults to the stored pilot profile. */
    profileOverride?: PilotProfile,
    /** The player's active ränks, for <PRK>/<SRK>/<PSR>. */
    ranks?: Iterable<string>): Promise<PlayerIdentitySubs> {
    const profile = profileOverride ?? loadPilotProfile();
    const shipType = shipId
        ? await universe.shipTypeName(shipId) : undefined;
    const getRank = (id: string) => universe.getRank(id);
    return {
        playerName: profile?.name || undefined,
        playerNickname: profile?.nickname || undefined,
        playerShipName: shipType
            ? `${shipType} ${profile?.shipNumber ?? 1}` : undefined,
        playerShipType: shipType,
        rankName: rankConversationName(ranks, getRank, false),
        rankShortName: rankConversationName(ranks, getRank, true),
        rankForGovt: n => rankConversationNamesForGovt(ranks, getRank,
            rankGovtId(universe, ranks, n)),
        recentRankName: recentRankResourceName(getRank),
    };
}

/**
 * <RRK>: the resource name of the rank rank_logic saw activated most
 * recently this session, with the author's "; note" suffix stripped as
 * the player-info Honors page strips it. Undefined when nothing has been
 * activated this session or the rank cannot be resolved.
 */
function recentRankResourceName(
    getRank: (id: string) => { name: string } | undefined):
    string | undefined {
    const id = mostRecentlyActivatedRank();
    const name = id ? getRank(id)?.name : undefined;
    // A hidden rank ("; Rebel 1" — nothing but the author's note) has no
    // displayable name and takes the "captain" fallback.
    return (name && displayName(name)) || undefined;
}
