/**
 * The player-facing part of a resource name. Scenario authors append
 * "; developer note" annotations to many resource names — missions
 * ("Delivery to Earth; Vellos1"), ships, outfits, governments — that the
 * original game hides from players: everything from the first ';' onward,
 * plus any surrounding whitespace, is dropped for display.
 *
 * The full string is kept in the data layer (ids, lookups, save state);
 * this is applied only at DISPLAY sites (list rows, target box, tiles).
 */
export function displayName(name: string): string {
    const semicolon = name.indexOf(';');
    return (semicolon === -1 ? name : name.slice(0, semicolon)).trim();
}

/**
 * The government label the target box shows lower-right. The original
 * shows the gövt's short Target Code (gövt TMPL offset 68) — "Pyro" for
 * "Pyrogenesis Skymining", " Fed." for "Federation" — rather than the
 * overflow-prone full name. Both are run through displayName to trim the
 * code's leading padding and drop any "; note" author suffix; a govt with
 * an empty (or whitespace-only) target code falls back to its full name.
 */
export function govtTargetName(
    govt: { targetCode: string, name: string }): string {
    return displayName(govt.targetCode) || displayName(govt.name);
}
