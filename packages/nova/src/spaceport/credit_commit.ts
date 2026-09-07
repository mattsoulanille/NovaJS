import { Entity } from 'nova_ecs/entity';
import { CreditsComponent } from '../nova_plugin/player/player_state_plugin.js';

/**
 * ============================================================================
 * THE DOCKED CREDIT SEAM: a working balance commits as a DELTA
 * ============================================================================
 *
 * While the player is landed their ship entity is OUT OF THE WORLD, held by
 * the client until the lift-off encodes it back into an `addEntity` record.
 * The landing's WORKING COPY of the balance (one per landing — the
 * transaction in landed_transaction.ts, which every venue is a view onto)
 * is edited as the player buys and sells, so the dialogs and the status bar
 * can follow along unconfirmed, and written back at a venue's Done and at
 * lift-off. It is not the only writer of the live CreditsComponent, though:
 *
 *  - THE WRITERS OUTSIDE THE VENUES — the spaceport's refuel button, and
 *    the escort-deal settlement that runs as the player leaves
 *    (spaceport/escort_deals.ts). Both pay through the transaction
 *    (applyExternalCredits, which moves the working balance, the live
 *    component and the sync point together); the refuel writes the live
 *    component directly in the frames before a transaction exists.
 *  - ANY OTHER DIRECT WRITE of the live component — a spec that simulates
 *    such a writer, an older code path — while the working copy is open.
 *
 * An ABSOLUTE write-back would ERASE those: buy 500 credits of food, have a
 * 40,000-credit escort sale settle onto the live component while the
 * exchange is open, press Done, and an absolute store of `(balance at open)
 * - 500` loses the sale — though the escort left the roster and is never
 * coming back.
 *
 * ---------------------------------------------------------------------------
 * THE RULE: THE FLUSH COMMITS A DELTA, NOT A BALANCE
 * ---------------------------------------------------------------------------
 *
 * The transaction's flush routes its credit write through
 * {@link commitVenueCredits}, which takes the balance the working copy was
 * last SYNCED to (`baseline`), lets the write store whatever absolute figure
 * it likes, and then rewrites the component as
 *
 *      (what the entity holds RIGHT NOW) + (what was written - baseline)
 *
 * — the visit's own spend/earn re-applied over the concurrent writers'
 * result. When nothing else wrote, `now == baseline` and the arithmetic
 * collapses to exactly the absolute written, so EVERY EXISTING SPEC still
 * means the same thing; this only changes the answer in the case that used
 * to lose money. The transaction then re-syncs its working balance to the
 * composed result, so the next delta is against it.
 *
 * IDEMPOTENT. The call returns the NEW baseline (the absolute written);
 * storing it back means a second commit of an unchanged working copy has a
 * zero delta and is a no-op, so `Menu.dismiss()` firing done() a second time
 * cannot charge the player twice.
 *
 * THE SHIPYARD does not need a working copy: a purchase is priced and
 * charged from the LIVE entity at the instant the Buy button is pressed
 * (shipyard_rules' `purchaseContextFrom` / `buildPurchasedShip`), which at
 * the shipyard is the flushed working copy, and the transaction re-seeds
 * from the new hull (LandedTransaction.adoptPurchasedShip). The swap is
 * published through `DockedShip.swapEntity` as it happens, so the escort
 * deals that settle at Leave, after a purchase, pay the hull that lifts
 * off.
 *
 * THE GATE, not just the arithmetic: the delta rule composes two writers'
 * sums but not their affordability checks. A spend gated on the LIVE
 * balance while a venue's working copy had already spent most of it went
 * through and left the flush negative — a debt settleDailyBudget quietly
 * forgave at the next date advance. So a concurrent spender asks the
 * transaction for the WORKING balance (LandedTransaction.spendable), which
 * is what the player is about to have; the escort-deal settlement leaves
 * an upgrade it cannot cover queued. Sales (credits IN) need no gate.
 */

/** The balance the entity is holding right now; 0 when it has none. */
export function creditBalance(entity: Entity): number {
    return entity.components.get(CreditsComponent)?.credits ?? 0;
}

/**
 * Runs a credit commit as a DELTA against `baseline` — the balance the
 * working copy was last synced to — so concurrent writers survive it. See
 * the module comment for why.
 *
 * `commit` is the ordinary write-back (a `components.set(CreditsComponent,
 * ...)`, or a MissionSession.commit() that does it as part of its own); it
 * may write any number of other components too, which are left exactly as
 * it wrote them.
 *
 * Returns the new baseline: store it, and a repeated commit of an unchanged
 * working copy is a no-op.
 */
export function commitVenueCredits(entity: Entity, baseline: number,
    commit: () => void): number {
    const live = entity.components.get(CreditsComponent)?.credits;
    commit();
    const committed = entity.components.get(CreditsComponent)?.credits;
    if (committed === undefined) {
        // The venue does not track credits on this entity (a test double, or
        // an entity that never had the component). Nothing to rebase.
        return baseline;
    }
    if (live !== undefined) {
        entity.components.set(CreditsComponent,
            { credits: live + (committed - baseline) });
    }
    return committed;
}
