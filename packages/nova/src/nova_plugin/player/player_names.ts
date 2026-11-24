import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';

/**
 * The pilot's NAME and their ship's NAME, as player state.
 *
 * The original keeps both in the pilot file: the pilot's name (the "Pilot
 * Name:" row of the `p` General tab, the <PN> mission tag) and the name
 * the player gave their ship when they bought it ("Please name your new
 * <ship>:", the shipyard's Buy Ship prompt; the "Ship Name:" row, <PSN>).
 * Both live here, on the player's ship entity, so they ride the player's
 * insertion record and every peer reads the same names, follow the pilot
 * across a change of hull (missions/mission_ship_change.ts
 * PLAYER_STATE_COMPONENTS), and the ship's name is written into the save
 * (save_game.ts `shipName`). The pilot's name is the pilot profile's
 * (client_prefs.ts PilotProfile.name, which the pilot file already keeps):
 * client/player_start.ts copies it onto the entity at the start of every
 * session, as it does strict play.
 *
 * Both are player-typed strings and so UNTRUSTED: a save file, an imported
 * pilot or a peer's insertion record can carry anything. Every value is
 * passed through {@link sanitizePlayerName} where it is written AND where
 * it is read, and it is only ever drawn as plain text (PIXI.Text) and
 * substituted into mission text in a single pass (mission_text.ts), so a
 * name can neither carry markup nor expand as a wildcard.
 */
export const PlayerNamesType = t.partial({
    /** The pilot's name ("Matt"). */
    pilot: t.string,
    /** The ship's name ("Heavy Shuttle 244", or whatever the player typed). */
    ship: t.string,
});
export type PlayerNames = t.TypeOf<typeof PlayerNamesType>;
export const PlayerNamesComponent =
    new Component<PlayerNames>('PlayerNames');

/**
 * The longest name kept, in characters (Unicode code points). The
 * original's names are Mac Pascal strings (Str31): a pilot file is named
 * after its pilot, and a Mac file name is at most 31 characters; and the
 * ship name prompt's field takes 64 characters but the pilot file keeps
 * only the first 31 (docs/reference_experiments.md, "The shipyard's
 * \"Please name your new <ship>:\" prompt, wave 16", finding 5).
 */
export const MAX_PLAYER_NAME_LENGTH = 31;

/**
 * Characters a name never keeps: every C0 / C1 control (newlines, tabs,
 * escapes, DEL), the Unicode line and paragraph separators, the
 * bidirectional embeddings, overrides and isolates (which would let a
 * name reorder the text drawn after it), and the byte-order mark.
 */
// eslint-disable-next-line no-control-regex
const STRIPPED = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * A player-typed name made safe to keep and show: control and
 * text-direction characters removed, surrounding whitespace trimmed, cut
 * to {@link MAX_PLAYER_NAME_LENGTH} characters (never splitting a
 * surrogate pair). Undefined for anything that is not a string or is
 * empty once cleaned — the caller's fallback stands in for it.
 */
export function sanitizePlayerName(raw: unknown): string | undefined {
    const name = sanitizeShipName(raw);
    return name === '' ? undefined : name;
}

/**
 * A SHIP's name cleaned as {@link sanitizePlayerName} cleans any name,
 * except that an empty name is kept as one: the original accepts an
 * emptied prompt and the ship then has a blank name (the `p` screen shows
 * "Ship Name:" with nothing after it; wave 16, finding 3). Undefined only
 * for a value that is not a string — no name stored at all.
 */
export function sanitizeShipName(raw: unknown): string | undefined {
    if (typeof raw !== 'string') {
        return undefined;
    }
    const cleaned = raw.replace(STRIPPED, '').trim();
    const chars = Array.from(cleaned);
    return (chars.length > MAX_PLAYER_NAME_LENGTH
        ? chars.slice(0, MAX_PLAYER_NAME_LENGTH).join('') : cleaned).trim();
}

/**
 * The ship name a pilot has before naming one: the hull's type name and
 * the pilot's stable ship number ("Heavy Shuttle 244" on the reference's
 * `p` screen, "Starbridge 525" in the sigma bar's greeting), as the title
 * screen has always shown it. The shipyard prompt's prefill has the same
 * shape with a fresh random number instead (ship_name_prompt.ts).
 */
export function derivedShipName(shipType: string, shipNumber = 1): string {
    return sanitizePlayerName(`${shipType} ${shipNumber}`) ?? shipType;
}

/**
 * The player's ship's name: the stored one (blank when the player emptied
 * the prompt), else the derived one (for an entity that has never been
 * through player_start — specs, tooling).
 */
export function playerShipName(names: PlayerNames | undefined,
    shipType: string | undefined, shipNumber?: number): string | undefined {
    return sanitizeShipName(names?.ship)
        ?? (shipType !== undefined
            ? derivedShipName(shipType, shipNumber) : undefined);
}

/** The pilot's name: the stored one, else `fallback` (cleaned too). */
export function playerPilotName(names: PlayerNames | undefined,
    fallback?: string): string | undefined {
    return sanitizePlayerName(names?.pilot) ?? sanitizePlayerName(fallback);
}
