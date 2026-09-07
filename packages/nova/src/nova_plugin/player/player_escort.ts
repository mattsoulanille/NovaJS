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
    /**
     * A QUEUED UPGRADE: the global ship id this escort will be swapped to
     * the next time its player lands on a stellar with a shipyard
     * (spaceport/escort_deals.ts). Absent means nothing is queued.
     *
     * The TARGET IS RESOLVED AT QUEUE TIME — it is the class's own shïp
     * UpgradeTo as of the press, stored rather than re-derived — so the
     * settlement can tell a deal that is still the deal it was struck for
     * from one whose escort has changed class some other way since. A
     * stored target that no longer matches the escort's current
     * UpgradeTo is dropped rather than honoured (see settleEscortDeals).
     *
     * NOT a price: EscUpgrdCost is re-read from the escort's class when
     * the deal settles, exactly as every other escort figure is
     * (escort_fees.ts).
     *
     * ONE HALF OF THE ENCODING OF {@link EscortDeal}: this and
     * `pendingSale` are the wire form of a single queued-deal state, and
     * are mutually exclusive — read them through `escortDeal`, write them
     * through `withEscortDeal`.
     */
    pendingUpgrade: t.string,
    /**
     * A QUEUED SALE: this escort will be sold off (and will NOT lift off
     * with the player) the next time its player lands on a stellar with a
     * shipyard. CAPTURED escorts only — a hired pilot's hull was never the
     * player's to sell — and the settlement re-checks that rather than
     * trusting the flag.
     *
     * The other half of the {@link EscortDeal} encoding; see above.
     */
    pendingSale: t.boolean,
})]);
export type PlayerEscort = t.TypeOf<typeof PlayerEscort>;

/**
 * ============================================================================
 * The escort's LIFECYCLE, explicitly
 * ============================================================================
 *
 * The marker above is a bag of optional flags because it is a WIRE shape:
 * PlayerEscortComponent is serializer-registered, so its codec is what
 * crosses the wire, is hashed for desync detection, and is written into
 * the pilot save inside each escort's entity blob (save_game.ts). Changing
 * that encoding is a PROTOCOL_VERSION bump and a save migration of every
 * escort blob at once, and the wire side must stay additive — so the
 * encoding stays as it is, and the lifecycle is made explicit ABOVE it:
 *
 *   provenance   how the escort became the player's (escortProvenance;
 *                absent on the wire = 'hired', the reading that cannot be
 *                turned into cash);
 *   deal         what the player has decided to do with it at the next
 *                shipyard (escortDeal): nothing, an upgrade to a resolved
 *                class, or a sale — ONE of the three, never two.
 *
 * `pendingUpgrade` / `pendingSale` are the encoding of `deal`:
 *
 *   { kind: 'none' }             neither field present
 *   { kind: 'upgrade', toShip }  pendingUpgrade: toShip
 *   { kind: 'sale' }             pendingSale: true
 *
 * escortDeal decodes (a marker with BOTH flags — which no writer produces;
 * every writer goes through withEscortDeal — reads as the sale, because
 * that is what the settlement does with it: sales settle first and clear
 * both flags, so the upgrade would never have happened), escortDealFields
 * encodes, and the encoding is exactly the bytes the previous build
 * wrote, so the desync hash, the wire and every existing save are
 * untouched. The in-memory marker keeps the flag fields because they ARE
 * the codec's fields; every reader (escort_action.ts, the settlement in
 * spaceport/escort_deals.ts, the hail dialog's view) goes through
 * escortDeal, and turning the marker itself into the explicit shape is
 * the follow-up that needs the protocol bump.
 */
export type EscortDeal =
    | { readonly kind: 'none' }
    | { readonly kind: 'upgrade', readonly toShip: string }
    | { readonly kind: 'sale' };

export const NO_DEAL: EscortDeal = { kind: 'none' };

/** The queued deal a marker encodes (see EscortDeal for the reading). */
export function escortDeal(marker: PlayerEscort | undefined): EscortDeal {
    if (!marker) {
        return NO_DEAL;
    }
    if (marker.pendingSale) {
        return { kind: 'sale' };
    }
    if (marker.pendingUpgrade !== undefined) {
        return { kind: 'upgrade', toShip: marker.pendingUpgrade };
    }
    return NO_DEAL;
}

/**
 * The flag pair that encodes `deal` — and NOTHING for 'none': an absent
 * field is part of the encoding (an undefined-valued key would hash
 * differently on a peer that never queued anything).
 */
export function escortDealFields(deal: EscortDeal):
    Pick<PlayerEscort, 'pendingUpgrade' | 'pendingSale'> {
    switch (deal.kind) {
        case 'none':
            return {};
        case 'upgrade':
            return { pendingUpgrade: deal.toShip };
        case 'sale':
            return { pendingSale: true };
    }
}

/**
 * `marker` with its queued deal replaced by `deal` — the ONE way a deal
 * is written. Every other field is kept; the previous deal's fields are
 * removed rather than overwritten, so cancelling restores exactly the
 * encoded shape the marker had before anything was queued.
 */
export function withEscortDeal(marker: PlayerEscort, deal: EscortDeal):
    PlayerEscort {
    const { pendingUpgrade: _upgrade, pendingSale: _sale, ...rest } = marker;
    return { ...rest, ...escortDealFields(deal) };
}

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

/**
 * The class a QUEUED upgrade would swap this escort to, or undefined when
 * none is queued. See EscortDeal — the value is the target resolved when
 * the player pressed the button, not a live re-derivation.
 */
export function pendingEscortUpgrade(escort: Entity): string | undefined {
    const deal = escortDeal(escort.components.get(PlayerEscortComponent));
    return deal.kind === 'upgrade' ? deal.toShip : undefined;
}

/** Whether a sale is queued for this escort. See EscortDeal. */
export function escortSaleQueued(escort: Entity): boolean {
    return escortDeal(escort.components.get(PlayerEscortComponent)).kind
        === 'sale';
}

/**
 * The DURABLE FACTS on an existing ownership marker — the ones that say
 * something the live escort chain cannot, and so must survive every
 * rebuild of that marker:
 *
 *   `provenance`   how the escort was acquired (hired / captured);
 *   the deal       what is queued for the next shipyard (EscortDeal, in
 *                  its `pendingUpgrade` / `pendingSale` encoding).
 *
 * Both are facts about the PLAYER'S RELATIONSHIP with this ship — how
 * they got it, and what they have decided to do with it at the next
 * shipyard — not about which ship it is currently keeping formation on.
 * Every site that rebuilds the marker goes through this or through
 * {@link carriedEscortFields}, so none of them can quietly drop one.
 *
 * `detached` is deliberately NOT here: it is a fact about the live
 * lifecycle (the player is currently out of the world), so it belongs only
 * to the re-stamps that are not themselves a re-attachment.
 *
 * Returns a partial that is spread over the new link, so an absent field
 * stays absent rather than being written as undefined (which would change
 * the component's encoded shape, and with it the desync hash).
 */
export function durableEscortFields(existing: PlayerEscort | undefined):
    Partial<PlayerEscort> {
    return {
        ...(existing?.provenance !== undefined
            ? { provenance: existing.provenance } : {}),
        ...escortDealFields(escortDeal(existing)),
    };
}

/**
 * {@link durableEscortFields} plus `detached` — everything an IN-PLACE
 * re-stamp of the marker must carry over.
 *
 * Used where the marker is rebuilt from a freshly walked chain while the
 * escort stays exactly where it is: MarkPlayerEscortsSystem, and the
 * pre-departure back-fill in sweepableEscorts. Such a re-stamp says
 * nothing about whether the player is present, so a `detached` flag set by
 * the player's departure has to ride through it — otherwise the escort's
 * command reset on the next re-attachment would be skipped.
 *
 * The re-insertion of a CARRIED escort (spaceport/landed_escorts) uses
 * {@link durableEscortFields} instead, because that re-stamp IS the
 * re-attachment: the flag has just served its purpose and must clear.
 */
export function carriedEscortFields(existing: PlayerEscort | undefined):
    Partial<PlayerEscort> {
    const carried = durableEscortFields(existing);
    if (existing?.detached) {
        carried.detached = true;
    }
    return carried;
}

/**
 * The player's PAYROLL: the ship-class ids of the escorts drawing a daily
 * wage from them, sorted, kept on the PLAYER's own entity.
 *
 * WHY IT LIVES ON THE PLAYER AND NOT ON THE ESCORTS. The daily wage is
 * debited by `advanceEntityDate` (spaceport/mission_session.ts), which runs
 * on the player's entity while that entity is OUT of the simulation — docked
 * at a spaceport, or mid-jump between two systems. The escorts are not
 * reachable from there: they have been serialized out to the owning client's
 * carried roster (spaceport/landed_escorts.ts) or, at a landing, are still
 * flying down to the rock. So the roster is mirrored onto the player while
 * they ARE in the world together (EscortPayrollSystem), and the mirror rides
 * the player's entity out of the world with everything else.
 *
 * A CACHE, recomputed from the live flock every step: an escort that dies,
 * is released, or is upgraded to another hull needs no bookkeeping of its own
 * — the next step's sweep simply reports a different list. That also means a
 * stale value (a save restored before the player has been stepped once) fixes
 * itself as soon as the player is in a world with their escorts.
 *
 * BAY FIGHTERS ARE NOT ON IT. A fighter launched from the player's own bays
 * is a player escort in every other sense, but it is the player's OWN outfit
 * flying — there is no pilot to pay — and charging for it would make the
 * expense flicker every time a wing launched or docked. See
 * `escortsOnPayroll` in player_escort_plugin.ts, which is the one place that
 * rule lives.
 *
 * The fee itself is spaceport/escort_fees.ts's `escortDailyFee`, taken on
 * each escort's CURRENT ship class — which is why this stores ship ids and
 * not a precomputed total.
 */
export const EscortPayrollComponent =
    new Component<string[]>('EscortPayroll');

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
