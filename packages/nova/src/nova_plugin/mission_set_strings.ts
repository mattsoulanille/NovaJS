import { startMissionById } from './mission_accept_offer.js';
import { resolveNumberedResource, systemDiscoveryOperators } from './mission_ids.js';
import { MissionMachineryContext } from './mission_machinery.js';
import { abortMission, failMission } from './mission_transitions.js';
import {
    makeControlBitHooks, NCBParseError, NCBSetHooks, runNCBSet,
} from './ncb.js';

/**
 * Running a mission's set strings (OnAccept, OnSuccess, ...): the NCB set
 * hooks wired to the real machinery — outfits, ranks, discovery, ship
 * changes and the Sxxx/Axxx/Fxxx mission operators. Split out of
 * mission_logic.ts. Imports mission_accept_offer / mission_transitions and is
 * imported by them: the cycle is function-level only (nothing runs at
 * module evaluation), exactly the recursion the single file had.
 */

/**
 * Builds the NCB set hooks for running mission set strings: bit
 * mutation plus the mission operators Sxxx/Axxx/Fxxx wired to the
 * real machinery. `runningMissionPrefix` scopes numeric ids to the
 * plug-in that defined the running expression.
 *
 * Outfit granting (Gxxx/Dxxx) is only wired when the caller supplies
 * an outfits map (the mission board does; landing processing does), and
 * system exploration (Xxxx) only when it supplies a discovery record.
 */
export function makeMissionSetHooks(machinery: MissionMachineryContext,
    runningMissionPrefix: string,
    outfits?: Map<string, number>, depth = 0): NCBSetHooks {
    const { state } = machinery;
    // Kxxx/Lxxx resolve their ränk number stock-first, exactly like every
    // sibling operator (resolveNumberedResource, keyed on the WRITING
    // plug-in's prefix): stock's rank n when stock defines it, else the
    // writer's own — which is also the id recorded when NEITHER defines n
    // (activateRank keeps unknown ids so a not-loaded plug-in's rank
    // survives a save; the writer's id is the one it would come back to).
    const rankExists = machinery.getRank
        && ((globalId: string) => machinery.getRank!(globalId) !== undefined);
    const hooks = makeControlBitHooks(state.bits, outfits ? {
        outfits,
        resolveId: id => resolveNumberedResource(
            id, runningMissionPrefix, machinery.outfitExists),
    } : undefined, state.ranks ? {
        active: state.ranks,
        resolveId: id => resolveNumberedResource(
            id, runningMissionPrefix, rankExists),
        getRank: id => machinery.getRank?.(id),
    } : undefined, systemDiscoveryOperators(machinery.discovery,
        runningMissionPrefix, machinery.systemExists));

    // Cxxx/Exxx/Hxxx, when the caller can swap the player's hull (the
    // outfitter can; see MissionMachineryContext.changeShip). The shïp
    // number resolves stock-first like every sibling operator.
    const { changeShip } = machinery;
    if (changeShip) {
        hooks.changeShip = (id, mode) => changeShip(resolveNumberedResource(
            id, runningMissionPrefix, machinery.shipExists), mode);
    }

    if (depth > 4) {
        // Guard against Sxxx/Axxx/Fxxx cycles in scripting.
        return hooks;
    }

    // Sxxx/Axxx/Fxxx resolve their mïsn number the same stock-first way
    // (getMission doubles as the missions-exists lookup; MissionUniverse
    // keeps missionsById). A plug-in's S<stock-n> starts nova:n rather
    // than warning about a phantom id under the plug-in's own prefix.
    const resolveMissionId = (id: number) => resolveNumberedResource(
        id, runningMissionPrefix,
        globalId => machinery.getMission(globalId) !== undefined);
    hooks.startMission = id => {
        startMissionById(machinery, resolveMissionId(id), outfits, depth + 1);
    };
    hooks.abortMission = id => {
        const globalId = resolveMissionId(id);
        if (state.missions.has(globalId)) {
            abortMission(machinery, globalId, outfits, depth + 1);
        }
    };
    hooks.failMission = id => {
        const globalId = resolveMissionId(id);
        if (state.missions.has(globalId)) {
            failMission(machinery, globalId, outfits, depth + 1);
        }
    };
    return hooks;
}

export function runMissionSetString(machinery: MissionMachineryContext,
    expression: string, missionPrefix: string,
    outfits?: Map<string, number>, depth = 0): void {
    if (!expression) {
        return;
    }
    try {
        runNCBSet(expression,
            makeMissionSetHooks(machinery, missionPrefix, outfits, depth),
            machinery.random);
    } catch (e) {
        if (e instanceof NCBParseError) {
            console.warn('Bad mission set string:', e.message);
            return;
        }
        throw e;
    }
}
