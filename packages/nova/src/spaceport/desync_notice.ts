import type * as PIXI from 'pixi.js';
import type { Observable } from 'rxjs';
import type { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import type { ControlEvent } from '../nova_plugin/core/index.js';
import { MenuControls } from './menu_controls.js';
import { OfferPopup } from './offer_popup.js';

/**
 * ============================================================================
 * The lost-sync dialog (#333)
 * ============================================================================
 *
 * What the player is shown when the simulation lost sync with the server
 * and every resync attempt failed (communication/simulation_bridge_host.ts
 * gives up; client/resync_failure.ts saves and freezes the universe). The
 * maintainer's ruling: a dialog in-game, the universe frozen behind it,
 * and a single 'Reload' button that reloads the page.
 *
 * Built on the same game-drawn popup as the #131 quarantine notice and the
 * departure report (spaceport/offer_popup.ts), with one difference that
 * matters: an ordinary one-button notice closes on Escape / 'd' (the
 * landed UI's "close this"), and closing THIS one would drop the player
 * into a frozen world with nothing to do. So the popup is built
 * pointer-only (no control stream, hence no 'depart' binding), and the
 * keyboard is held by a MenuControls of its own on top of the focus stack
 * whose only binding is 'accept' (the landed UI's accept key, as on any
 * popup), which reloads like the button.
 * Every other key — Escape included — stops there: a focused surface is
 * modal (menu_controls.ts), and the title's Escape-to-title handler stands
 * down for the `desynced` state (client_state.ts canExitToTitle).
 */
export const DESYNC_NOTICE_TEXT =
    'The game lost sync with the server and could not recover.\n\n'
    + 'Reload the page to continue from your last save.';

export const DESYNC_NOTICE_BUTTON = 'Reload';

/** Where the notice goes and what Reload does. */
export interface DesyncNoticeHost {
    readonly displayAssets: DisplayAssetDataInterface;
    /** The frozen display world's UI layer (display/stage_resource.ts). */
    readonly stage: PIXI.Container;
    /** UI-logical centre of the screen (display/screen_size_plugin.ts). */
    readonly centre: { readonly x: number, readonly y: number };
    /** The client's control-event stream (ClientRuntime.controlsSubject). */
    readonly controlEvents: Observable<ControlEvent>;
    /** location.reload() in the browser; a spy in the specs. */
    readonly reload: () => void;
}

/**
 * Raises the notice. It never closes: Reload (click or the accept key) calls
 * `reload`, and should the page somehow still be here afterwards the
 * notice is shown again rather than leaving a frozen world uncovered.
 * The returned handle exists for the specs; the game never takes it down.
 */
export function showDesyncNotice(host: DesyncNoticeHost): {
    popup: OfferPopup, keys: MenuControls,
} {
    // Pointer-only: see the module doc for why it gets no control stream.
    const popup = new OfferPopup(host.displayAssets);
    popup.container.name = 'DesyncNotice';
    popup.container.position.set(host.centre.x, host.centre.y);
    host.stage.addChild(popup.container);
    const keys = new MenuControls(host.controlEvents, {
        accept: () => host.reload(),
    });
    keys.bind();
    void (async () => {
        for (; ;) {
            await popup.show(DESYNC_NOTICE_TEXT,
                { accept: DESYNC_NOTICE_BUTTON },
                { pict: null, style: 'briefing' });
            host.reload();
        }
    })();
    return { popup, keys };
}
