/**
 * Whether a save can be flown with the game data this server serves.
 *
 * A save names its ship and outfits by global id, and an id's prefix is
 * the plug-in that defines it (`nova:` for the stock data and for
 * plug-ins that override stock ids; otherwise the plug-in file's name,
 * novaparse's pluginPrefixFor). A save written while a plug-in was
 * installed keeps naming that plug-in's content after it is removed, and
 * the game data aggregator rejects an id no source defines (#47).
 *
 * Before this check, a save whose SHIP was missing did not fail at all:
 * the player start silently substituted the chär's starting ship, the
 * restored credits/missions/records went onto that hull, and the first
 * save trigger wrote the substitute back over the pilot's own ship. The
 * save is instead refused before anything is restored
 * (client/player_start.ts), with a {@link MissingSaveContentError} the
 * title flow turns into a pilot quarantine (title/pilot_quarantine.ts).
 * The save itself is never touched: reinstalling the plug-in makes it
 * loadable again, exactly as it was.
 *
 * Client-only bookkeeping; never runs in the simulation.
 */
import type { SaveData } from './save_game.js';

/** One piece of a save that the installed game data does not define. */
export interface MissingSaveContent {
    readonly kind: 'ship' | 'outfit';
    /** The global id the save names, e.g. `missing-plugin:128`. */
    readonly id: string;
}

/** Existence lookups over the served id lists (NovaIDs). */
export interface SaveContentIds {
    readonly Ship: readonly string[];
    readonly Outfit: readonly string[];
}

/**
 * The ship and outfits `save` names that `ids` does not define, ship
 * first, outfits in save order, each id once.
 */
export function missingSaveContent(save: SaveData, ids: SaveContentIds):
    MissingSaveContent[] {
    const ships = new Set(ids.Ship);
    const outfits = new Set(ids.Outfit);
    const missing: MissingSaveContent[] = [];
    if (!ships.has(save.ship)) {
        missing.push({ kind: 'ship', id: save.ship });
    }
    const seen = new Set<string>();
    for (const [id] of save.outfits) {
        if (!outfits.has(id) && !seen.has(id)) {
            seen.add(id);
            missing.push({ kind: 'outfit', id });
        }
    }
    return missing;
}

/**
 * The plug-in a global id belongs to, or undefined for a stock (`nova:`)
 * id or one with no prefix at all: those are not "a missing plug-in",
 * just content this data set does not have.
 */
export function pluginOfId(id: string): string | undefined {
    const colon = id.indexOf(':');
    if (colon <= 0) {
        return undefined;
    }
    const prefix = id.slice(0, colon);
    return prefix === 'nova' ? undefined : prefix;
}

/**
 * A one-paragraph explanation naming every missing plug-in and id,
 * grouped by plug-in, e.g.
 *
 *   needs content that is not installed: the plug-in "missing-plugin"
 *   (ship missing-plugin:128)
 */
export function describeMissingSaveContent(
    missing: readonly MissingSaveContent[]): string {
    const byPlugin = new Map<string | undefined, string[]>();
    for (const { kind, id } of missing) {
        const plugin = pluginOfId(id);
        let list = byPlugin.get(plugin);
        if (!list) {
            list = [];
            byPlugin.set(plugin, list);
        }
        list.push(`${kind} ${id}`);
    }
    const parts: string[] = [];
    for (const [plugin, items] of byPlugin) {
        parts.push(plugin === undefined
            ? `stock ids the game data does not define (${items.join(', ')})`
            : `the plug-in "${plugin}" (${items.join(', ')})`);
    }
    return `needs content that is not installed: ${parts.join('; ')}`;
}

/**
 * The save names content the installed game data does not define. Thrown
 * by the player start BEFORE any of the save is applied; recognised by
 * name as well as class, like NovaIDNotFoundError.
 */
export class MissingSaveContentError extends Error {
    constructor(readonly missing: readonly MissingSaveContent[]) {
        super(`This saved game ${describeMissingSaveContent(missing)}.`);
        this.name = 'MissingSaveContentError';
    }

    /** The plug-in prefixes involved (stock-prefixed ids excluded). */
    get plugins(): string[] {
        const plugins = new Set<string>();
        for (const { id } of this.missing) {
            const plugin = pluginOfId(id);
            if (plugin !== undefined) {
                plugins.add(plugin);
            }
        }
        return [...plugins];
    }
}

export function isMissingSaveContentError(e: unknown):
    e is MissingSaveContentError {
    return e instanceof MissingSaveContentError
        || (e instanceof Error && e.name === 'MissingSaveContentError'
            && Array.isArray((e as Partial<MissingSaveContentError>).missing));
}

/** Throws {@link MissingSaveContentError} when `save` names missing content. */
export function assertSaveContentInstalled(save: SaveData,
    ids: SaveContentIds): void {
    const missing = missingSaveContent(save, ids);
    if (missing.length > 0) {
        throw new MissingSaveContentError(missing);
    }
}
