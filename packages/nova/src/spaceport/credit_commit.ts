import { Entity } from 'nova_ecs/entity';
import { CreditsComponent } from '../nova_plugin/player/player_state_plugin.js';

/**
 * ============================================================================
 * THE DOCKED-VENUE COMMIT SEAM: who may write the player's credits, and how
 * ============================================================================
 *
 * While the player is landed their ship entity is OUT OF THE WORLD, held by
 * browser.ts (`dockedShip.entity`) until the lift-off encodes it back into an
 * `addEntity` record. Everything that happens in the spaceport is a mutation
 * of that one held entity, and its CreditsComponent has MORE THAN ONE WRITER:
 *
 *  - EVERY VENUE (trade center, outfitter, bar, mission computer) seeds a
 *    WORKING COPY of the balance when it opens, edits that copy as the player
 *    buys and sells so the dialog and the status bar can follow along
 *    unconfirmed, and writes it back when the player presses Done.
 *  - THE SPACEPORT'S OWN REFUEL BUTTON decrements the live component in place
 *    (spaceport.ts's `refuel`), with no working copy at all.
 *  - browser.ts's `settleDockedEscortDeals` applies the net proceeds of the
 *    escort deals the player queued over the comm channel to the live
 *    component ON EVERY DOCKED FRAME at a shipyard — escorts keep flying down
 *    and joining the landed roster while the player shops, and one that
 *    touches down mid-visit has its deal settled right then
 *    (spaceport/escort_deals.ts).
 *
 * The last two write the LIVE component while a venue is holding a copy of a
 * balance it read at show(). An ABSOLUTE write-back at done() therefore
 * ERASES them: buy 500 credits of food, have a 40,000-credit escort sale
 * settle while the exchange is open, press Done, and the exchange stores
 * `(balance at show) - 500` — the sale is gone, though the escort left the
 * roster and is never coming back.
 *
 * ---------------------------------------------------------------------------
 * THE RULE: A VENUE COMMITS A DELTA, NOT A BALANCE
 * ---------------------------------------------------------------------------
 *
 * Every venue routes its commit through {@link commitVenueCredits}, which
 * takes the balance the working copy was SEEDED from (`baseline`), lets the
 * venue write whatever absolute figure it likes, and then rewrites the
 * component as
 *
 *      (what the entity holds RIGHT NOW) + (what the venue wrote - baseline)
 *
 * — the venue's own spend/earn re-applied over the concurrent writers'
 * result. When nothing else wrote, `now == baseline` and the arithmetic
 * collapses to exactly the absolute the venue wrote, so EVERY EXISTING SPEC
 * still means the same thing; this only changes the answer in the case that
 * used to lose money.
 *
 * Chosen over the alternative (routing escort-deal settlement through
 * whichever venue happens to be open) because the settlement runs in the
 * frame loop, which has no handle on the open dialog, and because the refuel
 * button would still be outside any such channel. The delta rule needs no
 * channel at all: it composes with any number of unrelated writers.
 *
 * IDEMPOTENT. The call returns the NEW baseline (the absolute the venue
 * wrote); storing it back means a second commit of an unchanged working copy
 * has a zero delta and is a no-op, so `Menu.dismiss()` firing done() a second
 * time cannot charge the player twice.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY *NOT* CLOSED HERE
 * ---------------------------------------------------------------------------
 *
 *  - THE READOUT WHILE THE DIALOG IS UP. A venue's `dockedStatus()` reports
 *    its WORKING balance, which is the point (it follows each buy before
 *    Done), so a settlement that lands mid-visit is not seen until Done
 *    applies it. Cosmetic, and the alternative — a Credits figure that moves
 *    on its own while the player is mid-purchase — reads worse.
 *  - THE SHIPYARD does not use this, and does not need to: a purchase is
 *    priced and charged from the LIVE entity at the instant the Buy button is
 *    pressed (shipyard_rules' `purchaseContextFrom` / `buildPurchasedShip`),
 *    so there is no stale snapshot to erase.
 *  - THE SHIPYARD'S ENTITY SWAP was an open seam of the same family and is
 *    now CLOSED. `buildPurchasedShip` still returns a NEW entity, but the
 *    spaceport no longer waits for LeaveSpaceportEvent to hand it over: it
 *    adopts the hull at the instant the Buy button is pressed and publishes
 *    the swap through `DockedShip.swapEntity`, which moves the client's own
 *    `dockedShip.entity` with it (Spaceport.adoptPurchasedShip ->
 *    OpenSpaceportEvent's `onShipSwap` -> browser.ts). An escort deal that
 *    settles after a ship purchase therefore pays the hull that lifts off,
 *    and a venue opened afterwards seeds its baseline from that same hull,
 *    so the delta rule above composes across a trade exactly as it does
 *    across a refuel.
 */

/** The balance the entity is holding right now; 0 when it has none. */
export function creditBalance(entity: Entity): number {
    return entity.components.get(CreditsComponent)?.credits ?? 0;
}

/**
 * The balance a CONCURRENT SPENDER may check affordability against while
 * the player is docked: the open venue's WORKING balance when a venue is
 * open (its dockedStatus().credits, routed through DockedShip.liveStatus),
 * else the live component.
 *
 * The delta rule above composes two writers' ARITHMETIC but not their
 * GATES. The escort-deal settlement (browser.ts's settleDockedEscortDeals)
 * asks "can the player afford this upgrade?" and then debits the live
 * component; with the outfitter holding a working copy that has already
 * spent 90,000 of a 100,000 balance, a 50,000 upgrade read the live
 * 100,000, went through, and Done then rebased the venue's spend over it
 * to -40,000 — a debt settleDailyBudget quietly forgave at the next date
 * advance. The venue's working balance is exactly what the player is
 * about to have, so it is what a spend must be gated on: the deal is left
 * queued (escort_deals.ts retries it every docked frame) until Done
 * releases a balance that covers it. Sales (credits IN) need no gate and
 * keep landing on the live component.
 */
export function spendableBalance(entity: Entity,
    liveStatus?: () => { credits?: number }): number {
    return liveStatus?.().credits ?? creditBalance(entity);
}

/**
 * Runs a venue's credit commit as a DELTA against `baseline` — the balance
 * its working copy was seeded from — so concurrent writers survive it.
 * See the module comment for why.
 *
 * `commit` is the venue's ordinary write-back (its own
 * `components.set(CreditsComponent, ...)`, or a MissionSession.commit() that
 * does it on the venue's behalf); it may write any number of other
 * components too, which are left exactly as it wrote them.
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
