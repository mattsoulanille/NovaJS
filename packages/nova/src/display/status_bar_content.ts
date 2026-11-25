/**
 * Pure text-content logic for the status bar's readouts, kept free of PIXI and
 * ECS so the rules are unit-testable. The rendering systems resolve components
 * and game data, then hand plain values to these helpers.
 */
import type { GateKind, LandingBlockReason } from '../nova_plugin/travel/index.js';
import type { PlayerHailMessage } from '../nova_plugin/encounters/index.js';
import type { MissionCargoName } from '../nova_plugin/missions/index.js';

/** One line of the cargo manifest: an (abbreviated) name and a quantity. */
export interface CargoLine {
    name: string;
    quantity: number;
}

/** What the "Stellar Navigation" panel shows. */
export interface NavReadout {
    /** "Stellar Navigation" normally, "Hyperspace" while a jump route is set. */
    header: string;
    /** The destination/selection name, or "No Destination". */
    value: string;
    /** Whether the value is drawn in the dim text colour: the "No Destination"
     * placeholder, or a hyperspace destination the ship cannot yet jump to. */
    dim: boolean;
}

/**
 * What the readout names a hyperspace destination the pilot has never been
 * to. The star map draws those systems as an unlabeled dim dot and reads
 * "<Unknown>" throughout its properties column (discovery.ts), so naming
 * them here would hand the player, for free, exactly the knowledge the map
 * withholds — pick a dim neighbour, read its name off the status bar.
 *
 * The wording is Matthew's (2026-08-19): the original's status bar says
 * "Unexplored System". None of the sanctioned reference captures
 * (ui_screenshots/original_macos_screenshots/status_text.txt, statusbar/,
 * map/) show the string, so it is pinned by the spec rather than by a
 * screenshot.
 */
export const UNEXPLORED_SYSTEM = 'Unexplored System';

/**
 * The navigation readout: a set jump route shows "Hyperspace" + the next
 * system; otherwise a selected stellar shows "Stellar Navigation" + its name;
 * with neither, the dim "No Destination" placeholder (matching the original's
 * space/board_ship reference).
 *
 * `jumpReady` dims the HYPERSPACE destination until the ship can actually
 * jump to it — the answer of the shared readiness predicate
 * (nova_plugin/travel/jump_readiness.ts), the same one that gates the jump itself
 * and fires the nova:154 cue, so the readout brightens exactly when pressing
 * the key would work. It defaults to true so callers that cannot see the
 * ship's state (and the stellar/no-destination cases, where jump readiness is
 * irrelevant) keep their previous appearance.
 *
 * `destinationExplored` is the pilot's discovery level for that destination
 * (>= 1, discovery.ts); false replaces the NAME with
 * {@link UNEXPLORED_SYSTEM} and nothing else. The route is still set and
 * still jumpable, so the header stays "Hyperspace" and the dim rule stays
 * the jump-readiness one — the pilot is told where they are going in the
 * only terms they have earned. Defaults to true so callers with no
 * discovery record keep the pre-discovery appearance.
 *
 * The SELECTED STELLAR branch needs no such gate: a planet target is always
 * a stellar of the system the ship is flying in, which the pilot is standing
 * in and has therefore entered (level >= 1).
 */
export function navReadout(destinationSystem: string | null,
    selectedStellar: string | null, jumpReady = true,
    destinationExplored = true): NavReadout {
    if (destinationSystem) {
        return {
            header: 'Hyperspace',
            value: destinationExplored ? destinationSystem : UNEXPLORED_SYSTEM,
            dim: !jumpReady,
        };
    }
    if (selectedStellar) {
        return { header: 'Stellar Navigation', value: selectedStellar, dim: false };
    }
    return { header: 'Stellar Navigation', value: 'No Destination', dim: true };
}

/**
 * Formats a credit balance the way the original status bar does: comma-grouped
 * up to a million ("546,553"), then abbreviated to two decimals ("2.10M",
 * "1.34B") so large fortunes stay inside the narrow status column.
 */
export function formatCredits(credits: number): string {
    const n = Math.max(0, Math.floor(credits));
    if (n >= 1e9) {
        return `${(n / 1e9).toFixed(2)}B`;
    }
    if (n >= 1e6) {
        return `${(n / 1e6).toFixed(2)}M`;
    }
    return n.toLocaleString('en-US');
}

/**
 * The standard commodities abbreviate to fit the cargo column exactly as the
 * original status bar shows them ("Ind", "Med", "LuxG", "Met", "Equ"; the
 * reference's wave-15 readout "Ind / LuxG / Equ"). Other names fall back to
 * their first few characters. Jünk never comes here: it is named on the
 * "Special:" line by its own Abbrev field (status_bar_cargo.ts's
 * specialJunkName).
 */
const STANDARD_CARGO_ABBREV: Readonly<Record<string, string>> = {
    'Food': 'Food',
    'Industrial': 'Ind',
    'Medical Supplies': 'Med',
    'Luxury Goods': 'LuxG',
    'Metal': 'Met',
    'Equipment': 'Equ',
};

export function abbreviateCargoName(name: string): string {
    return STANDARD_CARGO_ABBREV[name] ?? (name.length > 5 ? name.slice(0, 4) : name);
}

/**
 * Summarizes the "Special:" line from the names that contribute to it
 * (status_bar_cargo.ts's cargoDisplayOf passes the missions' cargo names, or,
 * with no mission cargo aboard, the jünks'): nothing when there are none (the
 * label goes too: 390_medical_supplies.png's hold of plain commodities shows
 * only "Free:" and "Credits:"), the single name when there's exactly one
 * ("Raczak", "Probe", "Contraband"), and "Multiple" when there are several.
 * "Multiple" is stock STR# 2002 index 20, stored right after the readout's
 * own labels at 18 "Free:" and 19 "Special:". MEASURED: the count is per
 * MISSION, so two missions with the SAME cargo type read "Multiple"
 * (docs/reference_experiments.md, "Status bar "Special:" with two missions
 * of one cargo type, and #381 commodity rows, wave 15": two 3 t Military
 * Stores missions read "Special: Multiple", docked and in flight).
 */
export function specialCargoSummary(names: readonly string[]): string | null {
    if (names.length === 0) {
        return null;
    }
    if (names.length === 1) {
        return names[0];
    }
    return 'Multiple';
}

/** Index of a standard-commodity cargo key ("cargo:3" -> 3), or null. */
export function standardCargoIndex(key: string): number | null {
    const match = /^cargo:(\d+)$/.exec(key);
    return match ? Number(match[1]) : null;
}

const FULL_MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December',
];

/** The English ordinal for a day of the month: 1 -> "1st", 22 -> "22nd". */
export function ordinal(n: number): string {
    const tens = n % 100;
    if (tens >= 11 && tens <= 13) {
        return `${n}th`;
    }
    switch (n % 10) {
        case 1: return `${n}st`;
        case 2: return `${n}nd`;
        case 3: return `${n}rd`;
        default: return `${n}th`;
    }
}

/**
 * The long date the game shows in status messages, e.g.
 * "November 21st, 1177 NC" (the suffix is the scenario's dateSuffix).
 */
export function formatLongDate(date: { day: number, month: number, year: number },
    suffix = ''): string {
    const month = FULL_MONTH_NAMES[date.month - 1] ?? `Month ${date.month}`;
    return `${month} ${ordinal(date.day)}, ${date.year}${suffix}`;
}

/**
 * How the player came into the system, which picks the arrival line's lead:
 * a hyperspace jump (and every other entry: the session's start, a failed
 * transit's re-entry, a mission's Mxxx / Nxxx move), a hypergate, or a
 * wormhole.
 */
export type ArrivalRoute = 'hyperspace' | 'hypergate' | 'wormhole';

/**
 * The arrival line's leads, stock STR# 2002 0-based 43 / 45 / 46 (one-based
 * 44 / 46 / 47; 44 "Arriving in the" and 42 "Entering the" sit beside them,
 * unused here). The hypergate form is measured: "Exiting hypergate in the
 * Kit Gate N3 system on June 23rd, 1177 NC." (reference "Gate map, wave
 * 27"). The wormhole form is the data's own, not yet seen on the original.
 */
export const ARRIVAL_LEAD_INDEX: Readonly<Record<ArrivalRoute, number>> = {
    hyperspace: 43,
    hypergate: 45,
    wormhole: 46,
};
export const ARRIVAL_LEAD_TEXT: Readonly<Record<ArrivalRoute, string>> = {
    hyperspace: 'Jumping into the',
    hypergate: 'Exiting hypergate in the',
    wormhole: 'Passing through a wormhole into the',
};
/** The words between the system's name and the date (STR# 2002 0-based 47). */
export const ARRIVAL_SYSTEM_ON_INDEX = 47;
export const ARRIVAL_SYSTEM_ON_TEXT = 'system on';

/**
 * The bottom-left arrival line shown on entering a system: "Jumping into
 * the <system> system on <date>." after a jump, "Exiting hypergate in the
 * ..." after a hypergate, "Passing through a wormhole into the ..." after a
 * wormhole.
 */
export function jumpArrivalMessage(systemName: string,
    date: { day: number, month: number, year: number }, suffix = '',
    route: ArrivalRoute = 'hyperspace'): string {
    return `${ARRIVAL_LEAD_TEXT[route]} ${systemName} ${ARRIVAL_SYSTEM_ON_TEXT} `
        + `${formatLongDate(date, suffix)}.`;
}

/**
 * The original's on-screen feedback when a land attempt is rejected because
 * the ship is out of the landing window, e.g.
 * "You're too far away to land on this planet." — worded "land on this
 * planet" for a planet and "dock at this station" for a station (spöb flag
 * 0x10), matching stock Nova's strings verbatim.
 *
 * A gate has its own forms, chosen by its gate kind ahead of the planet /
 * station ones (stock STR# 2002 one-based 65 / 66 and 69 / 70, measured:
 * reference "Gate approach lines, wave 25"): "You're too far away to enter
 * this hypergate." / "... wormhole." and "You're moving too fast to enter
 * this hypergate." / "... wormhole.".
 */
export function landingBlockedMessage(
    reason: LandingBlockReason, isStation: boolean,
    stellarName?: string, gateKind?: GateKind): string {
    const place = gateKind === 'hypergate' ? 'enter this hypergate'
        : gateKind === 'wormhole' ? 'enter this wormhole'
            : isStation ? 'dock at this station' : 'land on this planet';
    switch (reason) {
        case 'unlandable':
            return unlandableMessage(isStation, stellarName, gateKind);
        case 'denied':
            return clearanceDeniedMessage(isStation, gateKind);
        case 'tooFar':
            return `You're too far away to ${place}.`;
        case 'tooFast':
            return `You're moving too fast to ${place}.`;
        default: {
            const unknownReason: never = reason;
            throw new Error(`Unknown landing block reason ${unknownReason}`);
        }
    }
}

/**
 * The original's refusal when traffic control WON'T CLEAR YOU — the stellar is
 * a working port, you were in the landing window, and they said no
 * (stellar_clearance.ts: MinStatus, or the gövt travel-permit Require test).
 *
 * Stock STR# 2002, verbatim and complete — the original explains nothing:
 *
 *   81 "Docking request denied."      82 "Landing request denied."
 *
 * The station form is chosen by spöb Flags 0x0010, exactly as the too-far /
 * too-fast lines above choose between "dock at this station" and "land on this
 * planet". Deliberately NOT worded with the reason: the original does not tell
 * you whether you are Forbidden (STR# 2002 index 172), Hostile (173), or just
 * short a travel permit, and the same one line covers all three.
 *
 * A working HYPERGATE that refuses the player has its own line, index 80
 * "Hypergate usage denied." (measured: `l` at HG-V01, reference "Stellar hail
 * graphic, wave 23"). Stock STR# 2002 has no wormhole counterpart (its gate
 * lines 64/65 and 68/69 pair hypergate with wormhole, 80 does not), so a
 * refusing wormhole keeps the planet/station line.
 */
export function clearanceDeniedMessage(isStation: boolean,
    gateKind?: GateKind): string {
    if (gateKind === 'hypergate') {
        return 'Hypergate usage denied.';
    }
    return isStation
        ? 'Docking request denied.' : 'Landing request denied.';
}

/**
 * The original's refusal when the stellar is not a port at all (spöb
 * Flags 0x0001 clear — see landable.ts). Assembled from stock STR# 2002
 * indices 83-89 verbatim, which is why the two gate forms name no
 * stellar while the planet/station forms do:
 *
 *   83 "Your ship is unable to"
 *   84 "enter this hypergate - it is offline."
 *   85 "enter this wormhole - the radiation levels are too extreme."
 *   86 "dock at "        87 "land on "
 *   88 "The station's hull integrity is too unstable."
 *   89 "The planet's environment is too hostile."
 *
 * The hypergate line is what a destroyed gate says. A stellar whose name
 * we somehow don't have falls back to the deictic "this station/planet"
 * so the sentence never reads "dock at ." .
 */
function unlandableMessage(isStation: boolean, stellarName?: string,
    gateKind?: GateKind): string {
    if (gateKind === 'hypergate') {
        return 'Your ship is unable to enter this hypergate - it is offline.';
    }
    if (gateKind === 'wormhole') {
        return 'Your ship is unable to enter this wormhole - the radiation '
            + 'levels are too extreme.';
    }
    const verb = isStation ? 'dock at' : 'land on';
    const name = stellarName
        || (isStation ? 'this station' : 'this planet');
    const cause = isStation
        ? "The station's hull integrity is too unstable."
        : "The planet's environment is too hostile.";
    return `Your ship is unable to ${verb} ${name}. ${cause}`;
}

/**
 * The line for a hulk whose one boarding has already been spent: the
 * original's catch-all boarding refusal, STR# 2002 ("misc strings") index
 * 129, quoted verbatim (Matthew's ruling — the original says this, not
 * index 125's "Target ship has been boarded.", which is the confirmation
 * shown when a boarding SUCCEEDS).
 */
export const ALREADY_BOARDED_MESSAGE = "You can't board this ship.";

/**
 * The stock line for a repelled capture attempt: STR# 2002 index 124,
 * verbatim. The player sees it on the status line rather than in the
 * dialog, because the one capture attempt a session gets ends that
 * session (boarding_plugin) and the dialog is already gone.
 */
export const CAPTURE_REPELLED_MESSAGE =
    'Your attempt to capture this ship was unsuccessful.';

/**
 * On-screen feedback when a board attempt is rejected. Mirrors
 * landingBlockedMessage: the boarding ship must have a DISABLED target
 * with crew, and must be close, matched in speed, and axis-aligned
 * (parallel or anti-parallel) with the hulk (boarding_component.ts) —
 * and the hulk's one plunder must not already have been spent.
 *
 * The 'tooFar' and 'tooFast' lines are the stock strings verbatim (STR#
 * 2002 indices 130 and 131); the rest have no stock equivalent, since the
 * original lumps every other refusal into index 129, "You can't board
 * this ship."
 *
 * 'notAligned' is the EMPTY string: the original answers a misaligned
 * press inside the range with nothing at all — it clears the status line
 * and prints no hint (docs/reference_experiments.md, "U9 wave 8", item 1;
 * ruling #378). Showing the empty line is what clears it.
 */
export function boardingBlockedMessage(reason:
    'noTarget' | 'notDisabled' | 'noCrew' | 'tooFar' | 'tooFast'
    | 'notAligned' | 'alreadyBoarded'): string {
    switch (reason) {
        case 'noTarget':
            return 'You have no ship targeted to board.';
        case 'notDisabled':
            return 'You can only board a disabled ship.';
        case 'noCrew':
            return 'There is no one left aboard to board.';
        case 'tooFar':
            return "You're not close enough to board this ship.";
        case 'tooFast':
            return "You're moving too fast to board this ship.";
        case 'notAligned':
            return '';
        case 'alreadyBoarded':
            return ALREADY_BOARDED_MESSAGE;
    }
}

/** The status line for a repelled capture (see CAPTURE_REPELLED_MESSAGE). */
export function captureRepelledMessage(): string {
    return CAPTURE_REPELLED_MESSAGE;
}

/**
 * The stock line for a booty take that tripped the hulk's security
 * self-destruct: STR# 2002 index 112, verbatim (reference "Disabled ships,
 * wave 24": the only line shown, the dialog gone, the hulk destroyed).
 */
export const PLUNDER_SELF_DESTRUCT_MESSAGE =
    "Oops! You tripped this ship's security self-destruct mechanism.";

/** The status line for a plunder self-destruct (see
 * PLUNDER_SELF_DESTRUCT_MESSAGE). */
export function plunderSelfDestructMessage(): string {
    return PLUNDER_SELF_DESTRUCT_MESSAGE;
}

/**
 * The status line when the hypergate map closes with Done and no pick: stock
 * STR# 2002 one-based 50, verbatim (measured: reference "Wave-24 leftovers,
 * wave 25", Kit Gate A1; the ship is left at rest at the gate, which plays
 * its closing animation).
 */
export const HYPERGATE_JUMP_CANCELLED_MESSAGE = 'Hypergate jump cancelled.';

/** How many forms {@link hypergateClearedMessage} has. */
export const HYPERGATE_CLEARED_FORMS = 3;

/**
 * Traffic control's answer to a hypergate's first `l` when it clears the
 * player: one of stock STR# 2002 one-based 91-93 (measured: reference "Gate
 * map, wave 27", #93 at Kit Gate N1; wave 24 saw #91 and #92 at Kit Gate A1
 * / C2, three runs, three forms, so the pick looks random):
 *
 *   91 "Cleared for hypergate entry, <ship>."
 *   92 "<ship>, you're cleared for hypergate entry."
 *   93 "You are cleared for hypergate entry."
 *
 * `form` is 0..2 for 91..93. <ship> is the player's ship's name; with none
 * (or a blank one) the nameless #93 stands in for the named forms.
 */
export function hypergateClearedMessage(form: number,
    shipName?: string): string {
    if (!shipName || form === 2) {
        return 'You are cleared for hypergate entry.';
    }
    return form === 0
        ? `Cleared for hypergate entry, ${shipName}.`
        : `${shipName}, you're cleared for hypergate entry.`;
}

/**
 * What the player is told when pirates board their disabled ship and take
 * a cut of their cash (gövt Flags 0x1000, "including the player").
 *
 * COMPOSED FROM STOCK VOCABULARY, the way the original composes its own
 * theft line. STR# 2002 has no whole sentence for this — it builds one out
 * of fragments, and the pieces sitting together at indices 372-373 are
 * "cargo" and "stolen!", i.e. "<what> stolen!". Matthew's ruling is that
 * pirates take CREDITS rather than cargo, so the same frame is filled with
 * the sum: "12,500 credits stolen!".
 */
export function playerPlunderedMessage(credits: number): string {
    return `${formatCredits(credits)} credits stolen!`;
}

/**
 * The status line after an AI 4 contraband scan (npc/contraband_scan.ts),
 * composed from stock STR# 2002's fragments exactly as the original
 * printed them on the reference (docs/reference_experiments.md, "S1 / I1
 * wave 11", "S1 and S2 wave 12" and "Contraband wave 14"):
 *
 *   "Kit Customs Cutter: w11-scan-pod, your posession of a kit contraband
 *    pod has been detected. You have been fined 500 credits."
 *   "Kit Customs Cutter: w12-s2b, your attempt to smuggle illegal cargo
 *    through this system has been detected. You have been fined 500
 *    credits."
 *   "Kit Customs Cutter: w14-junk, your attempt to smuggle kit contraband
 *    through this system has been detected. You have been fined 500
 *    credits." (illegal jünk: its LCName in place of "illegal cargo")
 *   "Kit Customs Cutter: w14-free, your posession of a kit contraband pod
 *    has been detected." (ScanFine 0, and -5: no fine sentence)
 *   "Your ship has been scanned - mission failed."
 *
 * The pieces are indices 374 "your posession of" (the stock misspelling,
 * kept), 375-377 "your attempt to smuggle" / "illegal cargo" / "through
 * this system" (a jünk's LCName replaces 376), 378 "has been detected",
 * 379 "You have been fined", 392 / 393 "a" / "an", and 285 for the
 * mission line. The fine is the govt's whole ScanFine with a thousands
 * separator ("500", "5,000": "A14 / contraband wave 16", `w16_bigfine`, a
 * 5000 fine on a pilot holding 1200 credits read "You have been fined
 * 5,000 credits." and took the 1200), never the amount taken.
 *
 * SEVERAL FINDS (measured, "A14 / contraband wave 15", `w15_several`: the
 * pod, 10 t of illegal jünk and a Flags 0x0020 mission's illegal cargo in
 * one scan): ONE line, naming the JÜNK ("your attempt to smuggle kit
 * contraband through this system ..."), not the pod; the 0x0020 mission
 * failed with no line of its own, so the detection line wins over the
 * mission line.
 *
 * GUESSES: a plain mission's illegal cargo is named over an outfit too
 * (the hold's cargo first: the jünk, then "illegal cargo", then the
 * outfit; only jünk over an outfit was measured); with no pilot name the
 * address is dropped ("<scanner>: your ...").
 */
export function contrabandScanMessage(scan: {
    scanner: string, pilot?: string, outfit?: string, junk?: string,
    smuggled: boolean, missionFailed: boolean, fine: number,
}): string {
    if (!scan.outfit && !scan.junk && !scan.smuggled) {
        return scan.missionFailed
            ? 'Your ship has been scanned - mission failed.' : '';
    }
    const what = scan.junk || scan.smuggled || !scan.outfit
        ? `your attempt to smuggle ${scan.junk ?? 'illegal cargo'} through this system`
        : `your posession of ${/^[aeiou]/i.test(scan.outfit) ? 'an' : 'a'} ${scan.outfit}`;
    const address = scan.pilot ? `${scan.pilot}, ` : '';
    const fined = scan.fine > 0
        ? ` You have been fined ${Math.floor(scan.fine).toLocaleString('en-US')} credits.`
        : '';
    return `${scan.scanner}: ${address}${what} has been detected.${fined}`;
}

/**
 * What the target pane's government line reads for a ship belonging to
 * the player looking at it.
 *
 * Stock data does carry "Hired Escort" (STR# 2002 index 165), but that
 * is the player-info roster wording; the target pane's line is the
 * narrow lower-right govt slot, so the short form is what fits.
 */
export const ESCORT_GOVT_LABEL = 'Escort';

/**
 * The government shown in the target pane, which reads "Escort" for the
 * LOCAL player's own escorts instead of their real government.
 *
 * This is a PER-PLAYER tag, and deliberately display-side only: the tag
 * depends on WHO IS LOOKING, so it can never live in simulation state.
 * `escortOf` is the targeted ship's PlayerEscortComponent.player (the
 * player ship uuid that owns it, durable across landings and jumps);
 * `localPlayerUuid` is the uuid of the ship this client controls. They
 * match only for your own escorts, so another peer targeting the same
 * ship still sees its real government.
 *
 * Nothing here consults DisabledComponent: a disabled escort re-enters
 * the normal target cycle (target_plugin), and it is still yours, so it
 * still reads "Escort".
 */
export function targetGovtLabel(government: string,
    escortOf: string | undefined,
    localPlayerUuid: string | undefined): string {
    if (escortOf !== undefined && localPlayerUuid !== undefined
        && escortOf === localPlayerUuid) {
        return ESCORT_GOVT_LABEL;
    }
    return government;
}

/**
 * Status-line feedback when the player boards one of their OWN disabled
 * flock members (a hired/captured escort or bay fighter): rather than
 * plundering it, the boarding party repairs it and it rejoins formation.
 * Stock STR# 2002 index 126, verbatim, which is what the original printed
 * for a repaired hired escort (reference "Reviving a disabled ally, wave
 * 11"). Index 127, "Fighter repaired.", is presumably the bay-fighter
 * line; it is not used, since EscortRepairedEvent does not say which kind
 * was repaired and the fighter case was not measured.
 */
export function escortRepairedMessage(): string {
    return 'Escort repaired.';
}

/**
 * The status line for a rescue board that took the mission cargo off the
 * ship (encounters/rescue_board.ts): "You retrieved Admiral Raczak from
 * this ship." on the original (reference "Boarding a rescue ship: stock
 * \"Rescue Raczak\" (nova:394), wave 13"), composed from stock STR#
 * 2002 indices 105 "You retrieved ", 106 "the" and 107 "from this
 * ship.". `cargo` is the mission cargo's name as missionCargoName
 * resolves it: the Bible's mission-cargo note says a name starting with
 * '*' is "quantityless" and "the word \"the\" is omitted in the message
 * that appears when the player retrieves that type of cargo from a
 * ship" — the '*' itself is never shown (STR# 4000 index 27 is
 * "*Admiral Raczak"). The name is the running-text (STR# 4001) one, as
 * <CT> uses: "the wild geese", not "the Wild Geese".
 */
export function cargoRetrievedMessage(
    cargo: Pick<MissionCargoName, 'lower' | 'quantityless'>): string {
    return `You retrieved ${cargo.quantityless ? '' : 'the '}`
        + `${cargo.lower} from this ship.`;
}

/**
 * What ANOTHER PLAYER's hail says on this player's status line (Matthew's
 * ruling on #332: "For now, buttons pressed should just send the message to
 * the bottom left info text area on that player's screen"), naming the
 * sender's ship. The wording is composed HERE, on the receiving client, from
 * the button the record names (hail_plugin's PlayerHailMessage) — never from
 * text another client chose. NovaJS's own wording: the original is
 * single-player and has no such line.
 */
export function playerHailMessage(senderShipName: string | undefined,
    message: PlayerHailMessage): string {
    const who = senderShipName && senderShipName.trim() !== ''
        ? `The ${senderShipName}` : 'Another pilot';
    switch (message) {
        case 'greetings':
            return `${who} hails you: "Greetings."`;
        case 'assistance':
            return `${who} hails you, requesting assistance.`;
        case 'mercy':
            return `${who} hails you, begging for mercy.`;
    }
}

/**
 * Status-line feedback for the bay-capture shortcut: a disabled ship that
 * fits one of your bays is captured outright, with no plunder dialog and
 * no boarding contest, so this line is the ONLY notice the player gets.
 * The ship class name comes from game data; it falls back to a generic
 * wording when the name is not (yet) cached.
 */
export function bayCaptureMessage(shipName: string | undefined): string {
    return shipName
        ? `Captured the ${shipName} into your fighter bay.`
        : 'Captured the ship into your fighter bay.';
}
