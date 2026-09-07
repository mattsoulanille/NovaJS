import { ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import {
    MissionEvent, MissionWorkingState,
} from '../nova_plugin/missions/mission_logic.js';
import { OutfitsStateComponent } from '../nova_plugin/ship/outfit_plugin.js';
import { CreditsComponent } from '../nova_plugin/player/player_state_plugin.js';
import { commitVenueCredits, creditBalance } from './credit_commit.js';
import {
    EscortDealEntry, EscortDealSettlement, settleEscortDeals,
} from './escort_deals.js';
import {
    collectFleetHolds, commitFleetHolds, FleetEscortEntry, FleetHold,
} from './fleet_cargo.js';
import {
    advanceEntityDate, drainPendingMissionNotices, MissionSession,
    processLandingOn, replaceMap, replaceSet,
} from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import { commitPendingEscorts } from './pending_escorts.js';

/**
 * ============================================================================
 * THE LANDED TRANSACTION: one working copy per landing, committed at lift-off
 * ============================================================================
 *
 * While the player is landed their ship entity is OUT OF THE WORLD, held by
 * the client until the lift-off encodes it into an `addEntity` record
 * (client/docking.ts). Everything the spaceport does is an edit to that one
 * held entity — and it used to be done through FIVE separate working copies.
 * The outfitter, the bar, the mission BBS, the trade center and the landing
 * popups each built a MissionSession (or a TradeWorkingState) of their own
 * when they opened, edited it, and wrote it back at Done; the shipyard read
 * and charged the live entity; the client's frame loop and the refuel
 * button wrote the live entity behind all of them. Every review-round money
 * bug of the last year lived on a seam between two of those copies: a
 * sale erased by an absolute write-back, an upgrade gated on the wrong
 * balance, goods committed onto an escort a sale had already spliced off
 * the roster, a hire counted twice, a hull swap that left a copy pointed at
 * the ship just traded away.
 *
 * This module replaces them with ONE transaction per landing:
 *
 *   LandedTransaction.open(entity, ...)     built when the player docks
 *      .session       the landing's single MissionSession — its `state`
 *                     (missions, cargo, credits, bits, ranks, records) and
 *                     `outfits` ARE the working copy; every venue reads and
 *                     writes these same objects
 *      .hired         the pilots hired at the bar this landing
 *      .holds         the escort holds the trade center has checked out
 *      .ship          the hull, swappable (a shipyard purchase, an Hxxx)
 *      .savepoint()   what a venue opens as it starts and releases at Done
 *      .commit()      the lift-off: the working copy lands on the hull, the
 *                     hires on PendingEscortsComponent, the holds on the
 *                     roster entities — once
 *
 * A venue is a VIEW: the outfitter's `credits` is `transaction.credits`,
 * the trade center's `state` is `transaction.state`, the bar's session is
 * `transaction.session`. Walk out of the trade center with a full hold and
 * into the BBS, and the mission's cargo check reads the very Map the
 * exchange filled; hire at the bar and gamble, and both come off the one
 * balance; buy an outfit and trade the hull in, and the shipyard values the
 * outfit you just bought. There is no second copy for the seams to open
 * between.
 *
 * ---------------------------------------------------------------------------
 * WHEN THE ENTITY IS WRITTEN: savepoints and the flush
 * ---------------------------------------------------------------------------
 *
 * The entity is NOT written as the player shops. A venue opens a SAVEPOINT
 * as it starts (`savepoint()`), and its Done RELEASES it. Releasing the
 * outermost savepoint FLUSHES the working copy onto the entity; releasing
 * a nested one only pops it (its edits become the enclosing savepoint's).
 * ROLLING BACK a savepoint restores the working copy to what it was when
 * that savepoint was opened — every edit made since, by that venue or by
 * anything nested inside it, is undone, IN PLACE, so every view keeps its
 * objects — and pops it and everything above it. Nothing reaches the
 * entity on a rollback: the entity holds the last flush, and a savepoint
 * is always opened at or after one.
 *
 * So "Cancel in a venue reverts only that venue's edits" is `rollback(the
 * venue's savepoint)`, and "a venue's Done commits its edits into the
 * landing" is `release(it)`. A throw out of a venue's show() rolls its
 * savepoint back (the trade center's hold lease goes with it — see below).
 * The fleet-hold lease, the hull, the hires and the ledger are all part of
 * what a savepoint captures.
 *
 * The flush is IDEMPOTENT and DELTA-BASED for credits (credit_commit.ts):
 * what lands on the entity is (what it holds now) + (working - the balance
 * it held at the last sync). That is what keeps a writer this transaction
 * does not own — a spec that pokes the live component, the client's
 * settlement before a transaction exists — from being erased. Writers that
 * DO go through the transaction (applyExternalCredits: the client's escort
 * deal settlement, the refuel button) move the working balance, the live
 * component and the sync point together, so the delta stays what the
 * venue spent and the readout, the affordability gates and the balance
 * that lifts off all agree.
 *
 * ---------------------------------------------------------------------------
 * THE FLEET-HOLD LEASE is a property of the visit
 * ---------------------------------------------------------------------------
 *
 * The trade center checks out working copies of the landed escorts' holds
 * (fleet_cargo.ts) and the client settles queued escort deals on every
 * docked frame at a shipyard; a sale settling while a hold is open would
 * splice the escort off the roster under the exchange. `leaseFleetHolds`
 * records the holds on the transaction, `holdOpen(uuid)` is what the
 * settlement asks, and the lease lives exactly as long as the savepoint
 * that opened it: released (holds committed onto the escort entities, then
 * the lease closed) with it, discarded with its rollback. There is no
 * module-level registry to leak.
 *
 * ---------------------------------------------------------------------------
 * WHAT DOES NOT CHANGE
 * ---------------------------------------------------------------------------
 *
 *  - THE MULTIPLAYER BOUNDARY. `commit()` returns the hull; the client
 *    encodes it into the lift-off's insertion record and the hires and
 *    escorts into theirs, exactly as before. Nothing here runs in the
 *    simulation and nothing here reads a clock or a PRNG of its own.
 *  - THE SHIPYARD prices and charges from the live entity at the click, as
 *    it always did: at the shipyard the entity IS the flushed working
 *    copy (every other venue released before it opened), and the purchase
 *    hands back a new hull that `adoptPurchasedShip` re-seeds the working
 *    copy from.
 *  - THE PER-VENUE SPECS. A venue shown without a landing (every headless
 *    spec) opens a transaction of its own and releases it at Done, which is
 *    the one-flush-at-Done those specs pin.
 */

/**
 * A venue's handle on its own edits. Opaque: only `label` is for reading.
 * Its snapshot is the transaction's business.
 */
export interface Savepoint {
    readonly label: string;
}

/** What a savepoint captures — enough to put the working copy back. */
interface Snapshot {
    ship: Entity;
    shipId: string;
    credits: number;
    /** The external credit total at the time (see externalCredits). */
    externalCredits: number;
    cargo: Map<string, number>;
    missions: MissionWorkingState['missions'];
    bits: Set<number>;
    ranks?: Set<string>;
    records?: Map<string, number>;
    autoAbortShips?: NonNullable<MissionWorkingState['autoAbortShips']>;
    dateAdvance: number;
    events: number;
    cargoCapacity: number;
    outfits: Map<string, number>;
    hired: string[];
    /** The leased holds' working cargo at the time, by hold. */
    holds: { hold: FleetHold, cargo: Map<string, number> }[];
}

class SavepointRecord implements Savepoint {
    constructor(readonly label: string, readonly snapshot: Snapshot) { }
}

/** A deep copy of a plain-data value (an ActiveMission, a spawn batch). */
function clone<T>(value: T): T {
    return structuredClone(value);
}

export class LandedTransaction {
    /** The landing's one session; its state and outfits are the working copy. */
    readonly session: MissionSession;
    /** Ship ids of the pilots hired at the bar this landing (pending_escorts.ts). */
    readonly hired: string[] = [];
    /**
     * The mission events the landing itself raised (completions, failures,
     * cargo transfers) — what the spaceport shows as popups. Filled by
     * {@link processLanding}; empty for a transaction opened over a
     * standalone venue.
     */
    landingEvents: MissionEvent[] = [];

    private hull: Entity;
    /** The entity balance at the last sync (credit_commit.ts's baseline). */
    private creditsBaseline: number;
    /**
     * Every credit that moved through applyExternalCredits, summed: what a
     * rollback must NOT undo (see restore).
     */
    private externalCredits = 0;
    /** How many of the session's events the last flush returned. */
    private eventsFlushed = 0;
    private savepoints: SavepointRecord[] = [];
    private leasedHolds: FleetHold[] = [];
    /** The savepoint the lease was opened under; undefined = no lease. */
    private leaseOwner?: SavepointRecord;
    private swapListeners: ((ship: Entity) => void)[] = [];
    private closed = false;

    private constructor(session: MissionSession,
        readonly gameData: SimulationGameDataInterface,
        readonly universe: MissionUniverse,
        readonly planetId: string) {
        this.session = session;
        this.hull = session.target;
        this.creditsBaseline = creditBalance(this.hull);
    }

    /**
     * Opens a transaction over `entity` as it stands: the working copy is
     * seeded from it and nothing is written. The spaceport's landing then
     * runs {@link processLanding}; a standalone venue does not.
     */
    static async open(entity: Entity, gameData: SimulationGameDataInterface,
        universe: MissionUniverse, planetId: string):
        Promise<LandedTransaction> {
        const session = await MissionSession.create(entity, gameData,
            universe, planetId);
        return new LandedTransaction(session, gameData, universe, planetId);
    }

    // ── The working copy ────────────────────────────────────────────────

    /** The hull the player is docked in right now. */
    get ship(): Entity {
        return this.hull;
    }

    /** The one working copy of the mission-related state. */
    get state(): MissionWorkingState {
        return this.session.state;
    }

    /** The one working copy of the outfits aboard: outfit id -> count. */
    get outfits(): Map<string, number> {
        return this.session.outfits;
    }

    /** The one working balance (the same object as `state.credits`). */
    get credits(): { credits: number } {
        return this.session.state.credits;
    }

    /** The escort holds checked out to the open trade visit, if any. */
    get holds(): readonly FleetHold[] {
        return this.leasedHolds;
    }

    /**
     * Whether commit() has run: the hull has been handed over for the
     * lift-off, and nothing writes it through here again (see commit).
     */
    get isClosed(): boolean {
        return this.closed;
    }

    /** How many savepoints are open. */
    get depth(): number {
        return this.savepoints.length;
    }

    // ── The landing ─────────────────────────────────────────────────────

    /**
     * Landing bookkeeping, before the spaceport is shown: the calendar
     * advances one day (crons, salaries, wages — on the ENTITY, as every
     * date advance is), the working copy is re-seeded from the advanced
     * entity, every active mission is checked against this stellar, and
     * the result is flushed. Returns the events for the UI, including any
     * notices queued from mid-flight failures — what processEntityLanding
     * returns, over the landing's own session instead of a throwaway one.
     */
    async processLanding(): Promise<MissionEvent[]> {
        await advanceEntityDate(this.hull, 1, this.universe, this.gameData);
        // The crons just ran on the entity (bits, ranks, outfits, the
        // books): the working copy and the per-hull facts follow.
        this.session.reseed(this.hull);
        this.creditsBaseline = creditBalance(this.hull);
        await this.refresh();
        processLandingOn(this.session);
        const events = this.flush();
        // A completion's reward (a Gxxx, a rank) can change what the
        // landing's own offers gate on, so the facts are derived again
        // for them — what a fresh session over the landed entity read.
        await this.refresh();
        // Drained only once the landing has gone through (see
        // processEntityLanding for the lost-notice seam this order closes).
        this.landingEvents =
            [...drainPendingMissionNotices(this.hull), ...events];
        return this.landingEvents;
    }

    /**
     * Re-derives the per-hull facts the session prices and gates by
     * (cargo capacity, Contribute, the payroll, the hull's govt and AI)
     * from the entity as it stands. Run as each venue opens — the moment
     * a per-venue session used to compute them — so an outfit bought
     * next door, a hull traded in, or a pilot hired counts here.
     */
    async refresh(): Promise<void> {
        await this.session.rederive(this.gameData);
    }

    // ── Savepoints ──────────────────────────────────────────────────────

    /**
     * Opens a savepoint: the working copy as it is right now, to be
     * {@link release}d (the edits since become the landing's) or
     * {@link rollback}ed (they are undone). Nest freely; the module comment
     * has the rules.
     */
    savepoint(label = 'venue'): Savepoint {
        const record = new SavepointRecord(label, this.snapshot());
        this.savepoints.push(record);
        return record;
    }

    /**
     * Keeps every edit made since `savepoint` (and since anything nested
     * inside it), pops them, and — if that was the outermost — FLUSHES the
     * working copy onto the entity. A lease opened under one of the popped
     * savepoints commits its holds onto the escorts and closes. A savepoint
     * that is no longer open (released or rolled back already) is a no-op,
     * so a Done that fires twice cannot flush an enclosing visit's
     * half-made edits. AFTER commit() every release is a no-op too, and a
     * loud one (see commit): the hull has lifted off, so there is nothing
     * left for the edits to land on.
     */
    release(savepoint: Savepoint): void {
        const popped = this.pop(savepoint);
        if (popped === undefined) {
            if (this.closed) {
                this.warnAbandoned(`release of "${savepoint.label}"`);
            }
            return;
        }
        if (this.leaseOwner !== undefined && popped.includes(this.leaseOwner)) {
            commitFleetHolds(this.leasedHolds);
            this.endLease();
        }
        if (this.savepoints.length === 0) {
            this.flush();
        }
    }

    /**
     * Undoes every edit made since `savepoint`, in place, and pops it and
     * everything above it. The entity is untouched (it holds the last
     * flush). A hull adopted since is put back to the one the savepoint
     * saw, and the swap listeners are told; a lease opened since is
     * discarded; holds leased BEFORE the savepoint get their cargo back.
     */
    rollback(savepoint: Savepoint): void {
        const popped = this.pop(savepoint);
        if (popped === undefined) {
            return;
        }
        this.restore(popped[0].snapshot);
        if (this.leaseOwner !== undefined && popped.includes(this.leaseOwner)) {
            this.endLease();
        }
    }

    /** Pops `savepoint` and everything above it; undefined if not open. */
    private pop(savepoint: Savepoint): SavepointRecord[] | undefined {
        const index = this.savepoints.indexOf(savepoint as SavepointRecord);
        if (index < 0) {
            return undefined;
        }
        return this.savepoints.splice(index);
    }

    private snapshot(): Snapshot {
        const state = this.session.state;
        return {
            ship: this.hull,
            shipId: this.session.shipId,
            credits: state.credits.credits,
            externalCredits: this.externalCredits,
            cargo: new Map(state.cargo),
            missions: new Map([...state.missions].map(
                ([id, active]) => [id, clone(active)])),
            bits: new Set(state.bits),
            ranks: state.ranks ? new Set(state.ranks) : undefined,
            records: state.records ? new Map(state.records) : undefined,
            autoAbortShips: state.autoAbortShips
                ? clone(state.autoAbortShips) : undefined,
            dateAdvance: state.dateAdvance,
            events: state.events.length,
            cargoCapacity: state.cargoCapacity,
            outfits: new Map(this.session.outfits),
            hired: [...this.hired],
            holds: this.leasedHolds.map(hold =>
                ({ hold, cargo: new Map(hold.cargo) })),
        };
    }

    private restore(snapshot: Snapshot): void {
        const state = this.session.state;
        // Money that moved through applyExternalCredits since the
        // savepoint (a settled escort sale, a refuel) is not the venue's
        // to undo: it is re-applied over the restored balance.
        const external = this.externalCredits - snapshot.externalCredits;
        state.credits.credits = snapshot.credits + external;
        replaceMap(state.cargo, snapshot.cargo);
        replaceMap(state.missions, [...snapshot.missions].map(
            ([id, active]) => [id, clone(active)] as const));
        replaceSet(state.bits, snapshot.bits);
        if (state.ranks && snapshot.ranks) {
            replaceSet(state.ranks, snapshot.ranks);
        }
        if (state.records && snapshot.records) {
            replaceMap(state.records, snapshot.records);
        }
        if (state.autoAbortShips && snapshot.autoAbortShips) {
            state.autoAbortShips.length = 0;
            state.autoAbortShips.push(...clone(snapshot.autoAbortShips));
        }
        state.dateAdvance = snapshot.dateAdvance;
        state.events.length = snapshot.events;
        state.cargoCapacity = snapshot.cargoCapacity;
        replaceMap(this.session.outfits, snapshot.outfits);
        this.hired.length = 0;
        this.hired.push(...snapshot.hired);
        for (const { hold, cargo } of snapshot.holds) {
            replaceMap(hold.cargo, cargo);
        }
        if (this.hull !== snapshot.ship) {
            // The hull adopted since is abandoned; the one the savepoint
            // saw was never written to by the transaction (buildPurchasedShip
            // leaves it be), so the external movements that landed on the
            // abandoned hull are carried back onto it, and the sync point
            // moves back to its balance.
            this.hull = snapshot.ship;
            this.session.retarget(snapshot.ship, snapshot.shipId);
            const live = snapshot.ship.components.get(CreditsComponent);
            if (live) {
                live.credits += external;
            }
            this.creditsBaseline = creditBalance(snapshot.ship);
            this.announceSwap(snapshot.ship);
        }
    }

    // ── The flush ───────────────────────────────────────────────────────

    /**
     * Writes the working copy onto the hull — the session's commit, with
     * the credits rebased as a delta over whatever the component holds now
     * (credit_commit.ts) — moves this landing's hires onto
     * PendingEscortsComponent, and re-syncs the working balance to the
     * composed result so the next delta is against it. Idempotent.
     *
     * Returns the mission events raised since the previous flush. Callers
     * inside a venue do not call this: release() does, at the outermost
     * savepoint. It is public for the transaction-level writers (the
     * spaceport's teardown, the mission-info abort) and the specs. A no-op
     * (with a warning) once commit() has run: see there.
     */
    flush(): MissionEvent[] {
        if (this.closed) {
            this.warnAbandoned('flush');
            return [];
        }
        const entity = this.hull;
        let events: MissionEvent[] = [];
        this.creditsBaseline = commitVenueCredits(entity, this.creditsBaseline,
            () => { events = this.session.commit(); });
        const live = entity.components.get(CreditsComponent)?.credits;
        if (live !== undefined) {
            this.session.state.credits.credits = live;
            this.creditsBaseline = live;
        }
        commitPendingEscorts(entity, this.hired);
        const fresh = events.slice(this.eventsFlushed);
        this.eventsFlushed = events.length;
        return fresh;
    }

    /**
     * THE LIFT-OFF: every open savepoint is released, the working copy is
     * flushed, and the hull that carries it all is returned for the
     * client to encode. Then the transaction is CLOSED: the client encodes
     * that hull into the lift-off's insertion record on its next frame,
     * after which the entity object here is nobody's — the ship flying is
     * a decoded copy. A release or flush that arrives later (a venue's
     * Done from a listener that outlived the visit, a popup sequence
     * still running blind under the Leave, the world teardown's dismiss)
     * therefore lands nowhere: it is dropped, with a warning naming it,
     * rather than written onto the abandoned hull where it would land or
     * be lost depending on whether the frame had run yet. (The old
     * per-venue commit-in-finally raced exactly that way.) The
     * exit-to-title teardown is not a commit — Spaceport.dismiss flushes
     * and leaves the transaction open, since the ship stays docked.
     */
    commit(): Entity {
        if (this.closed) {
            this.warnAbandoned('commit');
            return this.hull;
        }
        while (this.savepoints.length > 0) {
            this.release(this.savepoints[0]);
        }
        this.flush();
        this.endLease();
        this.closed = true;
        return this.hull;
    }

    private warnAbandoned(what: string): void {
        console.warn(`LandedTransaction: ${what} after the lift-off commit `
            + 'dropped; the hull left the pad with what commit() flushed.');
    }

    // ── Credits shared with writers outside the venues ──────────────────

    /**
     * The balance a CONCURRENT SPENDER may check affordability against:
     * the working balance, which is what the player is about to have.
     * (credit_commit.ts's spendableBalance, for a transaction.)
     */
    spendable(): number {
        return this.session.state.credits.credits;
    }

    /**
     * A credit movement by a writer that is not a venue — the client's
     * escort-deal settlement, the spaceport's refuel button. Working
     * balance, live component and sync point all move by `delta`, so the
     * open venue's own delta is untouched, its readout follows, and the
     * affordability gates see the money at once.
     */
    applyExternalCredits(delta: number): void {
        if (delta === 0) {
            return;
        }
        this.session.state.credits.credits += delta;
        this.creditsBaseline += delta;
        this.externalCredits += delta;
        const live = this.hull.components.get(CreditsComponent);
        if (live) {
            live.credits += delta;
        }
    }

    // ── The fleet's holds ───────────────────────────────────────────────

    /**
     * Checks out the cargo-carrying escorts' holds for the open savepoint
     * (fleet_cargo's collectFleetHolds), freezing those escorts' queued
     * deals ({@link holdOpen}) until it is released or rolled back. Must
     * be called under a savepoint: the lease's lifetime is that
     * savepoint's. Leasing again under the same visit replaces the lease
     * and says so — a venue that opens twice without a Done in between
     * means its close path was skipped.
     */
    async leaseFleetHolds(escorts: readonly FleetEscortEntry[],
        playerUuid: string | undefined): Promise<FleetHold[]> {
        const owner = this.savepoints[this.savepoints.length - 1];
        if (owner === undefined) {
            throw new Error('leaseFleetHolds needs an open savepoint: the '
                + 'lease lives as long as the visit that opened it.');
        }
        const holds = await collectFleetHolds(escorts, playerUuid,
            this.gameData);
        if (this.leaseOwner !== undefined) {
            console.warn('leaseFleetHolds: replacing a lease the visit '
                + `"${this.leaseOwner.label}" never released.`);
        }
        this.leasedHolds = holds;
        this.leaseOwner = owner;
        return holds;
    }

    /**
     * Whether the open trade visit is editing this escort's hold, in which
     * case its queued deals must not settle yet (escort_deals.ts).
     */
    holdOpen(uuid: string): boolean {
        return this.leasedHolds.some(hold => hold.uuid === uuid);
    }

    private endLease(): void {
        this.leasedHolds = [];
        this.leaseOwner = undefined;
    }

    // ── The hull ────────────────────────────────────────────────────────

    /**
     * A SHIPYARD PURCHASE: `entity` is the new hull buildPurchasedShip
     * priced and charged from the live (flushed) entity, so the working
     * copy is re-seeded from it and the sync point moves to its balance.
     * The old hull is left as it was, so a rollback of the shipyard's
     * savepoint can hand it back.
     */
    adoptPurchasedShip(entity: Entity): void {
        this.hull = entity;
        this.session.reseed(entity);
        this.creditsBaseline = creditBalance(entity);
        this.announceSwap(entity);
    }

    /**
     * A MID-VISIT SHIP CHANGE by a set string (`Cxxx` / `Exxx` / `Hxxx`,
     * shipyard_rules' buildChangedShip): the working credits, bits, cargo
     * and missions are AHEAD of the entity — the permit whose OnPurchase is
     * running has just been paid for — so only the target and the outfits
     * move. The new hull carries the old hull's live balance, so the sync
     * point stays where it was and the visit's spend lands as a delta on
     * the hull that lifts off.
     */
    adoptChangedShip(entity: Entity, shipId: string): void {
        this.hull = entity;
        this.session.retarget(entity, shipId);
        // The rest of the running set string, and the grid after it, read
        // the working outfits: make them the new hull's (in place).
        replaceMap(this.session.outfits,
            [...entity.components.get(OutfitsStateComponent) ?? []]
                .map(([id, { count }]) => [id, count] as const));
        this.announceSwap(entity);
    }

    /** Told of every hull swap (adopt*, and a rollback that reverts one). */
    onShipSwap(listener: (ship: Entity) => void): void {
        this.swapListeners.push(listener);
    }

    private announceSwap(ship: Entity): void {
        for (const listener of this.swapListeners) {
            listener(ship);
        }
    }
}

/**
 * The client's docked-frame escort-deal settlement, THROUGH the visit:
 * gated on the working balance, frozen for any escort whose hold the
 * trade center has checked out, and paid into the one ledger. What
 * client/docking.ts runs on every docked frame at a shipyard while a
 * transaction is open; escort_deals.ts has the deal rules.
 */
export function settleVisitEscortDeals(transaction: LandedTransaction,
    roster: EscortDealEntry[], player: string,
    getShip: (id: string) => ShipData | undefined): EscortDealSettlement {
    const settled = settleEscortDeals(roster, player, transaction.spendable(),
        getShip, uuid => transaction.holdOpen(uuid));
    transaction.applyExternalCredits(settled.credits);
    return settled;
}
