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
 * LOAD ANYWAY (Matthew's ruling on #131, 2026-11-23: quarantine with a
 * message naming the missing plug-in, "but allow loading anyway if they
 * really want to, and keep that load as a history event in the history
 * log"). The notice offers a second button; choosing it re-enters with
 * the player start told to fly the save without the missing content
 * (client/player_start.ts): a missing ship is replaced by the chär's
 * starting ship, as before #131, and missing outfits are left off. Before
 * any of that, the save AS IT WAS is recorded as a checkpoint in the
 * pilot's history (recordLoadAnyway), labelled with what was missing — so
 * the load is in the history log, and rewinding to that checkpoint after
 * reinstalling the plug-in gets the pilot's own ship back.
 *
 * Pure registry bookkeeping, no PIXI and no DOM, so the title flow's
 * handling is testable under node.
 */
import {
    describeMissingSaveContent, encodeSave, isMissingSaveContentError,
    MissingSaveContent, namesRenamedPlugin, pluginOfId, SaveData,
} from '../nova_plugin/pilot/index.js';
import type { PrefsStorage } from './client_prefs.js';
import type { JsonValue } from './json_patch.js';
import {
    HistoryStorage, metaFromEnvelope, recordCheckpoint,
} from './pilot_history.js';
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
    const advice = namesRenamedPlugin(error.missing)
        ? `${reason} The save has been kept as it is, but this `
            + 'version of the game cannot read it under the plug-in\'s new '
            + 'name: open another pilot or create a new one.'
        : `${reason} The save has been kept as it is: reinstall the `
            + `plug-in to fly ${pilot ? pilot.name : 'this pilot'} again, or `
            + 'open another pilot or create a new one.';
    return `${advice}\n\n${loadAnywayExplanation(error.missing)}`;
}

/** The notice's second button (see the module doc). */
export const LOAD_ANYWAY_BUTTON = 'Load Anyway';

/** What the notice says Load Anyway will do. */
function loadAnywayExplanation(missing: readonly MissingSaveContent[]):
    string {
    const losses = [
        ...missing.some(m => m.kind === 'ship')
            ? ['the ship is replaced by the starting ship'] : [],
        ...missing.some(m => m.kind === 'outfit')
            ? ['the missing outfits are left off'] : [],
    ];
    return `${LOAD_ANYWAY_BUTTON} flies the pilot without it (`
        + `${losses.join(' and ')}) and notes the load in the pilot's `
        + 'history, where the save as it was can be rewound to.';
}

/**
 * The history label for a load without missing content, naming each
 * missing plug-in (or, for a stock-prefixed id, the id), e.g.
 * `Loaded anyway without "missing-plugin"`.
 */
export function loadAnywayLabel(missing: readonly MissingSaveContent[]):
    string {
    const names = [...new Set(missing.map(({ id }) => {
        const plugin = pluginOfId(id);
        return plugin === undefined ? id : `"${plugin}"`;
    }))];
    return `Loaded anyway without ${names.join(', ')}`;
}

/**
 * Records the history event of a Load Anyway: a checkpoint of `save` —
 * the pilot's save as it stands, before the player start leaves anything
 * off — under the pilot's save key, labelled by loadAnywayLabel. A
 * failure to write it is logged, never thrown: the history is
 * bookkeeping, and the player asked to fly.
 */
export function recordLoadAnyway(saveKey: string, save: SaveData,
    missing: readonly MissingSaveContent[], storage?: HistoryStorage,
    at: number = Date.now()): void {
    try {
        const envelope = JSON.parse(encodeSave(save)) as JsonValue;
        recordCheckpoint(saveKey, envelope, {
            label: loadAnywayLabel(missing),
            kind: 'other',
            ...metaFromEnvelope(envelope),
            at,
        }, storage);
    } catch (e) {
        console.warn('Failed to record the load-anyway checkpoint:', e);
    }
}

/**
 * `save` without the outfits `missing` names, for a Load Anyway: a
 * missing outfit cannot be built, and kept in the save it would refuse
 * the pilot again at the next entry. (A missing ship needs nothing here:
 * the player start already falls back to the chär's ship for an id the
 * data does not define, and drops the saved outfits with it.)
 */
export function withoutMissingOutfits(save: SaveData,
    missing: readonly MissingSaveContent[]): SaveData {
    const gone = new Set(missing.filter(m => m.kind === 'outfit')
        .map(m => m.id));
    return gone.size === 0 ? save
        : { ...save, outfits: save.outfits.filter(([id]) => !gone.has(id)) };
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
