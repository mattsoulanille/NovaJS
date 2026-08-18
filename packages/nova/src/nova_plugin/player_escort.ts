import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';

/**
 * ============================================================================
 * Durable player-escort ownership
 * ============================================================================
 *
 * A ship's membership in the player's flock is normally read off the
 * live parent chain (FormationComponent.leader -> OwnerComponent.owner
 * -> FiringGroupComponent.group; see flock.ts). That chain is fine while
 * the player is IN the system, but it evaporates the moment the player's
 * ship entity leaves it: landing removes the player entity from the
 * simulation, jumping deletes it, and FormationSystem then drops each
 * follower's FormationComponent because the leader is gone.
 *
 * PlayerEscortComponent is the durable marker that survives that
 * absence. It is stamped by MarkPlayerEscortsSystem (player_escort_plugin)
 * whenever a ship's escort chain tops out at a player-controlled ship,
 * and it is NEVER cleared just because the player went missing — that is
 * the whole point: ownership is not lost by the player landing, taking
 * off, or jumping.
 *
 * This module holds only the component declarations so that the systems
 * that must YIELD to a landing escort (FormationSystem, the escort
 * command behavior, the bay return AI) can import them without pulling
 * in the plugin (and without an import cycle).
 */

export const PlayerEscort = t.intersection([t.type({
    /** The player ship this escort ultimately belongs to. Stable across
     * the player landing, departing, and jumping (the player's ship keeps
     * its uuid across all three). */
    player: t.string,
}), t.partial({
    /**
     * The escort's IMMEDIATE leader when it was last seen attached: the
     * player for a direct escort, or a carrier escort for a fighter
     * launched from that escort's bays. Re-attachment prefers this (so a
     * carrier's wing goes back to its carrier rather than being promoted
     * to a direct escort of the player) and falls back to `player` when
     * the recorded parent is gone.
     */
    parent: t.string,
    /**
     * Whether the player's ship has been out of the world since this
     * escort was last attached — set the moment the player lands or jumps
     * away and cleared when the escort is re-attached.
     *
     * This is the lifecycle-boundary signal, and it deliberately does NOT
     * infer detachment from a missing FormationComponent: FormationSystem
     * yields (so never runs its leader-gone rule) for an escort under a
     * non-formation command, so a holdPosition escort keeps a formation
     * link pointing at a player who is not there. Without this flag such
     * an escort would silently skip the command reset on departure.
     */
    detached: t.boolean,
    /**
     * HOW this escort came to be the player's — the one thing the comm
     * dialog's management functions differ on (hail/hail_escort.png vs
     * hail/hail_captured_escort.png):
     *
     *   'hired'    a pilot engaged at the bar (spawnHiredEscorts). Draws a
     *              daily wage (escort_fees.ts's escortDailyFee) and CANNOT
     *              be sold — the player never owned the hull, so there is
     *              nothing to sell; they can only RELEASE the pilot. The
     *              original greys "Sell Escort" for exactly this reason.
     *   'captured' a hull taken by boarding (boarding_plugin's
     *              convertToEscort). Draws no wage — it is property, not an
     *              employee — and CAN be sold for its shïp EscSellValue.
     *
     * Both kinds can be UPGRADED and RELEASED.
     *
     * OPTIONAL, AND MISSING MEANS 'hired'. The field is additive on a
     * component that is already written into saves as part of a serialized
     * escort entity (save_game.ts), so every escort in an existing save
     * arrives without it. 'hired' is the conservative reading of an unknown
     * escort: it is the one that cannot be turned into cash, so a save
     * predating this field can never be mined for credits by selling a
     * fleet the game has no provenance record for. See `escortProvenance`.
     */
    provenance: t.union([t.literal('hired'), t.literal('captured')]),
})]);
export type PlayerEscort = t.TypeOf<typeof PlayerEscort>;

/** How an escort came to be the player's. See PlayerEscort.provenance. */
export type EscortProvenance = 'hired' | 'captured';

/**
 * Durable "belongs to this player" marker. Serializer-registered, so it
 * is hashed for desync detection, rides rollback snapshots, crosses the
 * wire, and — crucially — travels with the entity when a landing or a
 * jump serializes it out of the simulation and back in later.
 */
export const PlayerEscortComponent =
    new Component<PlayerEscort>('PlayerEscort');

/**
 * An escort's provenance, with the documented default for escorts that
 * carry none (pre-existing saves, and any future spawn path that forgets to
 * stamp one): 'hired', the reading that cannot be sold for cash.
 *
 * Reads the durable marker rather than any live link, so the answer survives
 * a landing, a jump, and every command that drops the formation chain — the
 * same durability the rest of PlayerEscortComponent has.
 */
export function escortProvenance(escort: Entity): EscortProvenance {
    return escort.components.get(PlayerEscortComponent)?.provenance ?? 'hired';
}

export const EscortLanding = t.type({
    /** Entity uuid of the stellar the escort is landing on. */
    planet: t.string,
});
export type EscortLanding = t.TypeOf<typeof EscortLanding>;

/**
 * Set on a player-owned escort whose player has just landed: the escort
 * flies to the same stellar and lands too (EscortLandingSystem). While
 * this is present the escort's other brains stand down — formation
 * keeping, escort commands, the NPC steering fallback, and the bay
 * return-home AI all yield — so the approach is not fought over.
 *
 * Cleared if the escort is re-attached before it gets there (the player
 * lifted off first), which is exactly the "escort mid-flight to the
 * planet at liftoff" case: it just goes back into formation.
 */
export const EscortLandingComponent =
    new Component<EscortLanding>('EscortLanding');
