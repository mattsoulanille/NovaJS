/**
 * ============================================================================
 * The title screen flow
 * ============================================================================
 *
 * Shows the title screen (the game's entry experience) and runs the flow
 * the player picks: Enter Ship, the pilot dialogs (new / open, with the
 * rollback panel inside the latter), Preferences, About. Everything
 * here is client-only — the sim/room is only joined once the player
 * enters the game via startGame, and Escape while flying brings the
 * title back through teardownGame.
 *
 * The title's own `entering` / `inGame` flags are gone: the client state
 * machine (client/client_state.ts) says whether a game can be entered
 * (`canEnterGame`) and whether it can be left (`canExitToTitle`, which
 * refuses while docked); the dialogs and the rollback panel are states
 * of it too.
 */
import type * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import {
    canEnterGame, canExitToTitle, closeRollback, closeTitleDialog,
    openRollback, openTitleDialog, TitleDialog,
} from '../client/client_state.js';
import type { ClientRuntime } from '../client/runtime.js';
import { isMuted } from '../client/mute.js';
import { isTextEntryActive } from '../input_focus.js';
import { formatDate } from '../nova_plugin/player/calendar.js';
import { ControlAction } from '../nova_plugin/core/controls.js';
import { ControlEvent } from '../nova_plugin/core/controls_plugin.js';
import { resetDiscovery } from '../nova_plugin/player/discovery_store.js';
import { combatRatingName } from '../nova_plugin/reputation/reputation.js';
import { loadSave } from '../nova_plugin/session/save_game.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { OfferPopup } from '../spaceport/offer_popup.js';
import { loadPilotProfile, savePilotProfile } from './client_prefs.js';
import {
    looksLikeOriginalPilot, OriginalPilotContext,
} from './original_pilot_import.js';
import {
    checkpointCount, loadHistory, rewindPilotSave,
} from './pilot_history.js';
import {
    createPilot, deletePilot, exportCheckpointFile, exportFileName,
    exportPilot, getActivePilot, importOriginalPilot, importPilot,
    ImportResult, listPilots, selectPilot,
} from './pilot_registry.js';
import { ROLLBACK_PANEL, RollbackScreen } from './rollback_screen.js';
import {
    ABOUT_TEXT, DisplayScaleHandle, fillAboutPlaceholders, PilotDialogActions,
    PilotEntry, showNewPilotDialog, showOpenPilotDialog, showPreferencesDialog,
} from './title_dialogs.js';
import { TitleMusic } from './title_music.js';
import { TitleScreen, TitleStatus } from './title_screen.js';

/** What the title flow needs from the page. */
export interface TitleHost {
    /**
     * The title screen's own UI layer: the title art, the About popup
     * and the rollback panel (browser.ts owns it; it carries the UI
     * scale the display worlds' Stage carries).
     */
    readonly titleUiLayer: PIXI.Container;
    /** The current UI-logical viewport, for letterboxing and centring. */
    uiSize(): { width: number, height: number };
    /**
     * Registers a re-layout to run on window resize / scale change.
     * Returns the unregister.
     */
    onDisplayScale(listener: () => void): () => void;
    /** Enters the game; resolves to its teardown (client/game_session.ts). */
    startGame(): Promise<() => Promise<void>>;
    /** Re-reads the active pilot's bindings into the live control map. */
    applyControls(): Promise<void>;
    /** The display-scale preferences, for the Preferences dialog. */
    readonly displayScale: DisplayScaleHandle;
}

/**
 * The dësc resources holding the original's About box text: 32767 is
 * the credits proper, 32766 the "special thanks" continuation the
 * original reaches through the box's scroll arrows. The About text is
 * NOT in a STR# table -- it lives in these two dëscs.
 */
const ABOUT_DESC_IDS = ['nova:32767', 'nova:32766'];

/**
 * Reads the About credits out of the game data. Returns undefined when
 * the data has no About dësc, so the dialog falls back to its built-in
 * text rather than showing an empty box.
 */
async function loadAboutText(runtime: ClientRuntime):
    Promise<{ text: string, pict: string | null } | undefined> {
    const parts: string[] = [];
    // The About box is the game's own desc+pict frame (PICT 8527), so it
    // also carries the dësc's Graphic in the pane on the right — dësc
    // 32767 names PICT 5005, the ship shown in title_screen/about.png.
    let pict: string | null = null;
    for (const id of ABOUT_DESC_IDS) {
        try {
            const desc = await runtime.displayAssetData.data.Description.get(id);
            if (desc.text.trim()) {
                parts.push(desc.text.trim());
            }
            if (pict === null && desc.graphic >= 0) {
                pict = `nova:${desc.graphic}`;
            }
        } catch {
            // A data set without this dësc: skip it.
        }
    }
    return parts.length ? { text: parts.join('\n\n'), pict } : undefined;
}

/** Saves `text` to the player's downloads as `filename`. */
function downloadText(text: string, filename: string): void {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Give the click a turn to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The game-data lookups an ORIGINAL EV Nova pilot import needs
 * (title/original_pilot_import.ts): resource existence by global id,
 * the planet -> system and system -> gövt maps, and the default start
 * system.
 */
async function originalPilotContext(runtime: ClientRuntime):
    Promise<OriginalPilotContext> {
    const { gameData } = runtime;
    const ids = await gameData.ids;
    const universe = MissionUniverse.shared(gameData);
    await universe.load();
    let fallbackSystem = ids.System[0] ?? 'nova:128';
    try {
        const starts = await Promise.all(ids.PlayerStart.map(
            id => gameData.data.PlayerStart.get(id)));
        const start = starts.find(s => s.isDefault) ?? starts[0];
        if (start && start.systems.length > 0) {
            fallbackSystem = start.systems[0];
        }
    } catch {
        // Keep the first system.
    }
    const ships = new Set(ids.Ship);
    const outfits = new Set(ids.Outfit);
    const missions = new Set(ids.Mission);
    const ranks = new Set(ids.Rank);
    const junk = new Set(ids.Junk);
    return {
        knownShip: id => ships.has(id),
        knownOutfit: id => outfits.has(id),
        knownMission: id => missions.has(id),
        knownRank: id => ranks.has(id),
        knownJunk: id => junk.has(id),
        systemOfPlanet: (id, bits) => universe.systemIdOfPlanet(id, bits),
        govtOfSystem: id => universe.getSystemInfo(id)?.govt,
        fallbackSystem,
    };
}

/**
 * Builds the bottom status readout for the title screen from the
 * current save + pilot profile. A pure read; never mutates state.
 */
async function computeTitleStatus(runtime: ClientRuntime):
    Promise<TitleStatus> {
    const profile = getActivePilot()?.profile ?? loadPilotProfile();
    const save = loadSave();
    const empty: TitleStatus = {
        pilotName: profile?.name ?? '—',
        shipName: '—', shipClass: '—', shipSubtitle: '',
        legalStatus: 'Citizen', combatRating: combatRatingName(0),
        date: '—',
    };
    if (!save) {
        return empty;
    }
    let shipClass = '—';
    let shipSubtitle = '';
    try {
        const shipData = await runtime.gameData.data.Ship.get(save.ship);
        // The ship's name can carry a "; variant" suffix that the
        // subtitle already spells out; show just the class on the first
        // line and the subtitle beneath (as the original does).
        shipClass = (shipData.name || save.ship).split(';')[0].trim();
        shipSubtitle = shipData.subtitle || '';
        if (shipSubtitle && shipSubtitle === shipClass) {
            shipSubtitle = '';
        }
    } catch {
        // Fall back to the raw id.
        shipClass = save.ship;
    }
    const shipNumber = profile?.shipNumber ?? 1;
    const kills = save.combatRatings
        ?.find(([category]) => category === 'kills')?.[1] ?? 0;
    return {
        pilotName: profile?.name ?? 'Captain',
        shipName: `${shipClass} ${shipNumber}`,
        shipClass,
        shipSubtitle,
        legalStatus: 'Citizen',
        combatRating: combatRatingName(kills),
        date: save.date ? formatDate(save.date) : '—',
    };
}

export async function runTitle(runtime: ClientRuntime, host: TitleHost):
    Promise<void> {
    const { state, displayAssetData, gameData } = runtime;
    const { titleUiLayer } = host;
    const title = new TitleScreen(displayAssetData);
    window.novaTitle = title;
    // The original's looping title theme. A single streaming element
    // reused across the whole title lifetime (shown, entered, Esc'd back
    // to). It attempts autoplay now and, when the browser blocks that
    // (no gesture yet), starts on the player's first pointerdown /
    // keydown.
    const music = new TitleMusic();
    window.novaTitleMusic = music;
    await title.buildPromise;

    // While the title (not a game world) is on screen, IT owns renderer
    // sizing: the renderer itself is sized by the page's display scale
    // (one owner for the window resize, the page zoom and the scale
    // settings); the title only has to re-letterbox its 1024x768 art
    // inside the UI-logical viewport, which is the coordinate space
    // titleUiLayer draws in.
    const onResize = () => {
        const { width, height } = host.uiSize();
        title.resize(width, height);
    };
    host.onDisplayScale(onResize);

    // Drive the title's flame animation while the title is visible.
    let lastTitleTick = performance.now();
    const titleTicker = () => {
        const now = performance.now();
        title.tick(now - lastTitleTick);
        lastTitleTick = now;
    };

    const refreshStatus = async () => {
        try {
            title.setStatus(await computeTitleStatus(runtime));
        } catch (e) {
            console.warn('Failed to compute title status:', e);
        }
    };

    // ── About ──────────────────────────────────────────────────────────
    // The About box is NOT native chrome in the original: title_screen/
    // about.png shows the game's own desc+pict frame (PICT 8527, at
    // screen 635,419 — plainly centred) with the credits scrolling in its
    // text well, the dësc's Graphic in the pane on the right, a red Okay
    // and the two round scroll arrows. That is exactly what OfferPopup
    // renders, so About reuses it instead of the HTML modal it used to
    // open. (The pilot and Preferences dialogs ARE native windows in the
    // original, and keep their HTML stand-ins by the project's standing
    // ruling.)
    const aboutPopup = new OfferPopup(displayAssetData);
    aboutPopup.container.name = 'AboutPopup';
    // Centre in UI-LOGICAL pixels, not renderer.width/height: with
    // autoDensity on a 2x display those are DEVICE pixels, and halving
    // them put the About box in the bottom-right corner (Matthew's
    // playtest). Rounded, because a half-pixel origin resamples every
    // glyph in the box through the LINEAR filter (see screenCentre).
    const centreAbout = () => {
        const { width, height } = host.uiSize();
        aboutPopup.container.position.set(
            Math.round(width / 2), Math.round(height / 2));
    };
    host.onDisplayScale(centreAbout);
    const showAbout = async () => {
        const about = await loadAboutText(runtime);
        // Keep the popup above the title art, and only while it is up.
        titleUiLayer.addChild(aboutPopup.container);
        centreAbout();
        try {
            await aboutPopup.show(
                fillAboutPlaceholders(about?.text ?? ABOUT_TEXT.join('\n')),
                { accept: 'Okay' }, { pict: about?.pict ?? null });
        } finally {
            titleUiLayer.removeChild(aboutPopup.container);
        }
    };

    // ── Pilot history / rollback ───────────────────────────────────────
    // The rollback view (title/rollback_screen.ts) is a PIXI panel over
    // the title art, like the About popup. The title has no game
    // controls pipeline, so a keydown adaptor feeds it arrow/page/Escape
    // presses as ControlEvents on its own subject while it is up. Built
    // lazily: it loads every system for its map on first use.
    const rollbackControls = new Subject<ControlEvent>();
    let rollbackScreen: RollbackScreen | undefined;
    const rollbackKeyActions: Record<string, ControlAction> = {
        ArrowUp: 'up', ArrowDown: 'down', PageUp: 'left', PageDown: 'right',
        Escape: 'depart',
    };
    const onRollbackKey = (event: KeyboardEvent) => {
        const action = rollbackKeyActions[event.key];
        if (!action) {
            return;
        }
        event.preventDefault();
        rollbackControls.next({
            action, state: event.repeat ? 'repeat' : 'start',
        });
    };
    const centreRollback = () => {
        const { width, height } = host.uiSize();
        rollbackScreen?.container.position.set(
            Math.round(Math.max(0, (width - ROLLBACK_PANEL.width) / 2)),
            Math.round(Math.max(0, (height - ROLLBACK_PANEL.height) / 2)));
    };
    host.onDisplayScale(centreRollback);
    /**
     * Opens the rollback view for a pilot; resolves a status line for the
     * Open Pilot dialog. A rewind installs the chosen checkpoint's save
     * as the pilot's current save (title/pilot_history.ts rewindPilotSave).
     */
    const openRollbackView = async (id: string): Promise<string> => {
        const pilot = listPilots().find(p => p.id === id);
        if (!pilot) {
            return 'That pilot no longer exists.';
        }
        const history = loadHistory(pilot.saveKey);
        if (!history || history.checkpoints.length === 0) {
            return `${pilot.name} has no checkpoints yet (they are recorded `
                + 'on every departure).';
        }
        rollbackScreen ??= new RollbackScreen(displayAssetData, gameData,
            rollbackControls);
        state.apply(s => openRollback(s, id));
        titleUiLayer.addChild(rollbackScreen.container);
        centreRollback();
        document.addEventListener('keydown', onRollbackKey);
        try {
            const result = await rollbackScreen.show({
                pilotName: pilot.name,
                history,
                onExport: (index) => {
                    const copy = exportCheckpointFile(id, index);
                    if (copy) {
                        downloadText(copy.text, exportFileName(copy.name));
                    }
                },
            });
            if (result.action === 'rewind') {
                const label = history.checkpoints[result.index]?.label
                    ?? 'checkpoint';
                if (rewindPilotSave(pilot.saveKey, result.index)) {
                    // The in-flight change baseline moves with the save.
                    if (getActivePilot()?.id === id) {
                        runtime.saves.loadCheckpointBaseline();
                    }
                    void refreshStatus();
                    return `Rewound ${pilot.name} to "${label}".`;
                }
                return 'The rewind could not be written.';
            }
            return '';
        } finally {
            document.removeEventListener('keydown', onRollbackKey);
            titleUiLayer.removeChild(rollbackScreen.container);
            state.apply(closeRollback);
        }
    };

    let teardownGame: (() => Promise<void>) | undefined;

    // Put the title back on screen (initial boot, and after leaving the
    // game): re-add its container/ticker, re-size to the current window
    // (the game may have resized the renderer), and refresh the status
    // readout from the freshly saved game.
    const showTitle = () => {
        titleUiLayer.addChild(title.container);
        runtime.app.ticker.add(titleTicker);
        lastTitleTick = performance.now();
        onResize();
        title.show();
        // Start (initial boot) or restart (after Esc back from the game)
        // the looping theme. `?mute` (preview panels / harness runs)
        // skips it.
        if (!isMuted()) {
            music.play();
        }
        void refreshStatus();
    };

    /**
     * Enters the game. From the menu, or from a pilot dialog that
     * resolved with a pilot to fly (the dialog state goes with the
     * title). A failed entry shows the title again.
     */
    const enterGame = async () => {
        if (state.state.kind !== 'title') {
            return;
        }
        title.hide();
        // Cut the theme as the game world takes over (it restarts from
        // the top if the player Escapes back to the title).
        music.stop();
        runtime.app.ticker.remove(titleTicker);
        titleUiLayer.removeChild(title.container);
        try {
            teardownGame = await host.startGame();
        } catch (e) {
            console.error('Failed to enter game:', e);
            showTitle();
        }
    };

    // Escape while flying leaves the game and returns to the title:
    // save, remove the player's ship for every peer, tear the game
    // session down, and re-show the title. Re-entry (Enter Ship) then
    // works again.
    const exitToTitle = async () => {
        if (!canExitToTitle(state.state)) {
            return;
        }
        try {
            await teardownGame?.();
        } catch (e) {
            console.error('Failed to exit to title:', e);
        }
        teardownGame = undefined;
        showTitle();
    };

    // Escape returns to the title, but ONLY while actually flying: a
    // landed menu / dialog / text field owns (or reserves) Escape, so
    // stand down whenever one is up. The state machine knows the
    // spaceport dock; starmap/gate map/player info/hail/boarding set
    // MenuControls.focused; text inputs are caught by isTextEntryActive.
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !canExitToTitle(state.state)) {
            return;
        }
        if (MenuControls.focused || isTextEntryActive()) {
            return;
        }
        event.preventDefault();
        void exitToTitle();
    });

    /** Runs a title dialog as a state of the machine. */
    const withDialog = async (dialog: TitleDialog,
        body: () => Promise<boolean>): Promise<void> => {
        title.setEnabled(false);
        state.apply(s => openTitleDialog(s, dialog));
        let entering = false;
        try {
            entering = await body();
        } finally {
            if (!entering) {
                state.apply(closeTitleDialog);
                title.setEnabled(true);
            }
        }
        if (entering) {
            await enterGame();
        }
    };

    showTitle();
    title.action.subscribe(async (action) => {
        if (!canEnterGame(state.state)) {
            return;
        }
        switch (action) {
            case 'enterShip':
                await enterGame();
                break;
            case 'newPilot':
                await withDialog('newPilot', async () => {
                    const profile = await showNewPilotDialog();
                    if (!profile) {
                        return false;
                    }
                    const withShip = {
                        ...profile,
                        shipNumber: 100 + Math.floor(Math.random() * 900),
                    };
                    // Register a NEW pilot file and make it active. Its
                    // save key is fresh AND unoccupied (createPilot skips
                    // any id whose slot already holds a save), so
                    // startGame spawns from the scenario's default chär
                    // without disturbing any other pilot's save.
                    createPilot(withShip);
                    // Deliberately NOT resetSave(): the new pilot's slot
                    // is empty by construction, so there is nothing of
                    // its own to clear, and a reset here could only ever
                    // delete a save belonging to somebody else — the
                    // legacy `novajs:save` that migration adopts in
                    // place, above all. Only the discovery record needs
                    // clearing, and createPilot has already pointed it at
                    // the new pilot's own key (setActiveSaveKey), so this
                    // clears that empty slot and nobody else's.
                    resetDiscovery();
                    savePilotProfile(withShip);
                    // A fresh pilot has no rebindings: back to defaults.
                    await host.applyControls();
                    // The dialog state goes with the title: the entry
                    // replaces it.
                    state.apply(closeTitleDialog);
                    return true;
                });
                break;
            case 'openPilot':
                await withDialog('openPilot', async () => {
                    const toEntry = (
                        p: ReturnType<typeof listPilots>[number]): PilotEntry => {
                        const active = getActivePilot();
                        const isActive = active?.id === p.id;
                        const parts: string[] = [];
                        if (p.profile?.nickname) {
                            parts.push(`"${p.profile.nickname}"`);
                        }
                        if (isActive) {
                            parts.push('(current)');
                        }
                        const checkpoints =
                            checkpointCount(loadHistory(p.saveKey));
                        if (checkpoints > 0) {
                            parts.push(`· ${checkpoints} checkpoint`
                                + `${checkpoints === 1 ? '' : 's'}`);
                        }
                        return {
                            id: p.id, name: p.name,
                            detail: parts.join(' ') || undefined,
                        };
                    };
                    const listEntries = () => listPilots().map(toEntry);
                    const actions: PilotDialogActions = {
                        refresh: listEntries,
                        onExport: (id) => {
                            const text = exportPilot(id);
                            if (!text) { return; }
                            const pilot = listPilots().find(p => p.id === id);
                            downloadText(text,
                                exportFileName(pilot?.name ?? 'pilot'));
                        },
                        onImport: async (bytes, fileName) => {
                            // Content sniffing: a NovaJS export is JSON;
                            // anything else is tried as an original EV
                            // Nova pilot.
                            let result: ImportResult;
                            if (looksLikeOriginalPilot(bytes)) {
                                result = importOriginalPilot(bytes, fileName,
                                    await originalPilotContext(runtime));
                            } else {
                                result = importPilot(
                                    new TextDecoder().decode(bytes));
                            }
                            if (!result.ok) {
                                return { ok: false, message: result.reason };
                            }
                            const notes = result.notes?.length
                                ? ` Notes: ${result.notes.join(' ')}` : '';
                            return {
                                ok: true,
                                message: (result.renamed
                                    ? `Imported as "${result.pilot.name}" `
                                    + '(a pilot with that name already '
                                    + 'existed).'
                                    : `Imported "${result.pilot.name}".`)
                                    + notes,
                            };
                        },
                        onDelete: (id) => { deletePilot(id); },
                        onRollback: openRollbackView,
                    };
                    const chosen =
                        await showOpenPilotDialog(listEntries(), actions);
                    if (!chosen) {
                        void refreshStatus();
                        return false;
                    }
                    const picked = selectPilot(chosen);
                    if (picked) {
                        // Mirror the chosen pilot's profile into the
                        // legacy slot so the title status readout matches.
                        if (picked.profile) {
                            savePilotProfile(picked.profile);
                        }
                        await host.applyControls();
                    }
                    state.apply(closeTitleDialog);
                    return true;
                });
                break;
            case 'setPrefs':
                await withDialog('setPrefs', async () => {
                    const controlsJson =
                        await gameData.getSettings?.('controls.json');
                    await showPreferencesDialog(
                        (controlsJson as Record<string, unknown>) ?? {},
                        host.displayScale);
                    // Rebindings take effect right away rather than at
                    // the next game entry.
                    await host.applyControls();
                    return false;
                });
                break;
            case 'about':
                await withDialog('about', async () => {
                    await showAbout();
                    return false;
                });
                break;
            case 'quit':
                // Deliberately a no-op: a browser tab cannot quit itself
                // (window.close() is ignored for tabs the script did not
                // open), and anything else -- reloading, blanking the
                // page, dropping the sockets -- destroys the session
                // instead of quitting. The button stays because the
                // original menu has it.
                break;
            default:
                break;
        }
    });
}
