/**
 * The handles the client hangs on `window` for the browser console and
 * the headless/visual-comparison harnesses (puppeteer drives them by
 * name, so they are part of the test surface, not just conveniences).
 *
 * Typed here, once, so the code that installs them needs no cast. Every
 * one is optional: nothing sets them before the plug-in that owns them
 * has built, and none exists at all in workers, on the server, or in the
 * node specs (which is why each installer guards `typeof window`).
 *
 * browser.ts installs more (novaSim, novaAutopilot, displayWorld, ...);
 * those are still assigned through an untyped window and are not listed.
 */
import type { Entity } from 'nova_ecs/entity';
import type { HailDialog } from './spaceport/hail_dialog.js';
import type { OfferPopup } from './spaceport/offer_popup.js';
import type { Starmap } from './spaceport/starmap.js';
import type { DiscoveryHooks } from './display/starmap_plugin.js';
import type { JumpVisual } from './display/jump_fade_plugin.js';
import type { GpuParticleSystem } from './display/gpu_particles.js';

declare global {
    interface Window {
        /** The player's ship entity (player_ship_plugin, shipyard, browser.ts). */
        myShip?: Entity;
        /**
         * Live display settings, e.g. `novaSettings.jumpVisual = 'fade'`
         * (jump_fade_plugin defines the property with a getter/setter).
         */
        novaSettings?: { jumpVisual?: JumpVisual };
        /** The comm dialog (hail_dialog_plugin). */
        novaHailDialog?: HailDialog;
        /** The galaxy map (starmap_plugin). */
        novaStarmap?: Starmap;
        /** The discovery record levers (starmap_plugin). */
        novaDiscovery?: DiscoveryHooks;
        /** The most recent mission offer popups (offer_popup). */
        novaOfferPopups?: OfferPopup[];
        /** Live particle budget counters (particles_plugin). */
        novaParticleStats?: () => ReturnType<GpuParticleSystem['stats']>;
    }
}

export {};
