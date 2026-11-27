import 'jasmine';
import * as PIXI from 'pixi.js';
import { afterNextRender } from './after_render.js';

/**
 * afterNextRender resolves on the first frame that DRAWS a container — not
 * on the one that merely has it in the scene graph while hidden — or at
 * its timeout. No renderer exists under node, so the frames are driven by
 * calling Container.render by hand: a plain container's own _render draws
 * nothing, so an empty object stands in for the renderer.
 */
describe('afterNextRender', () => {
    // cast: Container.render only hands the renderer on to its children,
    // and none of these draws anything with it.
    const renderer = {} as PIXI.Renderer;

    async function flush() {
        for (let i = 0; i < 5; i++) {
            await Promise.resolve();
        }
    }

    function tracked(promise: Promise<void>) {
        const state = { settled: false };
        void promise.then(() => { state.settled = true; });
        return state;
    }

    it('waits for a frame that draws the container', async () => {
        const stage = new PIXI.Container();
        const venue = new PIXI.Container();
        stage.addChild(venue);
        const drawn = tracked(afterNextRender(venue, 60_000));
        await flush();
        expect(drawn.settled).toBeFalse();
        stage.render(renderer);
        await flush();
        expect(drawn.settled).toBeTrue();
    });

    it('does not count a frame in which the container is hidden', async () => {
        const stage = new PIXI.Container();
        const venue = new PIXI.Container();
        venue.visible = false;
        stage.addChild(venue);
        const drawn = tracked(afterNextRender(venue, 60_000));
        stage.render(renderer);
        await flush();
        expect(drawn.settled).withContext('venue hidden').toBeFalse();
        // Nor one whose PARENT is hidden (the spaceport behind it).
        venue.visible = true;
        stage.visible = false;
        stage.render(renderer);
        await flush();
        expect(drawn.settled).withContext('stage hidden').toBeFalse();
        stage.visible = true;
        stage.render(renderer);
        await flush();
        expect(drawn.settled).toBeTrue();
    });

    it('takes its sentinel out after the frame, without upsetting the '
        + 'siblings drawn after it', async () => {
        const venue = new PIXI.Container();
        const before = new PIXI.Container();
        venue.addChild(before);
        const drawn = afterNextRender(venue, 60_000);
        // A child added after the sentinel (a dialog opened meanwhile):
        // the render loop must still reach it, and only it.
        const after = new PIXI.Container();
        const renderAfter = spyOn(after, 'render').and.callThrough();
        venue.addChild(after);
        expect(venue.children.length).toBe(3);
        venue.render(renderer);
        expect(renderAfter).toHaveBeenCalledTimes(1);
        await drawn;
        await flush();
        expect(venue.children).toEqual([before, after]);
    });

    it('gives up at the timeout when nothing draws', async () => {
        const venue = new PIXI.Container();
        const start = Date.now();
        await afterNextRender(venue, 20);
        expect(Date.now() - start).toBeGreaterThanOrEqual(15);
        await flush();
        expect(venue.children.length).toBe(0);
    });

    it('resolves at once for a destroyed container', async () => {
        const venue = new PIXI.Container();
        venue.destroy();
        await afterNextRender(venue, 60_000);
    });
});
