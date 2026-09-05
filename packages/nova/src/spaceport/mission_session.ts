import { Entity } from 'nova_ecs/entity';
import { getDefaultGameDate } from 'novadatainterface/player_start_data';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { addDays, dayNumber } from '../nova_plugin/calendar.js';
import { CargoComponent } from '../nova_plugin/cargo_plugin.js';
import { runCronsForDays } from '../nova_plugin/cron_logic.js';
import { playerDiscovery } from '../nova_plugin/discovery_store.js';
import { FuelComponent } from '../nova_plugin/health_plugin.js';
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
} from '../nova_plugin/mission_logic.js';
import {
    ActiveRanksComponent, AggressionSuppressGovtsComponent,
    commitActiveRanks, ControlBitsComponent,
} from '../nova_plugin/ncb_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import {
    CreditsComponent,
    CronStatesComponent,
    GameDateComponent,
    MissionsComponent,
    PendingAutoAbortShipsComponent,
    PendingMissionNoticesComponent,
} from '../nova_plugin/player_state_plugin.js';
import { CombatRatingComponent, LegalRecordsComponent } from '../nova_plugin/reputation_plugin.js';
import { ShipComponent, ShipPhysicsComponent } from '../nova_plugin/ship_plugin.js';
import { WeaponsStateComponent } from '../nova_plugin/weapons_state.js';
import { MissionUniverse } from './mission_universe.js';
import { EscortPayrollComponent } from '../nova_plugin/player_escort.js';
import { ShipData } from 'novadatainterface/ship_data';
import { settleDailyBudget } from './daily_budget.js';
import { PendingEscortsComponent } from './pending_escorts.js';
import { missionEventLabel, requestCheckpoint } from './checkpoint_requests.js';
import { takeShipDoneTextShown } from './ship_done_shown.js';

/**
 * A player-local editing session over the mission-related components
 * of the (docked, out-of-simulation) player entity: working copies of
 * missions, cargo, credits, bits, and outfits, plus the machinery
 * context mission_logic.ts operates on. Commit writes the copies back
 * to the entity — the same pattern the outfitter uses.
 */
export class MissionSession {
    readonly state: MissionWorkingState;
    readonly outfits: Map<string, number>;
    readonly machinery: MissionMachineryContext;
    readonly currentDay: number;
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
        cargoCapacity: number,
        public shipId: string,
        private shipGovt: string | null,
        private playerContribute: bigint,
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

        this.state = {
            missions: new Map(entity.components.get(MissionsComponent) ?? []),
            cargo: new Map(entity.components.get(CargoComponent) ?? []),
            credits: {
                credits: entity.components.get(CreditsComponent)?.credits ?? 0,
            },
            bits: new Set(entity.components.get(ControlBitsComponent) ?? []),
            ranks: new Set(entity.components.get(ActiveRanksComponent) ?? []),
            cargoCapacity,
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
        const shipId = entity.components.get(ShipComponent)?.id ?? 'default';
        const cargoCapacity = await computeCargoCapacity(entity, gameData);
        // The ship's inherent gövt gates the AvailShipType ship-govt
        // ranges (2128+/3128+); missing ship data leaves it unrestricted.
        let shipGovt: string | null = null;
        try {
            shipGovt = (await gameData.data.Ship.get(shipId)).inherentGovt;
        } catch {
            // Unknown ship: the ship-govt ranges simply don't match.
        }
        // The ship + outfit Contribute mask gates the mïsn Require field.
        const playerContribute =
            await computePlayerContribute(entity, gameData);
        return new MissionSession(entity, universe, planetId,
            cargoCapacity, shipId, shipGovt, playerContribute,
            options.announceCheckpoints ?? true);
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
        entity.components.set(MissionsComponent, this.state.missions);
        entity.components.set(CargoComponent, this.state.cargo);
        entity.components.set(CreditsComponent,
            { credits: this.state.credits.credits });
        entity.components.set(ControlBitsComponent, this.state.bits);
        if (this.state.ranks) {
            // Both halves together: ActiveRanksComponent and the ränk
            // 0x0100 suppression facts the simulation reads off it (the
            // sim cannot resolve a ränk itself — see rank_logic.ts).
            commitActiveRanks(entity, this.state.ranks,
                id => this.universe.getRank(id));
        }
        if (this.state.records) {
            entity.components.set(LegalRecordsComponent, this.state.records);
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
            const date = entity.components.get(GameDateComponent)
                ?? getDefaultGameDate();
            entity.components.set(GameDateComponent,
                addDays(date, this.state.dateAdvance));
            this.state.dateAdvance = 0;
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
    processLanding(session.machinery, planetId, session.currentDay,
        session.outfits);
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
        type: notice.type as MissionEvent['type'],
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
    const date = entity.components.get(GameDateComponent)!;
    const fromDay = dayNumber(date);
    entity.components.set(GameDateComponent, addDays(date, days));

    try {
        await universe.load();
        const bits = new Set(entity.components.get(ControlBitsComponent)!);
        const ranks =
            new Set(entity.components.get(ActiveRanksComponent) ?? []);
        const cronStates =
            new Map(entity.components.get(CronStatesComponent)!);
        // The player's ship + outfit Contribute mask gates cron Require
        // (needs game data; without it crons see no contributions).
        const contribute = gameData
            ? await computePlayerContribute(entity, gameData)
            : 0n;
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
            fromDay, fromDay + days, Math.random, contribute, {
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
        // Escort wages need the hull prices, so the payroll's ship classes
        // are fetched first. Without game data (the bare callers) there are
        // no prices and so no escort expense — the same "gameData-less
        // callers see less" rule the Contribute mask above follows.
        const payrollShips = await loadPayrollShips(entity, gameData);
        settlePlayerBudget(entity, ranks, universe, days,
            id => payrollShips.get(id));
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
