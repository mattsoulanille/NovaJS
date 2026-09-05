import { Entity } from 'nova_ecs/entity';
import { clearCarriedAggressionForTransition } from './aggression.js';
import { clearPlunderRecord } from './boarding_component.js';
import { NpcComponent } from './npc_ai_plugin.js';
import { PlanetTargetComponent } from './planet_plugin.js';
import { TargetComponent } from './target_component.js';

/**
 * ============================================================================
 * Preparing carried entities for a FRESH WORLD
 * ============================================================================
 *
 * The player and its escorts leave a system as serialized entities and are
 * re-inserted, by the client, into a world that was built from scratch.
 * Every uuid they carry that names something OTHER than themselves was
 * minted in the world they left, and means nothing in the one they are
 * entering — or worse, means something ELSE. Until issue #32 the sim's
 * IdFactory restarted at 0 in every world, so the `npc:7` a player was
 * targeting at departure was, on arrival, whatever the seventh spawn of the
 * destination happened to be: the player dropped out of hyperspace with a
 * reticle already on a random ship. make_system.ts now prefixes every sim-
 * minted id with its system id so aliasing is impossible, and THIS gate
 * clears the references anyway, because a reticle on a ship that no longer
 * exists is still wrong.
 *
 * WHAT THE ORIGINAL DOES. Targeting does not survive a jump: the target
 * display is blank on arrival, exactly as it is on lift-off after a landing
 * (browser.ts's clearTargetsOnLanding is the landing half of the same rule).
 * The stellar selection goes with it — it named a planet of the system left.
 *
 * ON THE ESCORTS: an escort's `TargetComponent.target` and its NPC brain's
 * `aggressor` / `boardTarget` / `pacifiedFrom` are cleared when they name
 * something OUTSIDE the batch that is crossing with it. A reference INTO the
 * batch (a fighter targeting its own carrier's target is unusual, but a
 * carrier and its wing do cross together) is left for prepareCarriedEscorts
 * to remap onto the batch's fresh uuids, as it always has. The plunder
 * record is cleared with the same call the jump sweep uses
 * (clearPlunderRecord): a jump is a life-segment boundary by Matthew's
 * ruling, and a `boarder` naming the pre-save player would otherwise ride a
 * restored prize forever.
 *
 * Runs at the ONE point where the batch is final (browser.ts's enterSystem,
 * where a restored save's escorts have just been pushed onto it), together
 * with the aggression clear that already lived there. A LANDING is not a
 * fresh world and does not come through here.
 */

/** The uuid-bearing NPC-brain fields that name another ship. */
const NPC_REFERENCE_FIELDS = ['aggressor', 'boardTarget', 'pacifiedFrom'] as const;

/**
 * Drops every reference on `entity` that names an entity outside `live`
 * — the set of uuids that will exist in the destination world alongside
 * it (the player and the rest of its batch, by their PRE-remap uuids).
 */
export function clearStaleReferences(entity: Entity,
    live: ReadonlySet<string>): void {
    const target = entity.components.get(TargetComponent);
    if (target?.target !== undefined && !live.has(target.target)) {
        entity.components.set(TargetComponent, { target: undefined });
    }
    const npc = entity.components.get(NpcComponent);
    if (npc) {
        let changed = false;
        const next = { ...npc };
        for (const field of NPC_REFERENCE_FIELDS) {
            const named = npc[field];
            if (named !== undefined && !live.has(named)) {
                delete next[field];
                changed = true;
            }
        }
        if (changed) {
            entity.components.set(NpcComponent, next);
        }
    }
    clearPlunderRecord(entity);
}

/**
 * The player's own targeting: both reticles go, unconditionally. Nothing
 * a player could be targeting crosses a system boundary with it — its
 * escorts do, but the reticle on one of them is not worth keeping when the
 * original blanks the display on every arrival.
 */
export function clearPlayerTargetsForTransition(player: Entity): void {
    if (player.components.has(TargetComponent)) {
        player.components.set(TargetComponent, { target: undefined });
    }
    if (player.components.has(PlanetTargetComponent)) {
        player.components.set(PlanetTargetComponent, { target: undefined });
    }
}

/**
 * THE GATE for everything crossing into a fresh world: the aggression
 * tables (aggression.ts), the player's reticles, and every escort's
 * out-of-batch references.
 */
export function prepareCarriedEntitiesForFreshWorld(player: Entity,
    playerUuid: string,
    escorts: Iterable<{ uuid: string, entity: Entity }>): void {
    const batch = [...escorts];
    clearCarriedAggressionForTransition(player, batch);
    clearPlayerTargetsForTransition(player);
    const live = new Set<string>([playerUuid, ...batch.map(e => e.uuid)]);
    for (const escort of batch) {
        clearStaleReferences(escort.entity, live);
    }
}
