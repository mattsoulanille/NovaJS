/**
 * Mission dësc "wildcard" expansion, per the EVN Bible: whenever a
 * mission description is shown, tags like <DST> are replaced with
 * pertinent mission information.
 *
 * The player-identity tags (<PN>, <PNN>, <PSN>, <PST>) take their real
 * values from spaceport/player_identity.ts (pilot profile + current
 * hull); the rank tags still fall back to placeholders until ranks
 * exist.
 */
import { displayName } from './display_name.js';
import { NCBTestContext } from './ncb.js';
import { resolveConditionalBlocks } from './desc_text.js';

export interface MissionTextSubstitutions {
    /** <DST> destination stellar name. */
    destinationStellar?: string;
    /** <DSY> destination system name. */
    destinationSystem?: string;
    /** <RST> return stellar name. */
    returnStellar?: string;
    /** <RSY> return system name. */
    returnSystem?: string;
    /** <CT> cargo type name. */
    cargoType?: string;
    /** <CQ> cargo quantity. */
    cargoQty?: number;
    /** <DL> mission deadline date, formatted. */
    deadline?: string;
    /** <PAY> absolute mission payment. */
    payment?: number;
    /** <PN> the player's name. */
    playerName?: string;
    /** <PNN> the player's nickname (falls back to the full name). */
    playerNickname?: string;
    /** <PSN> the player's ship's name. */
    playerShipName?: string;
    /** <PST> the player's ship type name. */
    playerShipType?: string;
    /**
     * <PRK> the ConvName of the highest-weight active ränk that has
     * one. Absent falls back to the Bible's "captain".
     */
    rankName?: string;
    /** <SRK> / <PSR> the same rank's ShortName. */
    rankShortName?: string;
    /**
     * <OSN> "The offering ship name (only works when offering a mission
     * from a ship)" (EVN Bible). The name of the përs whose LinkMission
     * is on the table — "Drifting Derelict", "Terrapin" — which is also
     * the name the target display shows in place of the ship class.
     *
     * The only wildcard that is meaningless anywhere but here: a mission
     * taken off a spaceport board has no offering ship. Every one of the
     * 26 stock hail quotes (STR# 7101) opens with it, and it is the one
     * that makes "<OSN>: I need assistance, can you help?" read as a
     * radio call from a named captain rather than from nobody.
     */
    offeringShipName?: string;
    /**
     * <SN> the mission's special ship name, drawn from the mïsn's
     * ShipNameID STR# list when the mission was ACCEPTED and frozen on
     * the ActiveMission (mission_logic.ts). Absent for a mission that
     * has not been accepted yet — the Bible's documented broken case:
     * "Nova will screw up if you use this in the initial mission
     * description, as it doesn't pick the special ship names until you
     * actually accept the mission." No stock mission puts <SN> in its
     * offer text; the ones that use it do so in BriefText/QuickBrief
     * and later dëscs, all of which see the accepted mission.
     */
    specialShipName?: string;
}

/**
 * The displayable part of a mïsn resource name: scenario authors
 * append "; comment" annotations (e.g. "Delivery to Earth; Vellos1")
 * that the game hides. Thin alias of the shared {@link displayName}
 * helper, kept for the mission-specific call sites.
 */
export function missionDisplayName(name: string): string {
    return displayName(name);
}

export function expandMissionText(text: string,
    subs: MissionTextSubstitutions,
    ctx?: NCBTestContext): string {
    // Bible order: resolve dësc conditional blocks first (against the real
    // player context), then expand mission wildcards. Conditionals and
    // wildcards are independent, but resolving conditionals first keeps their
    // quoted strings from confusing the wildcard pass and lets a chosen string
    // itself contain a wildcard.
    const conditional = ctx ? resolveConditionalBlocks(text, ctx) : text;
    const replacements: [string, string][] = [
        ['<DSY>', subs.destinationSystem ?? 'an unknown system'],
        ['<DST>', subs.destinationStellar ?? 'an unknown stellar'],
        ['<RSY>', subs.returnSystem ?? 'an unknown system'],
        ['<RST>', subs.returnStellar ?? 'an unknown stellar'],
        ['<CT>', subs.cargoType ?? 'cargo'],
        ['<CQ>', subs.cargoQty !== undefined ? String(subs.cargoQty) : 'some'],
        ['<DL>', subs.deadline ?? 'no deadline'],
        ['<PAY>', subs.payment !== undefined
            ? Math.abs(subs.payment).toLocaleString() : '0'],
        ['<REG>', 'NovaJS'],
        ['<PN>', subs.playerName ?? 'Captain'],
        // "If no nickname was specified, Nova will use the player's full
        // name here instead" (Bible <PNN>).
        ['<PNN>', subs.playerNickname ?? subs.playerName ?? 'Captain'],
        ['<PSN>', subs.playerShipName ?? 'your ship'],
        ['<PST>', subs.playerShipType ?? 'ship'],
        // "the active rank with the highest weight is selected for the
        // <PRK> and <PSR> mission briefing tags ... If there are no active
        // ranks or none of the active ranks have ConvNames, the <PRK> tag
        // will simply display 'captain'" (EVN Bible, ränk). <SRK> is the
        // Bible's ShortName tag; it also documents it as <PSR> in the same
        // paragraph, so both spellings expand here.
        ['<PRK>', subs.rankName ?? 'captain'],
        ['<SRK>', subs.rankShortName ?? 'captain'],
        ['<PSR>', subs.rankShortName ?? 'captain'],
        // The <SN> fallback is deliberately article-free ("the <SN>" is
        // how every stock mission phrases it, so "the unknown ship"
        // reads as English): an unaccepted mission has no name yet, and
        // the Bible's documented broken case should degrade to a
        // generic phrase rather than leave a raw "<SN>" on screen.
        // Only a ship-offered mission has an offering ship; anywhere
        // else the Bible says the tag "only works when offering a
        // mission from a ship", so it degrades to the same words the
        // comm dialog uses for a ship it cannot name.
        ['<OSN>', subs.offeringShipName ?? 'Unidentified ship'],
        ['<SN>', subs.specialShipName ?? 'unknown ship'],
    ];
    let expanded = conditional;
    for (const [tag, value] of replacements) {
        expanded = expanded.split(tag).join(value);
    }
    // Nova line-break convention: dëscs use \n literally already, but
    // also carriage returns from MacRoman text.
    return expanded.replace(/\r/g, '\n');
}
