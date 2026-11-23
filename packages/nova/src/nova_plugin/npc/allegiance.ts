import { Entity } from 'nova_ecs/entity';
import {
    ControlledByComponent, EscortCommandComponent, PlayerEscortComponent,
} from '../player/index.js';
import {
    FiringGroupComponent, OwnerComponent, TargetComponent,
} from '../ship/index.js';
import { AggressionComponent, isRecentAggressor } from './aggression.js';
import { NpcComponent } from './npc_component.js';
import { FormationComponent } from './npc_formation.js';
import { ShootAllWeaponsComponent } from './npc_plugin.js';

/**
 * ============================================================================
 * Allegiance: whose side a ship is on
 * ============================================================================
 *
 * The parts of the hostility rule (combat/hostility.ts's styleForTarget)
 * that the NPC BRAIN needs as well as the HUD: the player's flock (tier 2)
 * and "is it attacking the player right now" (tier 3). They live here, in
 * npc, rather than in combat beside the rest of the rule, because the NPC
 * decision step has to call the SAME functions the corners call — a ship
 * the brackets paint as the player's own must be one its own brain never
 * hunts — and npc sits below combat in the domain order. combat re-exports
 * them (flock.ts, hostility.ts), so every existing caller is unchanged.
 */

/**
 * ============================================================================
 * The player's flock: every ship that ultimately follows the player
 * ============================================================================
 *
 * "Own escorts" is TRANSITIVE: a hired escort follows the player, that
 * escort's bay fighters follow the escort, and all of them belong to
 * the player's flock — untargetable by tab/r, cycled by the escort-
 * target control, drawn with friendly corners.
 *
 * A ship's parent link, in priority order:
 *  1. FormationComponent.leader — who it holds formation on (hired
 *     escorts, fleet escorts, idle bay fighters).
 *  2. OwnerComponent.owner — the bay owner chain for launched fighters
 *     that are currently fighting (no formation while engaged).
 *  3. FiringGroupComponent.group — the friendly-fire group id, which
 *     fire_weapon_plugin stamps from the firer's group or owner-chain
 *     root. This is the same root the firing-group immunity uses
 *     (victimFiringGroup's ownerRoot fallback), so "belongs to the
 *     player's flock" and "can't friendly-fire the player" cannot
 *     drift apart: the group id IS a precomputed chain root.
 *  4. PlayerEscortComponent.player — the DURABLE ownership marker, as a
 *     last resort. Every link above is live state that can lapse while
 *     the ship is still the player's (a command that drops the formation
 *     link, a leader briefly out of the world), and when they lapse the
 *     ship falls back into the general target cycle and out of the escort
 *     cycle even though the game still calls it an escort everywhere
 *     else. The marker is stamped only when the chain topped out at a
 *     player and is never cleared, so nothing outside the player's flock
 *     is reached by this step and no NPC fleet is affected. Membership is
 *     transitive, so hopping straight to the player root is the same
 *     answer the (lapsed) chain would have given.
 *
 * The walk is over synced, serializer-registered components only, so
 * every peer (and the display world) computes the same answer.
 * MAX_FLOCK_DEPTH plus a visited set guards against pathological
 * leader cycles (a following b following a).
 */
export const MAX_FLOCK_DEPTH = 8;

/**
 * One hop up the flock chain: who this ship follows, in the priority
 * order documented above (formation leader, then bay owner, then firing
 * group). The single definition of the chain edge, shared by isInFlock
 * and by the player-escort ownership walk (player_escort_plugin).
 */
export function flockParent(entity: Entity): string | undefined {
    return entity.components.get(FormationComponent)?.leader
        ?? entity.components.get(OwnerComponent)?.owner
        ?? entity.components.get(FiringGroupComponent)?.group
        ?? entity.components.get(PlayerEscortComponent)?.player;
}

/**
 * Whether the ship `uuid` belongs to `rootUuid`'s flock: following its
 * leader/owner/group chain reaches `rootUuid`. A ship is not in its
 * own flock (you can always target yourself... by not targeting).
 */
export function isInFlock(uuid: string, rootUuid: string,
    getEntity: (uuid: string) => Entity | undefined): boolean {
    if (uuid === rootUuid) {
        return false;
    }
    const visited = new Set<string>();
    let current = uuid;
    for (let depth = 0; depth < MAX_FLOCK_DEPTH; depth++) {
        if (visited.has(current)) {
            return false; // Leader cycle: nobody's flock.
        }
        visited.add(current);
        const entity = getEntity(current);
        if (!entity) {
            return false;
        }
        const parent = flockParent(entity);
        if (parent === undefined || parent === current) {
            return false;
        }
        if (parent === rootUuid) {
            return true;
        }
        current = parent;
    }
    return false;
}

/**
 * TIER 3 OF THE HOSTILITY RULE on its own: whether `targetEntity` is
 * attacking the player right now — the BEHAVIOURAL reading, no politics in
 * it. True when either
 *
 *  (a) its posture says so: its TargetComponent points at the player AND it
 *      is in NPC mode 'attack', OR it is another player's ESCORT engaging us
 *      (EscortCommandComponent 'attack' or 'defend'), OR it carries the
 *      legacy dev-enemy ShootAllWeapons marker; or
 *  (b) it is a RECENT AGGRESSOR (aggression.ts): it shot the player, or
 *      locked a guided missile on them, within the last
 *      AGGRESSION_WINDOW_MS.
 *
 * Exported so the ship-offer gates (display/ship_mission_offer_plugin's
 * "begins to attack the player") quote it rather than keeping a narrower
 * copy, and so does NpcDecisionSystem: a ship protecting the player (see
 * flockPlayer below) treats exactly these ships as hostiles. Everything read is synced state, so the display and every peer's
 * simulation agree. `now` is the SIMULATION clock.
 */
export function isAttackingPlayer(targetUuid: string, targetEntity: Entity,
    playerUuid: string, playerEntity: Entity, now: number): boolean {
    const targetsPlayer = targetEntity.components
        .get(TargetComponent)?.target === playerUuid;
    const npcMode = targetEntity.components.get(NpcComponent)?.mode;
    // Another player's ESCORT engaging us — ordered onto us with 'f'
    // (command 'attack') or holding its leader's perimeter against us
    // (command 'defend') — is attacking us in every sense that matters,
    // even before its first shot lands (which is when (b) would catch it).
    // Escorts fly on the escort command, not on NpcComponent mode 'attack',
    // so the posture reads from EscortCommandComponent; both commands point
    // TargetComponent at the victim. Matthew: "when an escort is attacking
    // another player (due to 'f' or due to defending), it should be IFF
    // hostile from that player's perspective."
    const escortCommand = targetEntity.components
        .get(EscortCommandComponent)?.command;
    const escortEngaging = escortCommand === 'attack'
        || escortCommand === 'defend';
    return (targetsPlayer && (npcMode === 'attack'
        || escortEngaging
        || targetEntity.components.has(ShootAllWeaponsComponent)))
        // (b): what this ship has actually done to us lately — what keeps
        // an attacker red after it breaks its lock or turns to flee, and
        // the only reading that reaches another player's ship (no govt, no
        // NPC brain).
        || isRecentAggressor(playerEntity.components.get(AggressionComponent),
            targetUuid, now);
}

/**
 * The PLAYER whose flock `uuid` flies in: the first ship up its flock chain
 * (flockParent, the same walk as isInFlock) that a player controls, or
 * undefined for a ship in no player's flock.
 *
 * For an NPC this is the player it is PROTECTING. The ships that reach
 * NpcDecisionSystem with an answer here are the ones in a player's flock
 * that still think for themselves, because nothing gave them an escort
 * command:
 *  - mïsn ShipBehav 1 ("Special ships will protect the player") special
 *    ships, and escort-goal (ShipGoal 3) ones, which mission_ship_spawn puts
 *    in formation on the player sharing the player's firing group;
 *  - a captured fleet leader's own fleet escorts, still in formation on it.
 * Hired escorts and bay fighters are in the flock too, but they fly on the
 * escort command framework and never get this far.
 *
 * isInFlock(uuid, flockPlayer(uuid)) holds whenever this is defined, which
 * is what lets the brain and the brackets agree: the HUD paints the ship
 * friendly by exactly the chain this follows.
 */
export function flockPlayer(uuid: string,
    getEntity: (uuid: string) => Entity | undefined): string | undefined {
    const visited = new Set<string>();
    let current = uuid;
    for (let depth = 0; depth < MAX_FLOCK_DEPTH; depth++) {
        if (visited.has(current)) {
            return undefined; // Leader cycle: nobody's flock.
        }
        visited.add(current);
        const entity = getEntity(current);
        if (!entity) {
            return undefined;
        }
        const parent = flockParent(entity);
        if (parent === undefined || parent === current) {
            return undefined;
        }
        if (getEntity(parent)?.components.has(ControlledByComponent)) {
            return parent;
        }
        current = parent;
    }
    return undefined;
}
