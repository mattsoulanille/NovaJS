import { CronData } from 'novadatainterface/cron_data';
import { MissionData } from 'novadatainterface/mission_data';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { resolveNumberedResource, setStringPrefix } from '../nova_plugin/missions/index.js';
import { NCBParseError, NCBSetOperation, parseNCBSet } from '../nova_plugin/ncb/index.js';
import { MissionUniverse, pooledMap } from './mission_universe.js';

/**
 * ============================================================================
 * Warming what a `Cxxx` / `Exxx` / `Hxxx` reads, before a set string runs
 * ============================================================================
 *
 * A set string runs SYNCHRONOUSLY, and a change of ship reads the new
 * class's ShipData and — for the 0x0020 persistence an `Hxxx` keeps, and
 * the hold the new hull offers — the oütf of everything the pilot owns by
 * then (a Gxxx earlier in the same string can make that any outfit). So
 * whoever wires the change-ship hook warms those first: the landing's
 * transaction as it opens (landed_transaction.ts), the in-flight accept and
 * refusal (ship_mission_accept.ts), the date advance's crons and in-flight
 * mission upkeep (mission_session.ts advanceEntityDate).
 *
 * The targets are every class any mïsn or crön set string could change
 * the player to, each number resolved stock-first under its own writer's
 * prefix ({@link changeShipTargets}). A failed warm-up still wires
 * the hook; the change then says what it is missing when it runs.
 */

/** The mïsn set strings, every one of which may carry a change of ship. */
const MISSION_SET_STRINGS = [
    'onAccept', 'onRefuse', 'onSuccess', 'onFailure', 'onAbort', 'onShipDone',
] as const;

/** The crön set strings. */
const CRON_SET_STRINGS = ['onStart', 'onEnd'] as const;

/**
 * {@link setStringChangeShipTargets}' answers, per loaded mission list (a
 * universe that reloads builds a new one), so a landing does not re-parse
 * every set string in the game.
 */
const targetsCache = new WeakMap<readonly MissionData[], string[]>();

/**
 * Every shïp class a mïsn or crön set string could change the player's
 * ship to, each resolved under that resource's own writer prefix.
 */
export function setStringChangeShipTargets(missions: readonly MissionData[],
    crons: readonly CronData[],
    shipExists: (globalId: string) => boolean): string[] {
    let targets = targetsCache.get(missions);
    if (!targets) {
        targets = changeShipTargets([
            ...missions.flatMap(mission =>
                MISSION_SET_STRINGS.map(field => ({
                    expression: mission[field],
                    prefix: setStringPrefix(mission),
                }))),
            ...crons.flatMap(cron =>
                CRON_SET_STRINGS.map(field => ({
                    expression: cron[field],
                    prefix: setStringPrefix(cron),
                }))),
        ], shipExists);
        targetsCache.set(missions, targets);
    }
    return targets;
}

/**
 * Loads every class a set string could change the player to and — when
 * there is any — every outfit, and returns the shïp id set the change-ship
 * operators resolve their bare numbers through (stock-first). Never
 * rejects: a failure is logged, and the hook it feeds then reports what is
 * missing when it runs.
 */
export async function warmChangeShipTargets(
    gameData: SimulationGameDataInterface,
    universe: MissionUniverse): Promise<Set<string>> {
    let shipIds = new Set<string>();
    try {
        await universe.load();
        const ids = await gameData.ids;
        shipIds = new Set(ids.Ship);
        const targets = setStringChangeShipTargets(universe.missions,
            universe.crons, id => shipIds.has(id));
        if (targets.length > 0) {
            const data = gameData.data;
            await Promise.all([
                ...targets.map(id => data.Ship.get(id)
                    .catch(() => undefined)),
                pooledMap(ids.Outfit, id => data.Outfit.get(id)
                    .catch(() => undefined)),
            ]);
        }
    } catch (e) {
        console.warn('Change-ship data failed to load:', e);
    }
    return shipIds;
}

/**
 * Every shïp global id one of `sources`' set strings could change the
 * player's ship to (`Cxxx` / `Exxx` / `Hxxx`, inside `R(...)` choices too),
 * each number resolved stock-first under its own writer's prefix. A set
 * string runs synchronously, so whoever can run one warms these first (the
 * outfitter for its OnPurchase / OnSell, the landed transaction for every
 * mïsn). An unparseable string is skipped here and warned about when it
 * runs.
 */
export function changeShipTargets(
    sources: Iterable<{ expression: string, prefix: string }>,
    shipExists: (globalId: string) => boolean): string[] {
    const targets = new Set<string>();
    const collect = (operations: NCBSetOperation[], prefix: string) => {
        for (const operation of operations) {
            if (operation.type === 'changeShip') {
                targets.add(resolveNumberedResource(
                    operation.id, prefix, shipExists));
            } else if (operation.type === 'random') {
                collect(operation.choices, prefix);
            }
        }
    };
    for (const { expression, prefix } of sources) {
        if (!expression) {
            continue;
        }
        try {
            collect(parseNCBSet(expression), prefix);
        } catch (error) {
            if (!(error instanceof NCBParseError)) {
                throw error;
            }
        }
    }
    return [...targets].sort();
}

/*
 * SEAMS left deliberately open.
 *
 * - TECH LEVEL. The shipyard still stocks every ship in the game. Ships
 *   carry the same TechLevel / SpecialTech structure as outfits, so
 *   outfitter_rules.ts meetsTechLevel(ship.techLevel, stellarOf(planet))
 *   is the intended hook; wiring it needs the docked PlanetData plumbed
 *   into the Shipyard menu, which is a separate change from the
 *   economy.
 * - STOCK-OUTFIT DOUBLE COUNTING (judgment call 3). If the trade-in
 *   proves too generous in play, subtract the current hull's
 *   ShipData.outfits from the valued set in tradeInValue.
 * - CONFIRMATION DIALOG. The original asks the player to confirm the
 *   trade before charging. There is no reference screenshot of it in
 *   ui_screenshots/original_macos_screenshots/shipyard, so the Buy
 *   button commits directly and simply greys out when unaffordable.
 */
