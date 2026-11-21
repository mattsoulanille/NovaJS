/**
 * ============================================================================
 * Warming what LANDING will need, in the background, once in space (#369)
 * ============================================================================
 *
 * Entering a system loads what flying needs (#368); landing then used to
 * wait on its own loads at the deployed server's ~100 ms round trip: the
 * spaceport frame and every venue's frame (the Spaceport builds all of
 * them as it opens), the stellar's landscape, the landing popups' frames,
 * the BBS string table, the outfitter's weapon warm-up, and — opening the
 * venues — the trade center's jünk/öops and the shop grids' item art.
 *
 * Once the player is IN SPACE (client state `inSpace`) this warms the same
 * caches the landed UI reads, for the stellars of the current system:
 *
 *  - PICTs through the display's PIXI texture cache (the one
 *    spriteFromPict / textureFromPict read), STR# and the spaceport sounds
 *    through their Gettables;
 *  - game data through the main thread's SimulationGameData Gettables (the
 *    landed UI's `simulationData`), as one batched request per level.
 *
 * WHAT IS WARMED (the maintainer's ruling on #369): only for a system with
 * a landable stellar (canLand, not a gate) — a system without one warms
 * nothing landing-related. Per landable stellar: its landscape PICT, its
 * bar graphic, its ambient sound, and the pictures of the missions it can
 * offer. The shared spaceport art (frame, buttons, popups, BBS) once. A
 * venue's art and data (bar, outfitter, shipyard, trade center) only when
 * SOME landable stellar here has that venue (the spöb flags); the shops'
 * item art is scoped to the first pages those stellars stock.
 *
 * IT ONLY WARMS. Nothing here decides what the landed UI shows, and
 * nothing touches the simulation: the worker's SimulationGameData is a
 * separate instance this never sees. (The main thread's data warms the
 * same way the session's MissionUniverse warm-up already does.)
 *
 * LOW PRIORITY. Work starts only after `inSpace`, one item at a time per
 * slot of a small concurrency budget, each start deferred to an idle
 * callback, so it never competes with entry, the frame pump or the
 * display world's own loads. Leaving space (landing, a jump, the title)
 * CANCELS the run: nothing new is issued after that (requests already in
 * flight just land in the cache). Back in space in the same system the
 * run resumes (whatever finished is a cache hit); a new system starts a
 * new run. Failures are swallowed: one debug-level line per run.
 *
 * Client-local: nothing here touches simulation state.
 */
import type { OutfitData } from 'novadatainterface/outfit_data';
import type { PlanetData } from 'novadatainterface/planet_data';
import type { ShipData } from 'novadatainterface/ship_data';
import type { DisplayAssetDataResources } from './gamedata/display_asset_data.js';
import type { SimulationGameDataInterface } from './gamedata/simulation_game_data.js';
import type { ClientState, ClientStateSlot } from './client_state.js';
import {
    matchesStellarRef, setStringPrefix, stellarInfoOf,
} from '../nova_plugin/missions/index.js';
import { BAR_GRAPHIC_FRAME_PICT, BAR_PICT } from '../spaceport/bar.js';
import { BUTTON_PICTS } from '../spaceport/button.js';
import { GAMBLE_PICTS } from '../spaceport/gamble.js';
import {
    HIRE_DIALOG_PICT, NO_SHIPS_FOR_HIRE_TABLE,
} from '../spaceport/hire_escort.js';
import { ITEM_GRID_PAGE_SIZE } from '../spaceport/item_grid.js';
import { BBS_STRING_TABLE } from '../spaceport/mission_board.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { OFFER_POPUP_PICTS } from '../spaceport/offer_popup.js';
import { OUTFITTER_PICT } from '../spaceport/outfitter.js';
import {
    meetsTechLevel, SELL_REFUSAL_TABLE, stellarOf, stellarStocks,
} from '../spaceport/outfitter_rules.js';
import { SHIP_INFO_PICT } from '../spaceport/ship_info.js';
import { SHIPYARD_PICT } from '../spaceport/shipyard.js';
import { compareShipIds } from '../spaceport/shipyard_stock_rules.js';
import { changeShipTargets } from '../spaceport/change_ship_targets.js';
import { MISSION_BBS_PICT, SPACEPORT_PICT } from '../spaceport/spaceport.js';
import { TRADE_CENTER_PICT } from '../spaceport/trade_center.js';

/** What the prefetch warms the display side through. */
export interface LandedUiAssets {
    readonly data: Pick<DisplayAssetDataResources, 'StringTable' | 'Sound'>;
    /** Loads a PICT into the cache spriteFromPict reads (see
     * DisplayAssetData.prefetchPict). */
    prefetchPict(id: string): Promise<void>;
}

/** Defers a task to when the page is idle. */
export type IdleScheduler = (task: () => void) => void;

/**
 * requestIdleCallback where the platform has it (with a timeout, so a
 * busy page still gets through the list), else a macrotask.
 */
export const browserIdle: IdleScheduler = task => {
    const idle = (globalThis as {
        requestIdleCallback?: (cb: () => void, options?: { timeout: number })
            => number,
    }).requestIdleCallback;
    if (idle) {
        idle(task, { timeout: 1000 });
    } else {
        setTimeout(task, 0);
    }
};

export interface LandedUiPrefetchOptions {
    /** Where each item's start is deferred to (default: browserIdle). */
    schedule?: IdleScheduler;
    /** Items in flight at once (default 4). */
    concurrency?: number;
    /** The one debug line a run with failures logs (default console.debug). */
    debug?: (message: string) => void;
}

/** Thrown into a cancelled run's pending steps; never logged. */
class Cancelled extends Error { }

interface Run {
    readonly systemId: string;
    cancelled: boolean;
    done: boolean;
    readonly promise: Promise<void>;
}

/** What a run warms for one system, before the item art and missions. */
export interface LandedUiPlan {
    /** The landable stellars (canLand, not a gate). */
    landable: PlanetData[];
    /** Which venues some landable stellar here has. */
    venues: { bar: boolean, outfitter: boolean, shipyard: boolean, trade: boolean };
    /** PICTs to warm (shared art, landscapes, venue frames). */
    picts: Set<string>;
    /** STR# ids to warm. */
    stringTables: Set<string>;
    /** Spaceport ambient sounds to warm. */
    sounds: Set<string>;
}

/**
 * The landing-related art for a system's stellars (empty when none is
 * landable). Pure: what `run` warms first, and what the specs check.
 */
export function planLandedUi(planets: readonly (PlanetData | undefined)[]):
    LandedUiPlan {
    const landable = planets.filter((planet): planet is PlanetData =>
        planet !== undefined && planet.flags.canLand && planet.gate === null);
    const venues = {
        bar: landable.some(planet => planet.flags.hasBar),
        outfitter: landable.some(planet => planet.flags.hasOutfitter),
        shipyard: landable.some(planet => planet.flags.hasShipyard),
        trade: landable.some(planet => planet.flags.hasCommodityExchange),
    };
    const picts = new Set<string>();
    const stringTables = new Set<string>();
    const sounds = new Set<string>();
    if (landable.length === 0) {
        return { landable, venues, picts, stringTables, sounds };
    }
    // Every spaceport: its frame, the buttons, the landing popups and the
    // Mission BBS (which every spaceport has).
    for (const id of [SPACEPORT_PICT, MISSION_BBS_PICT, ...BUTTON_PICTS,
        ...OFFER_POPUP_PICTS]) {
        picts.add(id);
    }
    stringTables.add(BBS_STRING_TABLE);
    for (const planet of landable) {
        picts.add(planet.landingPict);
        if (planet.flags.hasBar && planet.barPict) {
            picts.add(BAR_GRAPHIC_FRAME_PICT);
            picts.add(planet.barPict);
        }
        if (planet.spaceportSound) {
            sounds.add(planet.spaceportSound);
        }
    }
    if (venues.bar) {
        for (const id of [BAR_PICT, HIRE_DIALOG_PICT, ...GAMBLE_PICTS]) {
            picts.add(id);
        }
        stringTables.add(NO_SHIPS_FOR_HIRE_TABLE);
    }
    if (venues.outfitter) {
        picts.add(OUTFITTER_PICT);
        stringTables.add(SELL_REFUSAL_TABLE);
    }
    if (venues.shipyard) {
        picts.add(SHIPYARD_PICT);
        picts.add(SHIP_INFO_PICT);
    }
    if (venues.trade) {
        picts.add(TRADE_CENTER_PICT);
    }
    return { landable, venues, picts, stringTables, sounds };
}

/** The item art a shop's first pages show: the stocked items, best first. */
function firstPagesOf<T extends { pict: string, displayWeight: number, id: string }>(
    items: T[], compare: (a: T, b: T) => number): string[] {
    return [...items].sort((a, b) => b.displayWeight - a.displayWeight
        || compare(a, b))
        .slice(0, 2 * ITEM_GRID_PAGE_SIZE)
        .map(item => item.pict);
}

export class LandedUiPrefetch {
    private current?: Run;
    private inFlight = 0;
    private readonly waiting: (() => void)[] = [];
    private readonly schedule: IdleScheduler;
    private readonly concurrency: number;
    private readonly debug: (message: string) => void;

    constructor(private readonly gameData: SimulationGameDataInterface,
        private readonly assets: LandedUiAssets,
        options: LandedUiPrefetchOptions = {}) {
        this.schedule = options.schedule ?? browserIdle;
        this.concurrency = Math.max(1, options.concurrency ?? 4);
        this.debug = options.debug ?? (message => console.debug(message));
    }

    /**
     * Follows the client state from now on (the current state included);
     * returns the unsubscribe, which also cancels any run.
     */
    follow(slot: ClientStateSlot): () => void {
        const unsubscribe = slot.subscribe(next => this.onState(next));
        this.onState(slot.state);
        return () => {
            unsubscribe();
            this.cancel();
        };
    }

    /** Starts, resumes or cancels the run for `state`. */
    onState(state: ClientState): void {
        if (state.kind !== 'inSpace') {
            this.cancel();
            return;
        }
        const systemId = state.system.systemId;
        const run = this.current;
        if (run && run.systemId === systemId && !run.cancelled) {
            return;
        }
        if (run && run.systemId === systemId && run.done) {
            // Finished before it was paused: everything is warm.
            return;
        }
        this.cancel();
        this.current = this.start(systemId);
    }

    /** Stops the current run issuing anything new. */
    cancel(): void {
        if (this.current && !this.current.done) {
            this.current.cancelled = true;
        }
        // Waiters re-check their run when woken, and bow out.
        for (const wake of this.waiting.splice(0)) {
            wake();
        }
    }

    /** The current run's settlement (resolves; never rejects). */
    get idle(): Promise<void> {
        return this.current?.promise ?? Promise.resolve();
    }

    /** The system the current (or last) run warms. */
    get systemId(): string | undefined {
        return this.current?.systemId;
    }

    /** Whether the current run finished every item. */
    get done(): boolean {
        return this.current?.done ?? false;
    }

    private start(systemId: string): Run {
        const failures: unknown[] = [];
        const run: { -readonly [K in keyof Run]: Run[K] } = {
            systemId, cancelled: false, done: false,
            promise: Promise.resolve(),
        };
        run.promise = this.warm(run, failures).then(() => {
            if (!run.cancelled) {
                run.done = true;
            }
        }, e => {
            if (!(e instanceof Cancelled)) {
                failures.push(e);
            }
        }).then(() => {
            if (failures.length > 0) {
                this.debug(`Landed-UI prefetch for ${systemId}: `
                    + `${failures.length} item(s) failed (first: `
                    + `${String(failures[0])})`);
            }
        });
        return run;
    }

    /**
     * Runs `work` in a concurrency slot, started from an idle callback,
     * unless the run is cancelled first (then it throws Cancelled and
     * `work` never starts).
     */
    private async step<T>(run: Run, work: () => Promise<T>): Promise<T> {
        while (this.inFlight >= this.concurrency) {
            await new Promise<void>(resolve => this.waiting.push(resolve));
            if (run.cancelled) {
                throw new Cancelled();
            }
        }
        if (run.cancelled) {
            throw new Cancelled();
        }
        this.inFlight++;
        try {
            await new Promise<void>(resolve => this.schedule(resolve));
            if (run.cancelled) {
                throw new Cancelled();
            }
            return await work();
        } finally {
            this.inFlight--;
            this.waiting.shift()?.();
        }
    }

    /** Every item, each failure recorded rather than thrown. */
    private async each(run: Run, failures: unknown[],
        items: Iterable<() => Promise<unknown>>): Promise<void> {
        await Promise.all([...items].map(item =>
            this.step(run, item).catch(e => {
                if (e instanceof Cancelled) {
                    throw e;
                }
                failures.push(e);
            })));
    }

    private async warm(run: Run, failures: unknown[]): Promise<void> {
        const { data } = this.gameData;
        const ids = await this.gameData.ids;
        const system = await this.step(run,
            () => data.System.get(run.systemId));
        const planets = await this.step(run, () => Promise.all(
            system.planets.map(id => data.Planet.get(id).catch(e => {
                failures.push(e);
                return undefined;
            }))));
        const plan = planLandedUi(planets);
        if (plan.landable.length === 0) {
            return;
        }
        const knownPicts = new Set(ids.PictImage ?? []);
        const pict = (id: string) => () => this.assets.prefetchPict(id);
        const warmPicts = (picts: Iterable<string>) => this.each(run, failures,
            [...new Set(picts)].filter(id => knownPicts.has(id)).map(pict));

        // A part that fails is recorded and the rest carry on; only a
        // cancellation ends the run.
        const part = (work: Promise<unknown> | false) => work
            && work.catch(e => {
                if (e instanceof Cancelled) {
                    throw e;
                }
                failures.push(e);
            });
        await Promise.all([
            // The shared and per-stellar art first.
            warmPicts(plan.picts),
            this.each(run, failures, [...plan.stringTables].map(id =>
                () => this.assets.data.StringTable.get(id))),
            this.each(run, failures, [...plan.sounds].map(id =>
                () => this.assets.data.Sound.get(id))),
            // The venues' data, as their builds and first shows load it.
            part(plan.venues.outfitter && this.warmOutfitter(run, failures,
                plan, warmPicts)),
            part(plan.venues.shipyard && this.warmShipyard(run, failures,
                plan, warmPicts)),
            plan.venues.trade && this.each(run, failures, [
                () => Promise.all(ids.Junk.map(id => data.Junk.get(id))),
                () => Promise.all(ids.Oops.map(id => data.Oops.get(id))),
                ...ids.PlayerStart.slice(0, 1).map(id =>
                    () => data.PlayerStart.get(id)),
            ]),
            part(this.warmMissionPicts(run, failures, plan, warmPicts)),
        ]);
    }

    /**
     * The outfitter's build (Outfitter.makeOutfitsGrid): every govt and
     * outfit, then every weapon an outfit grants or feeds; and the item
     * art of the first pages the system's outfitters stock.
     */
    private async warmOutfitter(run: Run, failures: unknown[],
        plan: LandedUiPlan,
        warmPicts: (picts: Iterable<string>) => Promise<void>) {
        const { data } = this.gameData;
        const ids = await this.gameData.ids;
        const [, outfits] = await Promise.all([
            this.step(run, () => Promise.all(ids.Govt.map(id =>
                data.Govt.get(id).catch(e => { failures.push(e); })))),
            this.step(run, () => Promise.all(ids.Outfit.map(id =>
                data.Outfit.get(id).catch(e => {
                    failures.push(e);
                    return undefined;
                })))),
        ]);
        const loaded = outfits.filter((outfit): outfit is OutfitData =>
            outfit !== undefined);
        const weaponIds = new Set<string>();
        for (const outfit of loaded) {
            for (const weaponId of Object.keys(outfit.weapons)) {
                weaponIds.add(weaponId);
            }
            if (outfit.ammoFor) {
                weaponIds.add(outfit.ammoFor);
            }
        }
        // The ship classes an OnPurchase / OnSell can change the hull to
        // (stock oütf 314-318), which the outfitter warms the same way.
        const shipIds = new Set(ids.Ship);
        const changeTargets = changeShipTargets(loaded.flatMap(outfit =>
            [outfit.onPurchase, outfit.onSell].map(expression =>
                ({ expression, prefix: setStringPrefix(outfit) }))),
        id => shipIds.has(id));
        await Promise.all([
            this.step(run, () => Promise.all([
                ...[...weaponIds].map(id => data.Weapon.get(id)),
                ...changeTargets.map(id => data.Ship.get(id)),
            ].map(load => load.catch(e => { failures.push(e); })))),
            // The grid draws its first page as the outfitter builds,
            // before the stellar's stock filters it: every outfit, best
            // first, in load order (a stable sort, as makeOutfitsGrid's).
            warmPicts([...loaded]
                .sort((a, b) => b.displayWeight - a.displayWeight)
                .slice(0, ITEM_GRID_PAGE_SIZE)
                .map(outfit => outfit.pict)),
            warmPicts(plan.landable
                .filter(planet => planet.flags.hasOutfitter)
                .flatMap(planet => firstPagesOf(
                    loaded.filter(outfit =>
                        stellarStocks(outfit, stellarOf(planet))),
                    (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0))),
        ]);
    }

    /**
     * The shipyard's build (Shipyard.makeShipsGrid): every ship; and the
     * item art of the first pages the system's shipyards stock.
     */
    private async warmShipyard(run: Run, failures: unknown[],
        plan: LandedUiPlan,
        warmPicts: (picts: Iterable<string>) => Promise<void>) {
        const { data } = this.gameData;
        const ids = await this.gameData.ids;
        const ships = (await this.step(run, () => Promise.all(ids.Ship.map(id =>
            data.Ship.get(id).catch(e => {
                failures.push(e);
                return undefined;
            })))))
            .filter((ship): ship is ShipData => ship !== undefined);
        // As at the outfitter, the grid's first page is drawn as the
        // shipyard builds, possibly before its stellar is set.
        await warmPicts([...firstPagesOf(ships, (a, b) =>
            compareShipIds(a.id, b.id)).slice(0, ITEM_GRID_PAGE_SIZE),
        ...plan.landable
            .filter(planet => planet.flags.hasShipyard)
            .flatMap(planet => firstPagesOf(
                ships.filter(ship => meetsTechLevel(ship.techLevel, planet)),
                (a, b) => compareShipIds(a.id, b.id)))]);
    }

    /**
     * The offer / briefing / refusal pictures of every mission one of the
     * landable stellars can offer (by its AvailStel; the rest of the
     * availability — bits, records, the day's roll — is the player's and
     * changes, so it is not consulted). The mission universe is the one
     * the session already loads in the background.
     */
    private async warmMissionPicts(run: Run, failures: unknown[],
        plan: LandedUiPlan,
        warmPicts: (picts: Iterable<string>) => Promise<void>) {
        const universe = MissionUniverse.shared(this.gameData);
        await universe.load();
        if (run.cancelled) {
            throw new Cancelled();
        }
        const stellars = plan.landable.map(stellarInfoOf);
        const picts: string[] = [];
        for (const mission of universe.missions) {
            const missionPicts = [mission.offerPict, mission.briefPict,
                mission.refusePict].filter((id): id is string => !!id);
            if (missionPicts.length === 0) {
                continue;
            }
            const prefix = setStringPrefix(mission);
            try {
                if (stellars.some(stellar => matchesStellarRef(
                    mission.availStel, mission.availStelId, stellar, prefix,
                    id => universe.getGovt(id)))) {
                    picts.push(...missionPicts);
                }
            } catch (e) {
                failures.push(e);
            }
        }
        await warmPicts(picts);
    }
}
