// PixiJS's AccessibilityManager, switched off before the renderer exists.
//
// PIXI 7 registers it as a renderer plugin by default. It listens for Tab
// on the whole page, and the first Tab "activates" it: it lays a
// transparent DOM layer of <button>s over the canvas (one per interactive
// display object, z-index 2), which takes every click meant for the game
// until the mouse moves again (its own mousemove handler deactivates it).
// Tab is a game key here (next target, and the maps' cycle), so a Tab
// followed by a click without moving the mouse lost the click. Nothing in
// NovaJS uses the layer (no `accessible` / `accessibleTitle` anywhere): the
// dialogs that need real accessibility build their own DOM
// (title/title_dialogs.ts). On touch devices the manager also adds an
// off-screen focus hook button; removing the plugin drops that too.
import * as PIXI from 'pixi.js';

/**
 * Unregisters PIXI's AccessibilityManager renderer plugin, so renderers
 * created afterwards never install its Tab listener or its click-eating
 * overlay. Call it before creating the PIXI.Application. Idempotent.
 */
export function disablePixiAccessibility(): void {
    PIXI.extensions.remove(PIXI.AccessibilityManager);
}

/** Whether renderers created now would get the AccessibilityManager. */
export function pixiAccessibilityRegistered(): boolean {
    const plugins = (PIXI.Renderer as unknown as {
        __plugins: Record<string, unknown>,
    }).__plugins;
    return 'accessibility' in plugins;
}
