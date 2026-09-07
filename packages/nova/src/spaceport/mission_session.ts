import { Entity } from 'nova_ecs/entity';
import { getDefaultGameDate } from 'novadatainterface/player_start_data';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { addDays, dayNumber } from '../nova_plugin/player/calendar.js';
import { CargoComponent } from '../nova_plugin/ship/cargo_plugin.js';
import { runCronsForDays } from '../nova_plugin/missions/cron_logic.js';
import { playerDiscovery } from '../nova_plugin/player/discovery_store.js';
import { FuelComponent } from '../nova_plugin/ship/health_plugin.js';
import {
    failExpiredMissions,
    MissionContext,
    MissionEvent,
    MissionMachineryContext,
    MissionWorkingState,
    processLanding,
    runMissionSetString,
    runPendingAutoAborts,
    runPendingShipDone,
    stellarInfoOf,
} from '../nova_plugin/missions/mission_logic.js';
import {
    ActiveRanksComponent, AggressionSuppressGovtsComponent,
    commitActiveRanks, ControlBitsComponent,
} from '../nova_plugin/ncb/ncb_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/ship/outfit_plugin.js';
import {
    CreditsComponent,
    CronStatesComponent,
    GameDateComponent,
    MissionsComponent,
    PendingAutoAbortShipsComponent,
    PendingMissionNoticesComponent,
} from '../nova_plugin/player/player_state_plugin.js';
import { CombatRatingComponent, LegalRecordsComponent } from '../nova_plugin/reputation/reputation_plugin.js';
import { ShipComponent, ShipPhysicsComponent } from '../nova_plugin/ship/ship_plugin.js';
import { WeaponsStateComponent } from '../nova_plugin/ship/weapons_state.js';
import { MissionUniverse } from './mission_universe.js';
import { EscortPayrollComponent } from '../nova_plugin/player/player_escort.js';
import { ShipData } from 'novadatainterface/ship_data';
import { settleDailyBudget } from './daily_budget.js';
import { PendingEscortsComponent } from './pending_escorts.js';
import { missionEventLabel, requestCheckpoint } from './checkpoint_requests.js';
import { takeShipDoneTextShown } from './ship_done_shown.js';

/**
 * The per-hull facts a session derives from the entity and the game data
 * when it is created (and again, through {@link MissionSession.rederive},
 * when the hull or its outfits have changed under a long-lived session —
 * the landing transaction keeps ONE session for the whole visit).
 */
interface SessionDerived {
    cargoCapacity: number;
    shipId: string;
    shipGovt: string | null;
    shipInherentAI: number | undefined;
    playerContribute: bigint;
    payrollShips: ReadonlyMap<string, ShipData>;
}

/**
 * A player-local editing session over the mission-related components
 * of the (docked, out-of-simulation) player entity: working copies of
 * missions, cargo, credits, bits, and outfits, plus the machinery
 * context mission_logic.ts operates on. Commit writes the copies back
 * to the entity.
 *
 * While the player is landed there is exactly ONE of these per landing,
 * owned by spaceport/landed_transaction.ts's LandedTransaction; the
 * venues are views onto it. The in-flight callers (ship_mission_accept.ts,
 * processInFlightMissions) build short-lived ones of their own.
 *
 * THE WORKING OBJECTS KEEP THEIR IDENTITY for the session's life: every
 * mutation — a commit's post-date-advance re-read, a {@link reseed} after
 * a hull swap, a transaction savepoint's rollback — is applied IN PLACE
 * (Map.clear + set, Set.clear + add, `credits.credits =`), so a view that
 * captured `state.credits` or `outfits` when it opened keeps reading the
 * truth.
 */
export class MissionSession {
    readonly state: MissionWorkingState;
    readonly outfits: Map<string, number>;
    readonly machinery: MissionMachineryContext;
    currentDay: number;
    shipId: string;
    private shipGovt: string | null;
    private shipInherentAI: number | undefined;
    private playerContribute: bigint;
    private payrollShips: ReadonlyMap<string, ShipData>;
    /**
     * How many of `state.events` have already been announced as
     * checkpoint requests. `events` accumulates across commits (a second
     * commit() returns the same array again), so only the tail beyond
     * this mark is new.
     */
    private eventsAnnounced = 0;

    private constructor(private entity: Entity,
        private universe: MissionUniverse,
        public planetId: string,
        derived: SessionDerived,
        /**
         * Whether commit() announces mission accept/abort/complete/fail
         * events as pilot-history checkpoint requests. Off for a session
         * over a DETACHED copy of the player (ship_mission_accept.ts):
         * such a copy carries only the mission-related components, so a
         * checkpoint snapshotted from it would be missing the rest.
         */
        private readonly announceCheckpoints: boolean) {
        this.currentDay = dayNumber(
            entity.components.get(GameDateComponent) ?? getDefaultGameDate());
        this.shipId = derived.shipId;
        this.shipGovt = derived.shipGovt;
        this.shipInherentAI = derived.shipInherentAI;
        this.playerContribute = derived.playerContribute;
        this.payrollShips = derived.payrollShips;

        this.state = {
            missions: new Map(entity.components.get(MissionsComponent) ?? []),
            cargo: new Map(entity.components.get(CargoComponent) ?? []),
            credits: {
                credits: entity.components.get(CreditsComponent)?.credits ?? 0,
            },
            bits: new Set(entity.components.get(ControlBitsComponent) ?? []),
            ranks: new Set(entity.components.get(ActiveRanksComponent) ?? []),
            cargoCapacity: derived.cargoCapacity,
            dateAdvance: 0,
            events: [],
            records: new Map(
                entity.components.get(LegalRecordsComponent) ?? []),
            // Batches an earlier session this landing already queued (the
            // landing popups' squad, then the bar's) accumulate until the
            // lift-off drains them.
            autoAbortShips: [
                ...(entity.components.get(PendingAutoAbortShipsComponent)
                    ?? [])],
        };
        this.outfits = new Map([...entity.components.get(OutfitsStateComponent)
            ?? []].map(([id, { count }]) => [id, count]));

        const session = this;
        this.machinery = {
            state: this.state,
            getMission: id => universe.getMission(id),
            offerContext: () => session.offerContext(),
            // Player-local: only resulting state reaches the sim.
            random: Math.random,
            allGovts: () => universe.govts(),
            sameStellar: (a, b) => universe.sameStellar(a, b),
            getRank: id => universe.getRank(id),
            outfitExists: id => universe.hasOutfit(id),
            discovery: playerDiscovery,
            systemExists: universe.systemsLoaded
                ? (id: string) => universe.hasSystem(id) : undefined,
        };
    }

    /**
     * Wires the `Cxxx` / `Exxx` / `Hxxx` (change ship) operators to the
     * venue that can perform them, and the shïp existence lookup they
     * resolve their number through. Only a venue holding the docked
     * entity can swap it; it must call {@link retarget} from inside the
     * hook so the commit lands on the hull the player is now in.
     */
    setChangeShipHook(
        changeShip: NonNullable<MissionMachineryContext['changeShip']>,
        shipExists?: (globalId: string) => boolean): void {
        this.machinery.changeShip = changeShip;
        this.machinery.shipExists = shipExists;
    }

    /**
     * Points the session at a NEW entity for the player — the one a
     * change-ship operator just built (spaceport/shipyard_rules'
     * buildChangedShip) — so commit() writes the working copies onto the
     * hull that will lift off rather than the one just discarded. The
     * working copies themselves are unchanged: they are absolute state
     * (missions, cargo, credits, bits, ranks, records) that means the same
     * thing on either hull; the caller replaces `outfits` itself.
     */
    retarget(entity: Entity, shipId: string): void {
        this.entity = entity;
        this.shipId = shipId;
    }

    /** The entity this session commits onto. */
    get target(): Entity {
        return this.entity;
    }

    /**
     * Rebuilds every working copy from `entity` and points the session at
     * it — IN PLACE, so a view holding `state.credits`, `state.cargo`,
     * `state.bits` or `outfits` keeps reading the truth.
     *
     * For the two moments the entity is the truth and the copies are not:
     * a SHIPYARD PURCHASE, which builds a whole new hull priced and
     * charged from the live entity (shipyard_rules' buildPurchasedShip),
     * and the LANDING'S DATE ADVANCE, which runs the crons and the daily
     * books on the entity before the visit's session is seeded
     * (LandedTransaction.processLanding). Deliberately NOT what a
     * mid-visit `Cxxx`/`Exxx`/`Hxxx` ship change wants: there the working
     * credits and bits are AHEAD of the entity and only the outfits and
     * the target move (see the outfitter's changeShip / retarget).
     *
     * `events` and `dateAdvance` are left alone: they are the session's own
     * unflushed bookkeeping, not a copy of anything on the entity.
     */
    reseed(entity: Entity, shipId?: string): void {
        this.entity = entity;
        this.shipId = shipId ?? entity.components.get(ShipComponent)?.id
            ?? this.shipId;
        this.currentDay = dayNumber(
            entity.components.get(GameDateComponent) ?? getDefaultGameDate());
        const state = this.state;
        replaceMap(state.missions,
            entity.components.get(MissionsComponent) ?? new Map());
        replaceMap(state.cargo, entity.components.get(CargoComponent) ?? new Map());
        state.credits.credits =
            entity.components.get(CreditsComponent)?.credits ?? 0;
        replaceSet(state.bits, entity.components.get(ControlBitsComponent) ?? []);
        if (state.ranks) {
            replaceSet(state.ranks,
                entity.components.get(ActiveRanksComponent) ?? []);
        }
        if (state.records) {
            replaceMap(state.records,
                entity.components.get(LegalRecordsComponent) ?? new Map());
        }
        if (state.autoAbortShips) {
            state.autoAbortShips.length = 0;
            state.autoAbortShips.push(
                ...(entity.components.get(PendingAutoAbortShipsComponent) ?? []));
        }
        this.outfits.clear();
        for (const [id, { count }] of
            entity.components.get(OutfitsStateComponent) ?? []) {
            this.outfits.set(id, count);
        }
    }

    /**
     * Re-derives the per-hull facts ({@link SessionDerived}) from the
     * session's current entity: what {@link create} computed once, for a
     * session that outlives an outfit purchase, a hull swap or a hire
     * (the hires join the payroll it prices). The landing transaction
     * runs this as each venue opens, which is exactly when a fresh
     * per-venue session used to compute the same numbers.
     */
    async rederive(gameData: SimulationGameDataInterface): Promise<void> {
        const derived = await MissionSession.derive(this.entity, gameData);
        this.shipId = derived.shipId;
        this.shipGovt = derived.shipGovt;
        this.shipInherentAI = derived.shipInherentAI;
        this.playerContribute = derived.playerContribute;
        this.payrollShips = derived.payrollShips;
        this.state.cargoCapacity = derived.cargoCapacity;
    }

    /**
     * Updates the working cargo capacity. The outfitter calls this after
     * every buy/sell so an OnPurchase/OnSell set string that starts a
     * cargo mission (Sxxx) checks against the CURRENT capacity — buying or
     * selling a freeCargo outfit changes the hold, and the capacity frozen
     * at session create would otherwise be stale in either direction (L6).
     */
    setCargoCapacity(cargoCapacity: number): void {
        this.state.cargoCapacity = Math.max(0, cargoCapacity);
    }

    private offerContext(): MissionContext {
        const planet = this.universe.getPlanet(this.planetId);
        const cargoUsedTons = [...this.state.cargo.values()]
            .reduce((a, b) => a + b, 0);
        return {
            stellar: planet ? stellarInfoOf(planet) : {
                id: this.planetId, govt: null,
                uninhabited: false, canLand: true,
            },
            stellarCandidates: this.universe.stellarCandidates,
            bits: this.state.bits,
            shipId: this.shipId,
            shipGovt: this.shipGovt,
            shipInherentAI: this.shipInherentAI,
            activeMissions: this.state.missions,
            freeCargoSpace: this.state.cargoCapacity - cargoUsedTons,
            random: Math.random,
            getGovt: id => this.universe.getGovt(id),
            currentDay: this.currentDay,
            records: this.state.records,
            combatRating: this.entity.components
                .get(CombatRatingComponent)?.kills ?? 0,
            playerContribute: this.playerContribute,
            systems: this.universe.systemInfos,
            systemIdOfStellar: id =>
                this.universe.systemIdOfPlanet(id, this.state.bits),
            discovery: playerDiscovery,
            systemExists: this.universe.systemsLoaded
                ? (id: string) => this.universe.hasSystem(id) : undefined,
            // `Oxxx` in AvailBits sees the WORKING outfits, so a Gxxx this
            // visit already counts (mission_logic.ts's ownedOutfits note).
            ownedOutfits: this.outfits,
            // mïsn Flags 0x0008's "not offered below 100 units of fuel"
            // gate. Read off the entity: fuel is not part of the working
            // copy (nothing a mission does while docked changes it), and
            // the in-flight offer session is built over the display
            // mirror, which carries the live tank.
            fuel: this.entity.components.get(FuelComponent)?.current,
        };
    }

    static async create(entity: Entity,
        gameData: SimulationGameDataInterface,
        universe: MissionUniverse, planetId: string,
        options: { announceCheckpoints?: boolean } = {}):
        Promise<MissionSession> {
        await universe.load();
        const derived = await MissionSession.derive(entity, gameData);
        return new MissionSession(entity, universe, planetId, derived,
            options.announceCheckpoints ?? true);
    }

    /** The per-hull facts for `entity` as it stands (see SessionDerived). */
    private static async derive(entity: Entity,
        gameData: SimulationGameDataInterface): Promise<SessionDerived> {
        const shipId = entity.components.get(ShipComponent)?.id ?? 'default';
        const cargoCapacity = await computeCargoCapacity(entity, gameData);
        // The ship's inherent gövt gates the AvailShipType ship-govt
        // ranges (2128+/3128+), and its InherentAI the mïsn Flags 0x2000 /
        // 0x4000 cargo-ship / warship gates; missing ship data leaves both
        // unrestricted.
        let shipGovt: string | null = null;
        let shipInherentAI: number | undefined;
        try {
            const shipData = await gameData.data.Ship.get(shipId);
            shipGovt = shipData.inherentGovt;
            shipInherentAI = shipData.inherentAI;
        } catch {
            // Unknown ship: the ship-govt ranges simply don't match.
        }
        // The ship + outfit Contribute mask gates the mïsn Require field.
        const playerContribute =
            await computePlayerContribute(entity, gameData);
        // The escorts' hull prices, so a DatePostInc settled at commit can
        // charge their wages synchronously (see commitState).
        const payrollShips = await loadPayrollShips(entity, gameData);
        return {
            cargoCapacity, shipId, shipGovt, shipInherentAI,
            playerContribute, payrollShips,
        };
    }

    /**
     * Writes the working copies back onto the entity, then announces the
     * NEW mission events (accepted / completed / failed / aborted) as
     * pilot-history checkpoint requests, so a rewind can land right
     * before or after each (checkpoint_requests.ts). Announced AFTER the
     * write so a recorder snapshotting `entity` sees the committed state.
     */
    commit(): MissionEvent[] {
        const events = this.commitState();
        if (this.announceCheckpoints) {
            const fresh = events.slice(this.eventsAnnounced);
            this.eventsAnnounced = events.length;
            // Only a real stellar id rides along; sessions built with a
            // placeholder ('<outfitter>', '<in-flight>') leave it out.
            const stellar = this.universe.getPlanet(this.planetId)
                ? this.planetId : undefined;
            for (const event of fresh) {
                const label = missionEventLabel(event);
                if (label) {
                    requestCheckpoint({
                        label, kind: 'mission', entity: this.entity,
                        ...(stellar ? { stellar } : {}),
                    });
                }
            }
        }
        return events;
    }

    private commitState(): MissionEvent[] {
        const entity = this.entity;
        // COPIES, not the working objects themselves. The session lives on
        // after a commit (the landing transaction flushes it at every
        // venue's Done and again at lift-off), and the working objects keep
        // their identity for the views; handing the entity the same Map
        // would make every later edit — and every savepoint rollback —
        // visible on the entity before the next flush. The ActiveMission
        // VALUES are shared, as they always were: the machinery edits
        // them in place (mission_landing's travelDone, mission_cargo's
        // cargoLoaded) and a seed copies the Map shallowly.
        entity.components.set(MissionsComponent, new Map(this.state.missions));
        entity.components.set(CargoComponent, new Map(this.state.cargo));
        entity.components.set(CreditsComponent,
            { credits: this.state.credits.credits });
        entity.components.set(ControlBitsComponent, new Set(this.state.bits));
        if (this.state.ranks) {
            // Both halves together: ActiveRanksComponent and the ränk
            // 0x0100 suppression facts the simulation reads off it (the
            // sim cannot resolve a ränk itself — see rank_logic.ts).
            commitActiveRanks(entity, new Set(this.state.ranks),
                id => this.universe.getRank(id));
        }
        if (this.state.records) {
            entity.components.set(LegalRecordsComponent,
                new Map(this.state.records));
        }
        // Only written when there is something to write (or something to
        // overwrite): an entity that never queued a batch does not gain an
        // empty component from every session that touches it.
        const autoAbortShips = this.state.autoAbortShips ?? [];
        if (autoAbortShips.length > 0
            || entity.components.has(PendingAutoAbortShipsComponent)) {
            entity.components.set(PendingAutoAbortShipsComponent,
                [...autoAbortShips]);
        }

        const previousOutfits = entity.components.get(OutfitsStateComponent);
        const outfitsChanged = !previousOutfits
            || previousOutfits.size !== this.outfits.size
            || [...this.outfits].some(([id, count]) =>
                previousOutfits.get(id)?.count !== count);
        if (outfitsChanged) {
            entity.components.set(OutfitsStateComponent, new Map(
                [...this.outfits]
                    .filter(([, count]) => count > 0)
                    .map(([id, count]) => [id, { count }])));
            // Re-derived from the new outfits (see spaceport.ts).
            entity.components.delete(WeaponsStateComponent);
            entity.components.delete(ShipPhysicsComponent);
        }

        // DatePostInc effects. Zero it after applying so a second commit()
        // doesn't advance the date again — dateAdvance is an increment
        // applied to the entity, unlike the other working-copy fields which
        // are absolute maps/sets and are safe to re-set (L5). The events
        // array is returned, not written to the entity, so re-committing
        // does not duplicate notices in entity state.
        if (this.state.dateAdvance > 0) {
            const days = this.state.dateAdvance;
            this.state.dateAdvance = 0;
            // The skipped days are LIVED, not merely dated (#109): stock
            // nova:172 "Head to Nil'ar Kemorya" jumps 180 days and nova:659
            // "Receive Training from Karlaekaar" 185, and a bare addDays
            // left every one of them without its cron rolls, its ränk
            // salary ("per day") and its escort wages. So they go through
            // the same per-day settlement a jump or a landing gets, on the
            // state just committed above — it is the entity, not the
            // working copies, that settleDateAdvance reads and writes.
            //
            // A DETACHED copy (ship_mission_accept.ts, announceCheckpoints
            // off) carries no CronStatesComponent — the crons' own
            // once-only bookkeeping — and its diff has nowhere to carry one
            // back, so on that path the crons are skipped and only the
            // books and the calendar move; the delta the accept record
            // carries (dateDelta, creditsDelta) then replays identically on
            // every peer. No stock ship-offered mission has a DatePostInc
            // (mission_accept.ts's note), so nothing turns on it today.
            settleDateAdvance(entity, days, this.universe, {
                contribute: this.playerContribute,
                getShip: id => this.payrollShips.get(id),
                crons: this.announceCheckpoints,
            });
            // The crons and the books may have moved the very state this
            // session holds working copies of (a cron's Bxxx/Kxxx/Gxxx, a
            // salary); a second commit() must not roll them back to the
            // pre-advance copies. Re-read IN PLACE: the views hold these
            // objects (see the class doc).
            replaceSet(this.state.bits,
                entity.components.get(ControlBitsComponent) ?? []);
            if (this.state.ranks) {
                replaceSet(this.state.ranks,
                    entity.components.get(ActiveRanksComponent) ?? []);
            }
            this.state.credits.credits =
                entity.components.get(CreditsComponent)?.credits ?? 0;
            this.outfits.clear();
            for (const [id, { count }] of
                entity.components.get(OutfitsStateComponent) ?? []) {
                this.outfits.set(id, count);
            }
        }
        return this.state.events;
    }

    /**
     * Runs a mission NCB set string (an outfit's OnPurchase/OnSell, say)
     * against this session's working state, with the mission operators
     * Sxxx/Axxx/Fxxx and outfit grants Gxxx/Dxxx all wired to the real
     * machinery. `missionPrefix` scopes numeric ids to the running
     * resource's plug-in. Call commit() afterwards to persist.
     */
    runMissionSet(expression: string, missionPrefix: string): void {
        runMissionSetString(this.machinery, expression, missionPrefix,
            this.outfits);
    }
}

/** Replaces `target`'s entries with `source`'s, keeping `target`'s identity. */
export function replaceMap<K, V>(target: Map<K, V>,
    source: Iterable<readonly [K, V]>): void {
    target.clear();
    for (const [key, value] of source) {
        target.set(key, value);
    }
}

/** Replaces `target`'s members with `source`'s, keeping `target`'s identity. */
export function replaceSet<T>(target: Set<T>, source: Iterable<T>): void {
    target.clear();
    for (const value of source) {
        target.add(value);
    }
}

/**
 * The landing's mission pass on a session that has ALREADY been seeded
 * from the date-advanced entity: every active mission is checked against
 * this stellar (completion + payment, deadline failures, travel-leg cargo
 * transfer). The caller commits — processEntityLanding through
 * session.commit(), the landing transaction through its flush — and
 * returns the events.
 */
export function processLandingOn(session: MissionSession): void {
    processLanding(session.machinery, session.planetId, session.currentDay,
        session.outfits);
}

/**
 * Settles the player's daily books for `days` days of calendar advance:
 * the active ranks' salaries, and the wages of the escorts on their payroll.
 *
 * EVN Bible, ränk: Salary is "The number of credits that the affiliated
 * government will pay the player, per day"; SalaryCap is "The maximum amount
 * of money the player can have before the affiliated government stops paying
 * the salary. Set to 0 or -1 if unused." A NEGATIVE Salary is an expense
 * (Extra Outfits' ränk 167, "Shipyard Expenses (1000 per day)"), and an
 * escort draws 10% of its hire price a day (escort_fees.ts).
 *
 * Settled DAY BY DAY, re-reading the balance each day, so a capped salary
 * stops on the day the cap is crossed rather than paying the whole jump at
 * once (and so several days' pay cannot vault a player past a cap they should
 * have stopped at). Player-local, like every other part of the date advance:
 * the resulting CreditsComponent is what reaches peers.
 *
 * The arithmetic itself is daily_budget.ts's `settleDailyBudget`, because the
 * player-info dialog prints the very same rate as its "Income:" / "Expenses:"
 * lines and the two must not be able to disagree.
 *
 * The ranks passed in are the set the crons just finished mutating, so a rank
 * granted mid-advance starts earning from the following day. The escort
 * payroll is the mirror EscortPayrollSystem left on the entity the last time
 * the player and their flock were in the world together (see
 * EscortPayrollComponent) — plus any escort hired at the bar this very
 * landing, which has not been spawned yet (PendingEscortsComponent).
 */
function settlePlayerBudget(entity: Entity, ranks: Set<string>,
    universe: MissionUniverse, days: number,
    getShip?: (id: string) => ShipData | undefined): void {
    const credits = entity.components.get(CreditsComponent);
    if (!credits) {
        return;
    }
    const inputs = {
        ranks,
        getRank: (id: string) => universe.getRank(id),
        escortShips: playerPayroll(entity),
        getShip,
    };
    const balance = settleDailyBudget(inputs, credits.credits, days);
    if (balance !== credits.credits) {
        entity.components.set(CreditsComponent, { credits: balance });
    }
}

/**
 * Every escort whose wage the player owes: the mirror of the flock that was
 * in the world with them (EscortPayrollComponent) plus the pilots hired at
 * the bar this landing, who are still standing at the bar
 * (PendingEscortsComponent) and only become entities at lift-off.
 *
 * The two lists cannot overlap: browser.ts pops PendingEscorts off the entity
 * before the launch record is encoded, and the payroll mirror only sees them
 * once they are spawned ships.
 */
export function playerPayroll(entity: Entity): string[] {
    return [...(entity.components.get(EscortPayrollComponent) ?? []),
        ...(entity.components.get(PendingEscortsComponent) ?? [])];
}

/**
 * The ship data behind {@link playerPayroll}'s ids, so the (synchronous)
 * budget arithmetic can price each escort's hull. A class the data set
 * cannot produce is simply absent and contributes no fee — the same rule
 * the shops use for an unloadable hull.
 */
export async function loadPayrollShips(entity: Entity,
    gameData?: SimulationGameDataInterface):
    Promise<Map<string, ShipData>> {
    const ships = new Map<string, ShipData>();
    if (!gameData) {
        return ships;
    }
    for (const id of new Set(playerPayroll(entity))) {
        try {
            ships.set(id, await gameData.data.Ship.get(id));
        } catch {
            // No hull, no fee.
        }
    }
    return ships;
}

/**
 * A ship's total cargo capacity in tons: the hull's freeCargo plus any
 * freeCargo granted by its outfits.
 */
export async function computeCargoCapacity(entity: Entity,
    gameData: SimulationGameDataInterface): Promise<number> {
    const shipId = entity.components.get(ShipComponent)?.id ?? 'default';
    let cargoCapacity = 0;
    try {
        const shipData = await gameData.data.Ship.get(shipId);
        cargoCapacity = shipData.physics.freeCargo;
        const outfitsState = entity.components.get(OutfitsStateComponent);
        if (outfitsState) {
            for (const [outfitId, { count }] of outfitsState) {
                const outfit = await gameData.data.Outfit.get(outfitId);
                cargoCapacity +=
                    (outfit.physics.freeCargo ?? 0) * count;
            }
        }
    } catch (e) {
        console.warn('Failed to compute cargo capacity:', e);
    }
    return Math.max(0, cargoCapacity);
}

/**
 * The player's combined Contribute mask: the ship's Contribute OR'd
 * with each owned outfit's Contribute (per the EVN Bible's shared
 * Contribute/Require mechanic). Used to gate crön Require. Contribute
 * fields are stored as hex strings; a malformed one is treated as 0.
 */
export async function computePlayerContribute(entity: Entity,
    gameData: SimulationGameDataInterface): Promise<bigint> {
    const parseMask = (hex: string | undefined): bigint => {
        try {
            return BigInt(hex ?? '0x0');
        } catch {
            return 0n;
        }
    };
    let contribute = 0n;
    try {
        const shipId = entity.components.get(ShipComponent)?.id ?? 'default';
        contribute = parseMask((await gameData.data.Ship.get(shipId))
            .contribute);
        const outfitsState = entity.components.get(OutfitsStateComponent);
        if (outfitsState) {
            for (const [outfitId, { count }] of outfitsState) {
                if (count > 0) {
                    contribute |= parseMask(
                        (await gameData.data.Outfit.get(outfitId)).contribute);
                }
            }
        }
        // rank Contribute: "Another 64 bits of Contribute values that kick
        // in when the rank is active. These can be used to prevent the player
        // from buying certain items or doing certain missions until achieving
        // a certain rank" (EVN Bible). Decimal, and per-plug-in namespaced by
        // novaparse exactly as outfit Contribute is, so it ORs straight in.
        const ranks = entity.components.get(ActiveRanksComponent);
        if (ranks) {
            for (const rankId of ranks) {
                try {
                    contribute |=
                        BigInt((await gameData.data.Rank.get(rankId))
                            .contribute);
                } catch {
                    // Unknown rank: contributes nothing.
                }
            }
        }
    } catch (e) {
        console.warn('Failed to compute player contribute:', e);
    }
    return contribute;
}

/**
 * Landing bookkeeping for the docked player entity: advances the date
 * by one day (landing takes a day in EV Nova), then processes every
 * active mission against this stellar — deadline failures, travel
 * legs, and completion with payment. Returns the events for the UI,
 * including any notices queued from mid-flight failures (deadlines that
 * expired during jumps, sim-marked disable/destroy failures).
 */
export async function processEntityLanding(entity: Entity,
    gameData: SimulationGameDataInterface, universe: MissionUniverse,
    planetId: string): Promise<MissionEvent[]> {
    // A landing advances the player's calendar by one day (and runs
    // any crons that fire on it, and fails any now-expired missions).
    await advanceEntityDate(entity, 1, universe, gameData);

    const session = await MissionSession.create(
        entity, gameData, universe, planetId);
    processLandingOn(session);
    const events = session.commit();

    // Notices queued while the player was in flight surface here first —
    // but they are only DRAINED once the landing above has gone through.
    // Draining first was a lost-notice seam: MissionSession.create awaits
    // game data and can throw, and the caller (spaceport.ts's show)
    // catches, so a failure between the drain and the return took the
    // queued deadline/auto-abort notices with it and the player never saw
    // them. Nothing between here and the drain writes the queue —
    // advanceEntityDate, which does, already ran above — so deferring it
    // reorders nothing.
    return [...drainPendingMissionNotices(entity), ...events];
}

/**
 * Removes and returns the mission notices queued on the entity from
 * mid-flight failures (see PendingMissionNoticesComponent).
 */
export function drainPendingMissionNotices(entity: Entity): MissionEvent[] {
    const pending = entity.components.get(PendingMissionNoticesComponent);
    if (!pending || pending.length === 0) {
        return [];
    }
    entity.components.set(PendingMissionNoticesComponent, []);
    return pending.map(notice => ({
        missionId: notice.missionId,
        missionName: notice.missionName,
        type: notice.type,
        text: notice.text,
        pict: notice.pict,
        payment: notice.payment,
        specialShipName: notice.specialShipName,
    }));
}

/**
 * Advances the player's calendar by `days`, evaluating crön events for
 * each day passed and — when `gameData` is supplied — failing any
 * mission whose deadline has now passed (or which the shared sim marked
 * failed), so an in-flight deadline fails the moment it expires rather
 * than waiting for the next landing. Failure notices are queued on the
 * entity (PendingMissionNoticesComponent) for the next spaceport
 * screen. Runs player-locally while the entity is outside the
 * simulation (docked, or during the jump handoff); the mutated
 * components sync to peers with the re-added entity.
 */
export async function advanceEntityDate(entity: Entity, days: number,
    universe: MissionUniverse,
    gameData?: SimulationGameDataInterface): Promise<void> {
    ensurePlayerStateComponents(entity);
    if (days <= 0) {
        return;
    }

    // Everything asynchronous is gathered BEFORE a single component is
    // written, and the calendar is the LAST thing settleDateAdvance sets
    // (#120): a rejected universe.load() or data fetch used to find the
    // date already moved, so the days it skipped were never stepped by
    // the crons — the next advance started from the new day — and never
    // paid for. Now a failure here leaves the entity exactly as it was;
    // the day is simply not charged (browser.ts's jump path already
    // rules the date cost forfeit on a failure, and a landing retried
    // after one is charged its day once, not twice).
    try {
        await universe.load();
        // The player's ship + outfit Contribute mask gates cron Require
        // (needs game data; without it crons see no contributions).
        const contribute = gameData
            ? await computePlayerContribute(entity, gameData)
            : 0n;
        // Escort wages need the hull prices, so the payroll's ship classes
        // are fetched first. Without game data (the bare callers) there are
        // no prices and so no escort expense — the same "gameData-less
        // callers see less" rule the Contribute mask above follows.
        const payrollShips = await loadPayrollShips(entity, gameData);
        settleDateAdvance(entity, days, universe, {
            contribute, getShip: id => payrollShips.get(id),
        });
    } catch (e) {
        console.warn('Cron evaluation failed:', e);
    }

    // In-flight mission upkeep: fail now-expired / sim-flagged missions
    // and run OnShipDone for goals the sim just completed. Needs the game
    // data for set strings and reputation, so it's skipped for the bare
    // (gameData-less) callers.
    if (gameData) {
        try {
            await processInFlightMissions(entity, gameData, universe);
        } catch (e) {
            console.warn('In-flight mission evaluation failed:', e);
        }
    }
}

/**
 * The SYNCHRONOUS core of a date advance, shared by {@link advanceEntityDate}
 * (jumps and landings) and by MissionSession.commitState (a completed or
 * auto-aborted mission's DatePostInc, #109): steps the crons over each
 * skipped day, settles the day's books, and only then moves the calendar.
 *
 * TRANSACTIONAL. The crons run on working copies of the bits, ranks, cron
 * states and outfits, and nothing is written to the entity until every
 * day has been stepped; a set string that throws leaves the entity — the
 * date included — untouched (#120). The writes themselves are plain
 * component sets, so a failure between them cannot occur.
 *
 * `crons: false` settles the books and the calendar alone, for a detached
 * copy of the player that has no cron state to step (see commitState).
 */
export function settleDateAdvance(entity: Entity, days: number,
    universe: MissionUniverse, options: {
        /** The player's Contribute mask, gating crön Require. */
        contribute: bigint,
        /** Hull data for the escort payroll; a miss is no fee. */
        getShip?: (id: string) => ShipData | undefined,
        /** Whether to step the crons at all (default true). */
        crons?: boolean,
    }): void {
    ensurePlayerStateComponents(entity);
    if (days <= 0) {
        return;
    }
    const date = entity.components.get(GameDateComponent)!;
    const fromDay = dayNumber(date);
    const ranks = new Set(entity.components.get(ActiveRanksComponent) ?? []);

    if (options.crons ?? true) {
        const bits = new Set(entity.components.get(ControlBitsComponent)!);
        const cronStates =
            new Map(entity.components.get(CronStatesComponent)!);
        // A cron's set string may grant a rank (Kxxx), so the crons run
        // against a working copy of the active ranks too and it is committed
        // beside the bits.
        // Crön EnableOn tests the player's outfits (Oxxx) and its set
        // strings grant and consume them (Gxxx/Dxxx) — Extra Outfits'
        // Weapon Construction Bay is exactly that — so this working copy is
        // committed back below when the crons changed it.
        const ownedOutfits = new Map([...entity.components.get(OutfitsStateComponent)
            ?? []].map(([id, { count }]) => [id, count]));
        runCronsForDays(universe.crons, cronStates, bits,
            fromDay, fromDay + days, Math.random, options.contribute, {
            ranks: {
                active: ranks,
                // Fallback only: runCronsForDays rescopes ids to each
                // cron's own plug-in prefix as it steps it.
                resolveId: id => `nova:${id}`,
                getRank: id => universe.getRank(id),
            },
            ownedOutfits,
            outfitExists: id => universe.hasOutfit(id),
            // Crön EnableOn tests the pilot's map knowledge (Exxx) and its
            // set strings extend it (Xxxx). Written straight through, like
            // every other discovery event (see playerDiscovery).
            discovery: playerDiscovery,
            systemExists: universe.systemsLoaded
                ? (id: string) => universe.hasSystem(id) : undefined,
        });
        entity.components.set(ControlBitsComponent, bits);
        // A crön set string may have granted or dropped a rank (Kxxx /
        // Lxxx), so the baked suppression set is re-derived with it.
        commitActiveRanks(entity, ranks, id => universe.getRank(id));
        entity.components.set(CronStatesComponent, cronStates);
        commitCronOutfits(entity, ownedOutfits);
    }
    settlePlayerBudget(entity, ranks, universe, days, options.getShip);
    entity.components.set(GameDateComponent, addDays(date, days));
}

/**
 * Writes back the outfits the crons just granted or consumed (Gxxx/Dxxx in
 * a crön set string), and only then: an untouched map leaves the component
 * — and the caches derived from it — exactly as they were, so an ordinary
 * date advance stays free.
 *
 * The derived caches go the same way MissionSession.commitState sends
 * them, for the same reason: the ammunition a Weapon Construction Bay just
 * built has to reach the launcher's magazine, and the outfit's mass has to
 * reach the ship's physics.
 */
function commitCronOutfits(entity: Entity,
    outfits: ReadonlyMap<string, number>): void {
    const previous = entity.components.get(OutfitsStateComponent);
    const live = [...outfits].filter(([, count]) => count > 0);
    const unchanged = previous
        ? previous.size === live.length
        && live.every(([id, count]) => previous.get(id)?.count === count)
        // An entity with no outfits at all keeps none: the crons must not
        // be what gives it the component.
        : live.length === 0;
    if (unchanged) {
        return;
    }
    entity.components.set(OutfitsStateComponent,
        new Map(live.map(([id, count]) => [id, { count }])));
    // Re-derived from the new outfits (see spaceport.ts).
    entity.components.delete(WeaponsStateComponent);
    entity.components.delete(ShipPhysicsComponent);
}

/**
 * In-flight mission upkeep at a date advance (jump or landing), before
 * any landing is processed:
 *  - fails missions whose deadline has passed or which the shared sim
 *    marked failed (running OnFailure), and
 *  - runs OnShipDone for missions whose ship goal the sim just completed
 *    (shipDonePending), so it fires at the first player-local
 *    opportunity rather than only at a landing.
 * Any resulting notices are queued for the next spaceport screen. A
 * no-op — skipping the session build — when nothing is due, so the
 * common date advance stays cheap.
 */
async function processInFlightMissions(entity: Entity,
    gameData: SimulationGameDataInterface,
    universe: MissionUniverse): Promise<void> {
    const missions = entity.components.get(MissionsComponent);
    if (!missions || missions.size === 0) {
        return;
    }
    const currentDay = dayNumber(
        entity.components.get(GameDateComponent) ?? getDefaultGameDate());
    const anyDue = [...missions.values()].some(active =>
        active.failed
        || (active.deadlineDay !== null && currentDay > active.deadlineDay)
        || active.shipObjective?.shipDonePending
        // A deferred auto-abort the sim fired when the owner boarded the
        // special ship (mïsn Flags 0x0001); see runPendingAutoAborts.
        || active.autoAbortPending);
    if (!anyDue) {
        return;
    }
    const session = await MissionSession.create(
        entity, gameData, universe, '<in-flight>');
    // OnShipDone first: a goal that completed can influence a mission
    // that then fails (e.g. an OnShipDone that starts a timed follow-up).
    runPendingShipDone(session.machinery, session.outfits);
    // The deferred auto-abort's player-local half, before the deadline
    // sweep: a mission that has already aborted must not also be failed.
    runPendingAutoAborts(session.machinery, session.outfits);
    failExpiredMissions(session.machinery, currentDay, session.outfits);
    // The ShipDoneText the deferred pass just queued has usually ALREADY
    // been read: the display shows it the moment the goal completes, in
    // flight, which is where the original shows it (see
    // display/mission_ship_done_plugin.ts). Taking the mark drops the
    // duplicate popup while leaving OnShipDone — the half that really is
    // deferred — to run here as before. Nothing else about the event is
    // suppressed, and a text the client never got to show (the player
    // quit between the goal completing and this date advance) carries no
    // mark, so it still surfaces at the next spaceport.
    const events = session.commit().filter(event =>
        !(event.type === 'shipDone'
            && takeShipDoneTextShown(event.missionId)));
    if (events.length > 0) {
        const existing =
            entity.components.get(PendingMissionNoticesComponent) ?? [];
        entity.components.set(PendingMissionNoticesComponent,
            [...existing, ...events.map(e => ({
                missionId: e.missionId,
                missionName: e.missionName,
                type: e.type,
                text: e.text,
                payment: e.payment,
                // Only a present (non-null) pict rides the serialized
                // partial; a null dësc-graphic is simply omitted.
                ...(e.pict ? { pict: e.pict } : {}),
                ...(e.specialShipName
                    ? { specialShipName: e.specialShipName } : {}),
            }))]);
    }
}

/**
 * Gives the entity the player-state components missions rely on if it
 * doesn't have them yet (fresh pilots get theirs from the chär data
 * in browser.ts; this is the safety net for older saves).
 */
export function ensurePlayerStateComponents(entity: Entity): void {
    if (!entity.components.get(GameDateComponent)) {
        entity.components.set(GameDateComponent, getDefaultGameDate());
    }
    if (!entity.components.get(CreditsComponent)) {
        entity.components.set(CreditsComponent, { credits: 0 });
    }
    if (!entity.components.get(MissionsComponent)) {
        entity.components.set(MissionsComponent, new Map());
    }
    if (!entity.components.get(CargoComponent)) {
        entity.components.set(CargoComponent, new Map());
    }
    if (!entity.components.get(ControlBitsComponent)) {
        entity.components.set(ControlBitsComponent, new Set());
    }
    if (!entity.components.get(ActiveRanksComponent)) {
        entity.components.set(ActiveRanksComponent, new Set());
    }
    if (!entity.components.get(AggressionSuppressGovtsComponent)) {
        // Seeded, never derived here: this function has no ränk lookup.
        // The real value is written by commitActiveRanks at every point a
        // rank is granted, loaded or migrated.
        entity.components.set(AggressionSuppressGovtsComponent, new Set());
    }
    if (!entity.components.get(CronStatesComponent)) {
        entity.components.set(CronStatesComponent, new Map());
    }
    if (!entity.components.get(LegalRecordsComponent)) {
        entity.components.set(LegalRecordsComponent, new Map());
    }
    if (!entity.components.get(CombatRatingComponent)) {
        entity.components.set(CombatRatingComponent, { kills: 0 });
    }
}
