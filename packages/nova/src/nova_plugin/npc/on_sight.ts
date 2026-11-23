import { Entity } from 'nova_ecs/entity';
import { GovtData } from 'novadatainterface/govt_data';
import { govtDispositionTo, LegalRecords } from '../reputation/index.js';
import { flockRoot } from './allegiance.js';
import { NpcComponent } from './npc_component.js';

/**
 * ============================================================================
 * On sight: which ships go looking for a fight
 * ============================================================================
 *
 * The NPC brain (npc_decision.ts's NpcDecisionSystem) splits its ships in
 * two. WARSHIPS (AI 3) and INTERCEPTORS (AI 4) hunt every ship their
 * government counts as an enemy (govtDispositionTo 'enemy': the gövt
 * enemies classes, the xenophobic and always-attacks flags, and a legal
 * record below -CrimeTol). TRADERS (AI 1 wimpy, AI 2 brave) never do: they
 * only react to a ship that has actually shot at them (AI 1 runs, AI 2
 * fights back while the odds hold).
 *
 * This module is that split, written once, so the brain and the IFF colour
 * (combat/hostility.ts's styleForTarget: target brackets, radar blips, the
 * 'r' key, the comm channel) read the same predicate and cannot disagree.
 * Reference K9 (docs/reference_experiments.md) and Matthew's ruling
 * (2026-11-23): "IFF bracket colors correspond to hostility regardless of
 * govt's stance." On the original, AI 1 traders of a govt hostile to the
 * player (by gövt 0x0004 or by the player's record) show YELLOW brackets
 * while that govt's warships, which attack, show red.
 */

/**
 * Whether a ship of this AI type hunts its government's enemies on sight:
 * warships (3) and interceptors (4). The cases of NpcDecisionSystem's AI
 * switch that read its hostiles list are exactly these.
 */
export function huntsOnSight(aiType: number | undefined): boolean {
    return aiType === 3 || aiType === 4;
}

/**
 * Whether a ship flying AI `aiType` for government `selfGovt` attacks a
 * ship of government `otherGovt` (with `otherRecords`, its legal records
 * when it is a player) on sight, before either has fired: it hunts
 * (huntsOnSight) and its government counts the other as an enemy
 * (govtDispositionTo — the same call, with the same ränk 0x0100
 * suppression, that NpcDecisionSystem makes for its hostiles list).
 *
 * Range and MaxOdds are deliberately not part of it. They decide WHEN a
 * hunter engages (an interceptor stays near its planet, a warship
 * outmatched holds off), not WHETHER it is hostile.
 */
export function attacksOnSight(aiType: number | undefined,
    selfGovt: GovtData | undefined, otherGovt: GovtData | undefined,
    otherRecords?: LegalRecords, otherRankSuppresses?: boolean): boolean {
    return huntsOnSight(aiType) && govtDispositionTo(selfGovt, otherGovt,
        otherRecords, otherRankSuppresses) === 'enemy';
}

/**
 * The AI type that decides whether `uuid` attacks on sight: its own
 * NpcComponent's, or, for a ship with no NPC brain of its own, its flock
 * root's (allegiance.ts's flockRoot). The second case is an NPC carrier's
 * bay fighter: it has no NpcComponent and flies on the escort command its
 * carrier gives it, so it goes hunting exactly when the carrier does.
 * Undefined for a ship nobody's NPC brain flies (another player's ship, a
 * player's own escorts), which hunts nobody on sight.
 */
export function onSightAiType(uuid: string, entity: Entity,
    getEntity: (uuid: string) => Entity | undefined): number | undefined {
    const own = entity.components.get(NpcComponent)?.aiType;
    if (own !== undefined) {
        return own;
    }
    const root = flockRoot(uuid, getEntity);
    if (root === undefined || root === uuid) {
        return undefined;
    }
    return getEntity(root)?.components.get(NpcComponent)?.aiType;
}
