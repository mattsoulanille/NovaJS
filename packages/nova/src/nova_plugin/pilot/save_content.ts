/**
 * Whether a save can be flown with the game data this server serves.
 *
 * A save names its ship and outfits by global id, and an id's prefix is
 * the plug-in that defines it (`nova:` for the stock data and for
 * plug-ins that override stock ids; otherwise the plug-in's name minus
 * its extension, novaparse's pluginPrefixFor). A save written while a plug-in was
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
    /**
     * Installed plug-ins that the id's prefix is probably an OLDER name
     * of, when there are any (absent otherwise). Builds before issue #310
     * keyed a plug-in by the text before the FIRST dot of its name, so a
     * save written then names "X 1.0"'s content as `X 1:…`; the plug-in is
     * still installed, it is just keyed "X 1.0" now. Nothing migrates
     * such a save (yet), but saying "not installed" would be wrong.
     */
    readonly renamedAs?: readonly string[];
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
    const renames = oldPluginNames([...ids.Ship, ...ids.Outfit]);
    const record = (kind: MissingSaveContent['kind'], id: string):
        MissingSaveContent => {
        const plugin = pluginOfId(id);
        const renamedAs = plugin === undefined ? undefined
            : renames.get(plugin);
        return renamedAs ? { kind, id, renamedAs } : { kind, id };
    };
    const missing: MissingSaveContent[] = [];
    if (!ships.has(save.ship)) {
        missing.push(record('ship', save.ship));
    }
    const seen = new Set<string>();
    for (const [id] of save.outfits) {
        if (!outfits.has(id) && !seen.has(id)) {
            seen.add(id);
            missing.push(record('outfit', id));
        }
    }
    return missing;
}

/**
 * The pre-#310 prefix of each installed plug-in whose prefix CHANGED
 * with #310 (one with a dot in it: the old rule cut at the first dot),
 * mapped to the installed prefixes it stood for, sorted. Derived from
 * the served ship and outfit ids, which are enough here: a save can only
 * be missing a plug-in's ship or outfit if that plug-in defines some.
 */
function oldPluginNames(ids: readonly string[]): Map<string, string[]> {
    const installed = new Set<string>();
    for (const id of ids) {
        const plugin = pluginOfId(id);
        if (plugin !== undefined && plugin.includes('.')) {
            installed.add(plugin);
        }
    }
    const renames = new Map<string, string[]>();
    for (const plugin of [...installed].sort()) {
        const old = plugin.slice(0, plugin.indexOf('.'));
        renames.set(old, [...(renames.get(old) ?? []), plugin]);
    }
    return renames;
}

/** Whether any of `missing` is a renamed (not uninstalled) plug-in's. */
export function namesRenamedPlugin(
    missing: readonly MissingSaveContent[]): boolean {
    return missing.some(m => (m.renamedAs?.length ?? 0) > 0);
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
 *
 * A plug-in that is installed under a NEW name (see
 * MissingSaveContent.renamedAs) is named as such rather than as missing.
 */
export function describeMissingSaveContent(
    missing: readonly MissingSaveContent[]): string {
    const byPlugin = new Map<string | undefined, string[]>();
    const renamedAs = new Map<string, readonly string[]>();
    for (const { kind, id, renamedAs: renamed } of missing) {
        const plugin = pluginOfId(id);
        let list = byPlugin.get(plugin);
        if (!list) {
            list = [];
            byPlugin.set(plugin, list);
        }
        list.push(`${kind} ${id}`);
        if (plugin !== undefined && renamed && renamed.length > 0) {
            renamedAs.set(plugin, renamed);
        }
    }
    const parts: string[] = [];
    for (const [plugin, items] of byPlugin) {
        const renamed = plugin === undefined ? undefined
            : renamedAs.get(plugin);
        parts.push(plugin === undefined
            ? `stock ids the game data does not define (${items.join(', ')})`
            : renamed
                ? `the plug-in "${plugin}" (${items.join(', ')}), which is `
                + `probably the installed ${renamed.map(r => `"${r}"`)
                    .join(' or ')} under the name older versions of the `
                + 'game gave it (they cut a plug-in\'s name at its first dot)'
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
