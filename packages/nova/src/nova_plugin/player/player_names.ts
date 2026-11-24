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
 * original's names are Mac Pascal strings (Str31: a pilot file is named
 * after its pilot, and a Mac file name is at most 31 characters). GUESS
 * for the ship's name: the reference has not measured the prompt's own
 * limit yet, so it gets the same Str31 cap.
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
    if (typeof raw !== 'string') {
        return undefined;
    }
    const cleaned = raw.replace(STRIPPED, '').trim();
    const chars = Array.from(cleaned);
    const name = (chars.length > MAX_PLAYER_NAME_LENGTH
        ? chars.slice(0, MAX_PLAYER_NAME_LENGTH).join('') : cleaned).trim();
    return name === '' ? undefined : name;
}

/**
 * The ship name a pilot has before naming one: the hull's type name and
 * the pilot's stable ship number ("Heavy Shuttle 244" on the reference's
 * `p` screen, "Starbridge 525" in the sigma bar's greeting). Also the
 * shipyard prompt's prefill ("Kit Mass Roomy 300 989" for a Kit Mass
 * Roomy 300). GUESS: the number is the pilot profile's shipNumber, as the
 * title screen has always used; the reference has not measured where the
 * original's comes from.
 */
export function derivedShipName(shipType: string, shipNumber = 1): string {
    return sanitizePlayerName(`${shipType} ${shipNumber}`) ?? shipType;
}

/**
 * The player's ship's name: the stored one, else the derived one (for an
 * entity that has never been through player_start — specs, tooling).
 */
export function playerShipName(names: PlayerNames | undefined,
    shipType: string | undefined, shipNumber?: number): string | undefined {
    return sanitizePlayerName(names?.ship)
        ?? (shipType !== undefined
            ? derivedShipName(shipType, shipNumber) : undefined);
}

/** The pilot's name: the stored one, else `fallback` (cleaned too). */
export function playerPilotName(names: PlayerNames | undefined,
    fallback?: string): string | undefined {
    return sanitizePlayerName(names?.pilot) ?? sanitizePlayerName(fallback);
}
