import 'jasmine';
import { TARGET_FLASH_MS, targetFlashOn } from './status_bar.js';
import {
    formatCredits, navReadout, abbreviateCargoName, specialCargoSummary,
    standardCargoIndex, ordinal, formatLongDate, jumpArrivalMessage,
    landingBlockedMessage, bayCaptureMessage, targetGovtLabel,
    clearanceDeniedMessage, ESCORT_GOVT_LABEL, UNEXPLORED_SYSTEM,
} from './status_bar_content.js';

describe('formatCredits', () => {
    it('comma-groups values under a million', () => {
        expect(formatCredits(546553)).toBe('546,553');
        expect(formatCredits(0)).toBe('0');
        expect(formatCredits(999999)).toBe('999,999');
    });
    it('abbreviates millions and billions to two decimals', () => {
        expect(formatCredits(1810000)).toBe('1.81M');
        expect(formatCredits(2100000)).toBe('2.10M');
        expect(formatCredits(3230000)).toBe('3.23M');
        expect(formatCredits(1_340_000_000)).toBe('1.34B');
    });
    it('never shows negative balances', () => {
        expect(formatCredits(-5)).toBe('0');
    });
});

describe('navReadout', () => {
    it('shows the hyperspace destination when a route is set', () => {
        expect(navReadout('Sanddown', 'Earth'))
            .toEqual({ header: 'Hyperspace', value: 'Sanddown', dim: false });
    });
    it('shows the selected stellar when there is no route', () => {
        expect(navReadout(null, 'Europa'))
            .toEqual({ header: 'Stellar Navigation', value: 'Europa', dim: false });
    });
    it('shows the dim placeholder when nothing is selected', () => {
        expect(navReadout(null, null))
            .toEqual({ header: 'Stellar Navigation', value: 'No Destination', dim: true });
    });
    it('dims the hyperspace destination until the ship can jump', () => {
        expect(navReadout('Sanddown', null, false))
            .toEqual({ header: 'Hyperspace', value: 'Sanddown', dim: true });
        expect(navReadout('Sanddown', null, true))
            .toEqual({ header: 'Hyperspace', value: 'Sanddown', dim: false });
    });
    it('leaves a stellar selection bright regardless of jump readiness', () => {
        // Jump readiness has nothing to do with a selected stellar.
        expect(navReadout(null, 'Europa', false))
            .toEqual({ header: 'Stellar Navigation', value: 'Europa', dim: false });
    });
    it('keeps the "No Destination" placeholder dim either way', () => {
        expect(navReadout(null, null, true).dim).toBeTrue();
        expect(navReadout(null, null, false).dim).toBeTrue();
    });

    // A system the pilot has never entered is an unlabeled dim dot on the
    // star map; the status bar must not hand out its name.
    it('withholds an unexplored destination\'s name', () => {
        expect(navReadout('Sanddown', null, true, false))
            .toEqual({
                header: 'Hyperspace', value: 'Unexplored System', dim: false,
            });
    });
    it('spells the placeholder "Unexplored System"', () => {
        // Matthew, 2026-08-19: the original's exact wording. Pinned here
        // because no sanctioned reference capture shows the string.
        expect(UNEXPLORED_SYSTEM).toBe('Unexplored System');
    });
    it('still dims an unexplored destination until the ship can jump', () => {
        expect(navReadout('Sanddown', null, false, false))
            .toEqual({
                header: 'Hyperspace', value: 'Unexplored System', dim: true,
            });
    });
    it('never applies the gate to a selected stellar', () => {
        // A planet target is always in the system the ship is flying in.
        expect(navReadout(null, 'Europa', true, false))
            .toEqual({
                header: 'Stellar Navigation', value: 'Europa', dim: false,
            });
    });
    it('defaults to naming the destination when no record is supplied', () => {
        expect(navReadout('Sanddown', null).value).toBe('Sanddown');
    });
});

describe('cargo helpers', () => {
    it('abbreviates the standard commodities as the original does', () => {
        expect(abbreviateCargoName('Food')).toBe('Food');
        expect(abbreviateCargoName('Industrial')).toBe('Ind');
        expect(abbreviateCargoName('Medical Supplies')).toBe('Med');
        expect(abbreviateCargoName('Luxury Goods')).toBe('LuxG');
        expect(abbreviateCargoName('Metal')).toBe('Met');
        expect(abbreviateCargoName('Equipment')).toBe('Equ');
    });
    it('summarizes special cargo', () => {
        expect(specialCargoSummary([])).toBeNull();
        expect(specialCargoSummary(['Probe'])).toBe('Probe');
        expect(specialCargoSummary(['Probe', 'Files'])).toBe('Multiple');
    });
    it('parses standard cargo keys', () => {
        expect(standardCargoIndex('cargo:3')).toBe(3);
        expect(standardCargoIndex('junk:nova:128')).toBeNull();
        expect(standardCargoIndex('mission:5')).toBeNull();
    });
});

describe('date formatting', () => {
    it('produces English ordinals', () => {
        expect(ordinal(1)).toBe('1st');
        expect(ordinal(2)).toBe('2nd');
        expect(ordinal(3)).toBe('3rd');
        expect(ordinal(11)).toBe('11th');
        expect(ordinal(21)).toBe('21st');
        expect(ordinal(22)).toBe('22nd');
    });
    it('formats the long date with a suffix', () => {
        expect(formatLongDate({ day: 21, month: 11, year: 1177 }, ' NC'))
            .toBe('November 21st, 1177 NC');
    });
    it('composes the arrival message', () => {
        expect(jumpArrivalMessage('Sanddown',
            { day: 21, month: 11, year: 1177 }, ' NC'))
            .toBe('Jumping into the Sanddown system on November 21st, 1177 NC.');
    });
});

describe('landingBlockedMessage', () => {
    it('matches the original planet strings', () => {
        expect(landingBlockedMessage('tooFar', false))
            .toBe("You're too far away to land on this planet.");
        expect(landingBlockedMessage('tooFast', false))
            .toBe("You're moving too fast to land on this planet.");
    });
    it('says "dock at this station" for stations', () => {
        expect(landingBlockedMessage('tooFar', true))
            .toBe("You're too far away to dock at this station.");
        expect(landingBlockedMessage('tooFast', true))
            .toBe("You're moving too fast to dock at this station.");
    });
    // The unlandable refusals, assembled from stock STR# 2002 83-89.
    it('names the planet it cannot land on', () => {
        expect(landingBlockedMessage('unlandable', false, 'Jupiter'))
            .toBe('Your ship is unable to land on Jupiter. '
                + "The planet's environment is too hostile.");
    });
    it('names the station it cannot dock at', () => {
        expect(landingBlockedMessage('unlandable', true, "Kel'a He"))
            .toBe("Your ship is unable to dock at Kel'a He. "
                + "The station's hull integrity is too unstable.");
    });
    it('reports a destroyed hypergate as offline, naming no stellar', () => {
        expect(landingBlockedMessage('unlandable', true, 'HG-Vega',
            'hypergate'))
            .toBe('Your ship is unable to enter this hypergate - '
                + 'it is offline.');
    });
    it('reports an unusable wormhole as too radioactive', () => {
        expect(landingBlockedMessage('unlandable', false, 'Wormhole',
            'wormhole'))
            .toBe('Your ship is unable to enter this wormhole - the '
                + 'radiation levels are too extreme.');
    });
    it('falls back to the deictic form with no stellar name', () => {
        expect(landingBlockedMessage('unlandable', false))
            .toBe('Your ship is unable to land on this planet. '
                + "The planet's environment is too hostile.");
    });
    // Clearance refusals: stock STR# 2002 indices 81 and 82, verbatim and
    // complete — the original explains nothing about WHY.
    it('refuses clearance in the original\'s own words', () => {
        expect(landingBlockedMessage('denied', false))
            .toBe('Landing request denied.');
        expect(landingBlockedMessage('denied', true))
            .toBe('Docking request denied.');
        expect(clearanceDeniedMessage(false)).toBe('Landing request denied.');
        expect(clearanceDeniedMessage(true)).toBe('Docking request denied.');
    });
    it('names no stellar and gives no reason when clearance is refused', () => {
        // A Forbidden port and a Hostile one get the SAME line.
        expect(landingBlockedMessage('denied', false, 'Earth'))
            .toBe('Landing request denied.');
    });
});

describe('bayCaptureMessage', () => {
    it('names the captured ship class', () => {
        expect(bayCaptureMessage('Viper'))
            .toBe('Captured the Viper into your fighter bay.');
    });
    it('falls back when the ship name is not available', () => {
        // The bay capture opens no dialog, so this line is the player's
        // only notice: it must still say something with a cold cache.
        expect(bayCaptureMessage(undefined))
            .toBe('Captured the ship into your fighter bay.');
    });
});

/**
 * Matthew's item 4: the target pane's government line reads "Escort" for
 * the local player's own escorts. A PER-PLAYER tag, so it is decided
 * display-side from who is looking, never stored in the simulation.
 */
describe('targetGovtLabel', () => {
    const ME = 'my-ship';
    const PEER = 'their-ship';

    it('shows the real government for an ordinary ship', () => {
        expect(targetGovtLabel('Fed.', undefined, ME)).toBe('Fed.');
    });

    it('shows "Escort" for a ship escorting the local player', () => {
        expect(targetGovtLabel('Fed.', ME, ME)).toBe(ESCORT_GOVT_LABEL);
        expect(ESCORT_GOVT_LABEL).toBe('Escort');
    });

    it("shows the real government for ANOTHER player's escort", () => {
        // The per-player half: a peer targeting my escort still sees the
        // government, because the tag depends on who is looking.
        expect(targetGovtLabel('Pyro', PEER, ME)).toBe('Pyro');
    });

    it('still says "Escort" for a DISABLED escort', () => {
        // Nothing here consults DisabledComponent: a disabled escort
        // rejoins the normal target cycle, so this case comes up often,
        // and the ship is still yours.
        expect(targetGovtLabel('Fed.', ME, ME)).toBe(ESCORT_GOVT_LABEL);
    });

    it('falls through when the local player uuid is unknown', () => {
        // Docked or mid-jump: no local ship to compare against.
        expect(targetGovtLabel('Fed.', ME, undefined)).toBe('Fed.');
    });

    it('keeps an empty government empty for a non-escort', () => {
        // The govt data has not cached yet; the pane hides the line.
        expect(targetGovtLabel('', undefined, ME)).toBe('');
    });

    it('tags an escort even before its government data caches', () => {
        expect(targetGovtLabel('', ME, ME)).toBe(ESCORT_GOVT_LABEL);
    });
});

describe('targetFlashOn (selected target flashes white on the radar)', () => {
    it('is on for the first half of each period and off for the second', () => {
        expect(targetFlashOn(0)).toBeTrue();
        expect(targetFlashOn(TARGET_FLASH_MS / 2 - 1)).toBeTrue();
        expect(targetFlashOn(TARGET_FLASH_MS / 2)).toBeFalse();
        expect(targetFlashOn(TARGET_FLASH_MS - 1)).toBeFalse();
        expect(targetFlashOn(TARGET_FLASH_MS)).toBeTrue();
    });

    it('outlasts the radar redraw period so each phase is actually drawn',
        () => {
            // The radar redraws every 200ms; a half-period shorter than
            // that would make the flash a stutter, not a blink.
            expect(TARGET_FLASH_MS / 2).toBeGreaterThanOrEqual(2 * 200);
        });
});
