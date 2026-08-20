/**
 * Pure text-content logic for the status bar's readouts, kept free of PIXI and
 * ECS so the rules are unit-testable. The rendering systems resolve components
 * and game data, then hand plain values to these helpers.
 */

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
 * (nova_plugin/jump_readiness.ts), the same one that gates the jump itself
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
 * original status bar shows them ("Ind", "Med", "LuxG", "Met", "Equ"). Junk
 * and other names fall back to their first few characters.
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
 * Summarizes the "Special:" mission-cargo line: nothing when the player carries
 * no mission cargo, the single cargo's name when there's exactly one, and
 * "Multiple" when several missions contribute cargo (as the original shows).
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

/** The bottom-left "Jumping into ..." message shown on entering a system. */
export function jumpArrivalMessage(systemName: string,
    date: { day: number, month: number, year: number }, suffix = ''): string {
    return `Jumping into the ${systemName} system on ${formatLongDate(date, suffix)}.`;
}

/**
 * The original's on-screen feedback when a land attempt is rejected because
 * the ship is out of the landing window, e.g.
 * "You're too far away to land on this planet." — worded "land on this
 * planet" for a planet and "dock at this station" for a station (spöb flag
 * 0x10), matching stock Nova's strings verbatim.
 */
export function landingBlockedMessage(
    reason: 'tooFar' | 'tooFast' | 'unlandable' | 'denied', isStation: boolean,
    stellarName?: string, gateKind?: 'hypergate' | 'wormhole'): string {
    if (reason === 'unlandable') {
        return unlandableMessage(isStation, stellarName, gateKind);
    }
    if (reason === 'denied') {
        return clearanceDeniedMessage(isStation);
    }
    const place = isStation ? 'dock at this station' : 'land on this planet';
    const cause = reason === 'tooFar'
        ? "You're too far away to" : "You're moving too fast to";
    return `${cause} ${place}.`;
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
 */
export function clearanceDeniedMessage(isStation: boolean): string {
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
    gateKind?: 'hypergate' | 'wormhole'): string {
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
            return 'Line up alongside the ship before boarding.';
        case 'alreadyBoarded':
            return ALREADY_BOARDED_MESSAGE;
    }
}

/** The status line for a repelled capture (see CAPTURE_REPELLED_MESSAGE). */
export function captureRepelledMessage(): string {
    return CAPTURE_REPELLED_MESSAGE;
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
 */
export function escortRepairedMessage(): string {
    return 'Your ship has been repaired and rejoins your formation.';
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
