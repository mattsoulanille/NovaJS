/**
 * ============================================================================
 * When the simulation's resync gives up (#333)
 * ============================================================================
 *
 * The bridge host (communication/simulation_bridge_host.ts) retries a
 * desync recovery a bounded number of times; when the last attempt fails
 * it freezes for good and says so ONCE, on the next frame
 * (SimulationFrame.resyncFailed). A reconnect whose identity recovery the
 * room keeps refusing (#354, giveUpIdentityRecovery) ends the same way,
 * through the same flag. The maintainer's ruling for what the
 * client does then: "Save and then show a desync error message (a dialog
 * box in-game), freeze the universe, and have a 'Reload' button that
 * reloads the page." In that order:
 *
 * 1. SAVE — the last GOOD state. The host has sent nothing since the
 *    recovery began (a resyncing host returns empty frames, a failed one
 *    sends no state at all), so the display world still mirrors the last
 *    real frame: the player's ship as it was before the failure, never the
 *    shipless genesis world the failed reconstruction left in the worker.
 *    The save is the ordinary one (PlayerPersistence.saveNow), which
 *    writes nothing without a player ship; when there is none — the
 *    failure caught the player out of the world — the stored save, the
 *    last periodic one, is KEPT rather than replaced.
 * 2. FREEZE — the `desynced` state (client_state.ts). Its system is not a
 *    live system, so the frame pump neither steps the display world nor
 *    talks to the bridge, every input sink (keyboard, touch, tap, the
 *    autopilot) finds no bridge to send to, and the periodic / pagehide
 *    saves find nothing to save: the save from step 1 cannot be
 *    overwritten by a later one. The display holds its last frame.
 * 3. DIALOG — spaceport/desync_notice.ts, with the one Reload button.
 *
 * Client-local: nothing here touches simulation state.
 */
import { resetJumpFade } from '../display/jump_fade_plugin.js';
import { ScreenSize, screenCentre } from '../display/screen_size_plugin.js';
import { Stage } from '../display/stage_resource.js';
import { showDesyncNotice } from '../spaceport/desync_notice.js';
import { liveSystem, LiveSystem, loseSync } from './client_state.js';
import type { ClientRuntime } from './runtime.js';

/** What the lost-sync save did. */
export type LostSyncSave =
    /** The display world's player was written over the stored save. */
    | 'saved'
    /** Nothing trustworthy to write: the stored (last periodic) save stands. */
    | 'keptLastSave';

/**
 * Steps 1 and 2: save, then freeze. Returns undefined, doing nothing, when
 * the failure is stale — it came from a system the client has already
 * left (a transit took the bridge away while the frame was in flight).
 */
export function freezeOnResyncFailure(
    runtime: Pick<ClientRuntime, 'state' | 'saves'>,
    live: LiveSystem): LostSyncSave | undefined {
    if (liveSystem(runtime.state.state) !== live) {
        return undefined;
    }
    let outcome: LostSyncSave = 'keptLastSave';
    try {
        outcome = runtime.saves.saveNow() ? 'saved' : 'keptLastSave';
    } catch (e) {
        console.warn('Failed to save after losing sync:', e);
    }
    if (outcome === 'keptLastSave') {
        console.warn('Lost sync with no player ship to save; the last '
            + 'periodic save is kept.');
    }
    runtime.state.apply(loseSync);
    return outcome;
}

/**
 * The whole reaction, steps 1-3: what the frame pump calls on the frame
 * that carries `resyncFailed`. Browser-only (the dialog is PIXI, Reload is
 * location.reload()).
 */
export function onResyncFailed(runtime: ClientRuntime, live: LiveSystem):
    void {
    console.error('The simulation lost sync with the room and could not '
        + 'recover; freezing.');
    if (freezeOnResyncFailure(runtime, live) === undefined) {
        return;
    }
    // A failure mid-jump would otherwise leave the white-out (on the APP
    // stage, above every display world) covering the dialog.
    resetJumpFade(runtime.app);
    const stage = live.world.resources.get(Stage);
    const screen = live.world.resources.get(ScreenSize);
    if (!stage || !screen) {
        console.error('No UI layer for the lost-sync dialog; reloading.');
        location.reload();
        return;
    }
    showDesyncNotice({
        displayAssets: runtime.displayAssetData,
        stage,
        centre: screenCentre(screen),
        controlEvents: runtime.controlsSubject,
        reload: () => location.reload(),
    });
}
