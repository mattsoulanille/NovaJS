import { isLeft } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import * as PIXI from 'pixi.js';
import { Subscription } from 'rxjs';
import { DisplayAssetDataResource, SimulationGameDataResource } from '../nova_plugin/core/game_data_resource.js';
import { FinishJumpEvent, JumpComponent, JUMP_DEPART_DELAY_MS, WARP_OUT_SOUND, WARP_UP_FAST_SOUND, WARP_UP_SOUND } from '../nova_plugin/travel/jump_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player/player_ship_plugin.js';
import { PixiAppResource } from './pixi_app_resource.js';
import { ShipBaseSetAnimationSystem } from "./ship_animation_plugin.js";

/**
 * How the origin -> destination transition is drawn.
 * - 'flash': the reference engine's behavior — no fade during the
 *   departure burn; the screen goes full white right at the transition
 *   and clears as soon as the destination renders.
 * - 'fade': a gentler alternative — the screen gradually whitens over
 *   the departure burn and fades back in over the arrival
 *   deceleration.
 * Purely display-side (never simulation state), so it is a
 * client-local setting: the persistent default lives in
 * settings/settings.json ({"jumpVisual": ...}) and it can be switched
 * live from the console via `novaSettings.jumpVisual = 'fade'`.
 */
export type JumpVisual = 'flash' | 'fade';
const DisplaySettingsType = t.partial({
    jumpVisual: t.union([t.literal('flash'), t.literal('fade')]),
});

const jumpVisualSetting = { mode: 'flash' as JumpVisual, loaded: false };
export function getJumpVisual(): JumpVisual {
    return jumpVisualSetting.mode;
}
export function setJumpVisual(mode: JumpVisual) {
    jumpVisualSetting.mode = mode;
}

/** How quickly the white flash clears once the destination system is
 * rendering. The reference engine shows a single literal frame of
 * white, but one 16ms frame after a multi-hundred-ms loading gap reads
 * as a glitch rather than a flash, so it decays over a brief fixed
 * time instead. */
const FLASH_DECAY_MS = 150;
/** How quickly the overlay clears if a jump ends without the usual
 * arrival ramp (units of full-fades per second; fade mode only). */
const FALLBACK_FADE_RATE = 2;

/** The overlay's name on the app stage, which is where it is found. */
const JUMP_FADE_OVERLAY_NAME = 'JumpFadeOverlay';

/**
 * The white overlay is OWNED BY THE PIXI APP'S ROOT STAGE, not by the
 * per-system display world: display worlds are torn down and rebuilt
 * across a system transition, and the screen must stay white from the
 * moment the departing world vanishes until the destination world has
 * loaded and the arriving ship is visible again. So it lives exactly as
 * long as it is attached there — found by name on every world build,
 * made on the first, and taken down by {@link resetJumpFade} when the
 * session ends (browser.ts's teardownGame). No module state: a second
 * app, or a session after a reset, starts with no overlay at all.
 * Display-only; never part of the simulation.
 */
function jumpFadeOverlay(app: PIXI.Application): PIXI.Graphics {
    const existing = app.stage.getChildByName(JUMP_FADE_OVERLAY_NAME);
    if (existing instanceof PIXI.Graphics) {
        return existing;
    }
    const overlay = new PIXI.Graphics();
    overlay.name = JUMP_FADE_OVERLAY_NAME;
    overlay.beginFill(0xffffff);
    overlay.drawRect(0, 0, 1, 1);
    overlay.endFill();
    overlay.alpha = 0;
    overlay.eventMode = 'none';
    app.stage.addChild(overlay);
    return overlay;
}

/**
 * Clears the white-out and takes the overlay off `app`'s stage: for the
 * end of a session. An exit to the title during the white screen has no
 * destination world to clear it, so the title would otherwise come back
 * under a full-white cover until the next Enter Ship (issue #30). A no-op
 * when no session ever jumped.
 */
export function resetJumpFade(app: PIXI.Application): void {
    const overlay = app.stage.getChildByName(JUMP_FADE_OVERLAY_NAME);
    if (overlay) {
        overlay.alpha = 0;
        overlay.visible = false;
        app.stage.removeChild(overlay);
    }
}

function clamp01(value: number) {
    return Math.min(1, Math.max(0, value));
}

const JumpFlashSubscription = new Resource<Subscription>('JumpFlashSubscription');
/** This world's handle on the app stage's overlay (see jumpFadeOverlay). */
const JumpFadeOverlayResource = new Resource<PIXI.Graphics>('JumpFadeOverlay');

/**
 * Drives the white overlay from the player ship's synced jump stages.
 * In 'fade' mode the alpha ramps up over the departure burn and down
 * over the arrival deceleration; in 'flash' mode it only ever decays —
 * the FinishJumpEvent subscription below snaps it to full white at the
 * departure instant. Between the two worlds (while the destination
 * loads) no player entity exists, this system doesn't run, and the
 * overlay stays white in both modes.
 */
export const JumpFadeSystem = new System({
    name: 'JumpFadeSystem',
    args: [TimeResource, PixiAppResource, JumpFadeOverlayResource,
        Optional(JumpComponent), PlayerShipSelector] as const,
    step(time, app, overlay, jump) {
        // Keep the overlay above every display world's stage.
        if (app.stage.children[app.stage.children.length - 1] !== overlay) {
            app.stage.addChild(overlay);
        }
        overlay.width = app.screen.width;
        overlay.height = app.screen.height;

        let rate: number;
        if (jumpVisualSetting.mode === 'fade') {
            if (jump?.stage === 'accelerating') {
                rate = 1000 / JUMP_DEPART_DELAY_MS;
            } else {
                // Ships arrive at regular speed with control returned
                // immediately, so there is no arrival stage to track:
                // fade back in at the fallback rate.
                rate = -FALLBACK_FADE_RATE;
            }
        } else {
            rate = -1000 / FLASH_DECAY_MS;
        }
        overlay.alpha = clamp01(overlay.alpha + rate * time.delta_s);
        overlay.visible = overlay.alpha > 0;
    },
    // #156 pin (shared: JumpSequence, time): JumpFadePlugin registers after
    // ShipAnimationPlugin.
    after: [ShipBaseSetAnimationSystem],
});

export const JumpFadePlugin: Plugin = {
    name: 'JumpFadePlugin',
    build(world) {
        const app = world.resources.get(PixiAppResource);
        if (!app) {
            throw new Error('Expected PixiAppResource to exist');
        }
        // The app stage's overlay (made on the first world), re-added so
        // it starts this world on top; JumpFadeSystem keeps it there.
        const overlay = jumpFadeOverlay(app);
        app.stage.addChild(overlay);
        world.resources.set(JumpFadeOverlayResource, overlay);
        world.addSystem(JumpFadeSystem);

        // The departure instant: the sim removed the jumping ship this
        // frame. For the local player, cover the screen in white — in
        // 'flash' mode this is the whole effect; in 'fade' mode it
        // just completes the ramp — and keep it white until the
        // destination world's JumpFadeSystem clears it.
        const subscription = world.events.get(FinishJumpEvent)
            .subscribe(({ data }) => {
                if (!data.entity.components.has(PlayerShipSelector)) {
                    return;
                }
                overlay.width = app.screen.width;
                overlay.height = app.screen.height;
                overlay.alpha = 1;
                overlay.visible = true;
            });
        world.resources.set(JumpFlashSubscription, subscription);

        // Load the persistent default for the jump visual once (the
        // module-level setting survives display world rebuilds).
        if (!jumpVisualSetting.loaded) {
            jumpVisualSetting.loaded = true;
            const gameData = world.resources.get(SimulationGameDataResource);
            void gameData?.getSettings?.('settings.json').then(settings => {
                const decoded = DisplaySettingsType.decode(settings);
                if (isLeft(decoded)) {
                    console.warn('Failed to parse settings.json');
                    return;
                }
                if (decoded.right.jumpVisual) {
                    jumpVisualSetting.mode = decoded.right.jumpVisual;
                }
            }).catch(e => console.warn('Failed to load settings.json', e));
            // Console-discoverable live toggle.
            if (typeof window !== 'undefined') {
                const settingsObject = (window.novaSettings ??= {});
                Object.defineProperty(settingsObject, 'jumpVisual', {
                    get: getJumpVisual,
                    set: setJumpVisual,
                    configurable: true,
                });
            }
        }

        // Warm the hyperspace sounds so the first jump is audible (the
        // display sound system plays from the cache).
        const displayAssets = world.resources.get(DisplayAssetDataResource);
        for (const id of [WARP_UP_SOUND, WARP_UP_FAST_SOUND, WARP_OUT_SOUND]) {
            displayAssets?.data.Sound.get(id).catch(
                e => console.warn(`Failed to load jump sound ${id}`, e));
        }
    },
    remove(world) {
        world.resources.get(JumpFlashSubscription)?.unsubscribe();
        world.resources.delete(JumpFlashSubscription);
        world.removeSystem(JumpFadeSystem);
        world.resources.delete(JumpFadeOverlayResource);
        // The overlay intentionally stays attached to the app stage:
        // the display world is removed mid-jump, and the white cover
        // must persist until the destination world clears it (or the
        // session's end does, with resetJumpFade).
    }
};
