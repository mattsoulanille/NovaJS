/**
 * The behavioral aggression record (who has recently attacked a player's
 * ship) lives in npc/aggression.ts: the NPC decision step reads it too — a
 * protecting special ship engages whoever is attacking its player, by the
 * same tier-3 test the target brackets use (npc/allegiance.ts's
 * isAttackingPlayer) — and npc sits below combat in the domain order.
 * Re-exported here, where its writers (aggression_plugin, flock.ts's
 * guided-lock provocation) and most of its readers already look for it.
 */
export {
    AGGRESSION_DAMAGE_THRESHOLD, AGGRESSION_WINDOW_MS, AggressionComponent,
    AggressionEntry, AggressionState, applyAggression, clearCarriedAggression,
    clearCarriedAggressionForTransition, isRecentAggressor, recordAggression,
    sweepAggression,
} from '../npc/index.js';
export type { AggressiveAct } from '../npc/index.js';
