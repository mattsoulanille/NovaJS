import type { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import type { MissionMachineryContext } from '../nova_plugin/missions/index.js';
import { statusQuoteLine } from './status_quote.js';

/**
 * ============================================================================
 * Qxxx / Txxx / Pxxx: the set operators whose effect needs DISPLAY data
 * ============================================================================
 *
 * The EVN Bible's
 *
 *   Pxxx  "play sound with ID xxx"
 *   Qxxx  "make the player immediately leave (absquatulate) whatever
 *         stellar he's landed on and return to space, and show a message
 *         at the bottom of the screen. The message is randomly selected
 *         from the STR# resource with ID xxx, and is parsed for mission
 *         text tags (e.g. <PSN> and <PRK>) ..."
 *   Txxx  "change the name (title) of the player's ship to a string
 *         randomly selected from STR# resource ID xxx"
 *
 * all name a resource the SIMULATION never loads (snd, STR#: display
 * assets), and a set string runs synchronously. So wherever one runs, it
 * only RECORDS the request here — the STR# / snd number and the plug-in
 * prefix it resolves against — and the caller resolves it once the string
 * is done: the in-flight records (ship_mission_accept.ts; a `Txxx`'s
 * picked name rides the record as `shipName`, the line and the sound are
 * the owning client's display), the jump's date advance (client/transit.ts),
 * the landing's transaction (the spaceport, after the dialog the string
 * ran under).
 *
 * Every number resolves stock-first, then under the running plug-in's own
 * prefix, like every sibling operator (statusQuoteLine).
 */
export interface StringPick {
    /** The STR# number as written. */
    stringId: number;
    /** The running expression's plug-in, for the bare number. */
    prefix: string;
}

export interface SetStringRequests {
    /** Every `Qxxx`, in the order they ran: one status-line message each. */
    statusQuotes: StringPick[];
    /** Every `Pxxx` (the snd number as written), in order. */
    sounds: { soundId: number, prefix: string }[];
    /** Every `Txxx`, in order; the last one names the ship. */
    shipNames: StringPick[];
}

export function emptySetStringRequests(): SetStringRequests {
    return { statusQuotes: [], sounds: [], shipNames: [] };
}

export function cloneSetStringRequests(requests: SetStringRequests):
    SetStringRequests {
    return {
        statusQuotes: requests.statusQuotes.map(pick => ({ ...pick })),
        sounds: requests.sounds.map(sound => ({ ...sound })),
        shipNames: requests.shipNames.map(pick => ({ ...pick })),
    };
}

/** Whether anything was asked at all. */
export function anySetStringRequests(requests: SetStringRequests): boolean {
    return requests.statusQuotes.length > 0 || requests.sounds.length > 0
        || requests.shipNames.length > 0;
}

/**
 * Wires `machinery`'s `Pxxx` and `Txxx` hooks (and, unless `quotes` is
 * false, its `Qxxx`) to record into `requests`. The landing's transaction
 * passes false: its Q is a departure (landed_departure.ts) and records
 * there.
 */
export function recordSetStringRequests(machinery: MissionMachineryContext,
    requests: SetStringRequests, options: { quotes?: boolean } = {}): void {
    if (options.quotes ?? true) {
        machinery.leaveStellar = (stringId, prefix) => {
            requests.statusQuotes.push({ stringId, prefix });
        };
    }
    machinery.playSound = (soundId, prefix) => {
        requests.sounds.push({ soundId, prefix });
    };
    machinery.renameShip = (stringId, prefix) => {
        requests.shipNames.push({ stringId, prefix });
    };
}

/**
 * The ship name a `Txxx` picks: a random line of its STR# (stock-first,
 * then the plug-in's), or undefined when neither table exists or has a
 * non-empty line. The LAST `Txxx` of `picks` names the ship (each would
 * rename it in turn; only the last name is seen). Picked on the owning
 * client and baked into whatever carries it, so the roll needs no shared
 * random.
 */
export async function pickShipName(displayAssets: DisplayAssetDataInterface,
    picks: readonly StringPick[], random: () => number = Math.random):
    Promise<string | undefined> {
    const last = picks[picks.length - 1];
    if (!last) {
        return undefined;
    }
    const line = await statusQuoteLine(displayAssets, last.stringId,
        last.prefix, random);
    const name = line?.trim();
    return name ? name : undefined;
}

/**
 * The global snd id a `Pxxx` plays: `nova:xxx` when stock has it, else the
 * running plug-in's own (arpia's P5000-P5002 are its own sounds). Loaded
 * on the way, so the one-shot that plays it finds it cached. Undefined
 * when neither exists.
 */
export async function resolveSetStringSound(
    displayAssets: DisplayAssetDataInterface,
    sound: { soundId: number, prefix: string }): Promise<string | undefined> {
    for (const id of [`nova:${sound.soundId}`,
        `${sound.prefix}:${sound.soundId}`]) {
        try {
            await displayAssets.data.Sound.get(id);
            return id;
        } catch {
            continue;
        }
    }
    return undefined;
}
