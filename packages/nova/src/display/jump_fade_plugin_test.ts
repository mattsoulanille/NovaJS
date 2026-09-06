import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { TimePlugin } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import * as PIXI from 'pixi.js';
import { FinishJumpEvent } from '../nova_plugin/jump_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin.js';
import { installHeadlessPixi } from '../spaceport/headless_pixi_fixture.js';
import { JumpFadePlugin, resetJumpFade } from './jump_fade_plugin.js';
import { PixiAppResource } from './pixi_app_resource.js';

/**
 * The white-out overlay is owned by the PIXI app's root stage, not by any
 * display world, so it outlives the world that made it: a session that
 * exits to the title mid-jump leaves it up, and resetJumpFade (called from
 * browser.ts's teardownGame) is what takes it down (issue #30). Headless:
 * the app is a bare stage with a screen size; nothing is rendered (the
 * fixture's stub canvas only lets a PIXI.Graphics be constructed).
 */
describe('resetJumpFade', () => {
    beforeAll(() => installHeadlessPixi());

    const OVERLAY_NAME = 'JumpFadeOverlay';

    /** An app with the two things the plugin reads: a stage and a screen. */
    function app() {
        return {
            stage: new PIXI.Container(),
            screen: { width: 800, height: 600 },
        } as unknown as PIXI.Application;
    }
    const overlayOn = (a: PIXI.Application) =>
        a.stage.getChildByName(OVERLAY_NAME) as PIXI.Graphics | null;

    /**
     * A session that jumped and died mid-jump: the display world built the
     * overlay on `a`'s stage, the local player's departure turned it full
     * white, and the world was torn down before any destination world
     * could clear it.
     */
    async function whiteScreen(a: PIXI.Application) {
        const world = new World();
        world.resources.set(PixiAppResource, a);
        await world.addPlugin(TimePlugin);
        await world.addPlugin(JumpFadePlugin);
        world.emit(FinishJumpEvent, {
            entity: new Entity().addComponent(PlayerShipSelector, undefined),
            uuid: 'player', to: 'nova:129',
        });
        await world.removePlugin(JumpFadePlugin);
        const overlay = overlayOn(a);
        expect(overlay).withContext('the overlay outlived its world')
            .not.toBeNull();
        expect(overlay!.alpha).toBe(1);
        expect(overlay!.visible).toBe(true);
        return overlay!;
    }

    it('clears the white-out and takes the overlay off the stage', async () => {
        const a = app();
        const overlay = await whiteScreen(a);
        resetJumpFade(a);
        expect(overlayOn(a)).toBeNull();
        expect(a.stage.children).not.toContain(overlay);
        // Cleared too, so a stale handle could not show white again.
        expect(overlay.alpha).toBe(0);
        expect(overlay.visible).toBe(false);
    });

    it('is a no-op on an app whose session never jumped', () => {
        const a = app();
        const bystander = new PIXI.Container();
        a.stage.addChild(bystander);
        expect(() => resetJumpFade(a)).not.toThrow();
        expect(a.stage.children).toEqual([bystander]);
    });

    it('is idempotent: a second reset finds nothing and changes nothing',
        async () => {
            const a = app();
            const bystander = new PIXI.Container();
            a.stage.addChild(bystander);
            await whiteScreen(a);
            resetJumpFade(a);
            expect(() => resetJumpFade(a)).not.toThrow();
            expect(a.stage.children).toEqual([bystander]);
        });

    it('leaves the next session starting with no overlay at all', async () => {
        // The stage, not module state, is the overlay's home: after a reset
        // a new world builds a fresh one rather than reviving the old.
        const a = app();
        const first = await whiteScreen(a);
        resetJumpFade(a);
        const second = await whiteScreen(a);
        expect(second).not.toBe(first);
        expect(a.stage.children.filter(c => c.name === OVERLAY_NAME).length)
            .toBe(1);
        resetJumpFade(a);
        expect(overlayOn(a)).toBeNull();
    });
});
