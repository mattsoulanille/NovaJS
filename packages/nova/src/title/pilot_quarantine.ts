/**
 * The title screen's answer to a save that names an uninstalled
 * plug-in's content (issue #131).
 *
 * The player start refuses such a save before applying any of it
 * (client/player_start.ts, nova_plugin/pilot/save_content.ts), so Enter
 * Ship rejects and the session unwinds back to the title. Here that
 * rejection becomes a QUARANTINE of the pilot in the registry
 * (pilot_registry.ts quarantinePilot): the reason — naming the missing
 * plug-in and ids — is recorded on the pilot and shown to the player,
 * the save is left exactly where it is, and the player is free to open
 * another pilot or create a new one. The next entry of this pilot that
 * validates (the plug-in came back) lifts the quarantine.
 *
 * Pure registry bookkeeping, no PIXI and no DOM, so the title flow's
 * handling is testable under node.
 */
import {
    describeMissingSaveContent, isMissingSaveContentError, namesRenamedPlugin,
} from '../nova_plugin/pilot/index.js';
import type { PrefsStorage } from './client_prefs.js';
import {
    getActivePilot, PilotRecord, quarantinePilot, releasePilotQuarantine,
} from './pilot_registry.js';

/**
 * Handles a rejected game entry. When the rejection is a save naming
 * missing content, quarantines the active pilot and returns the message
 * to show the player; any other rejection returns undefined (the title
 * just comes back, as before). Never throws.
 */
export function quarantineOnEntryFailure(error: unknown,
    storage?: PrefsStorage): string | undefined {
    if (!isMissingSaveContentError(error)) {
        return undefined;
    }
    const pilot = getActivePilot(storage);
    const who = pilot ? `${pilot.name}'s saved game` : 'This saved game';
    const reason = `${who} ${describeMissingSaveContent(error.missing)}.`;
    if (pilot) {
        quarantinePilot(pilot.id, reason, storage);
    }
    // A plug-in that is installed under a new name (issue #310) is not
    // brought back by reinstalling it, so do not advise that.
    if (namesRenamedPlugin(error.missing)) {
        return `${reason} The save has been kept as it is, but this `
            + 'version of the game cannot read it under the plug-in\'s new '
            + 'name: open another pilot or create a new one.';
    }
    return `${reason} The save has been kept as it is: reinstall the `
        + `plug-in to fly ${pilot ? pilot.name : 'this pilot'} again, or `
        + 'open another pilot or create a new one.';
}

/** A successful entry: the active pilot's save validated. */
export function releaseActivePilotQuarantine(storage?: PrefsStorage): void {
    const pilot = getActivePilot(storage);
    if (pilot?.quarantine) {
        releasePilotQuarantine(pilot.id, storage);
    }
}

/** The Open Pilot dialog's note for a quarantined pilot, if it is one. */
export function pilotQuarantineNote(pilot: PilotRecord): string | undefined {
    return pilot.quarantine ? '· needs a plug-in that is not installed'
        : undefined;
}
