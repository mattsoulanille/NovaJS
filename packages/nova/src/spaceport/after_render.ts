import * as PIXI from 'pixi.js';

/**
 * Resolves once `container` has been DRAWN: the first time the renderer
 * walks into it while it is on screen (visible, renderable, not faded out,
 * and so is everything above it), or after `timeoutMs`, whichever comes
 * first.
 *
 * WHY. Making a container visible draws nothing by itself; the app's
 * ticker renders the stage on the next animation frame. Something that has
 * to appear OVER a screen that is already up — the mission offer a venue
 * makes as the player walks in (Spaceport.openVenue), which the original
 * draws over the shipyard, not over the spaceport the player walked in
 * from — waits on this, so the screen is drawn on its own at least once
 * before the popup joins it.
 *
 * HOW. A childless sentinel container is added to `container`. PIXI's
 * Container.render returns early for an invisible (or unrenderable, or
 * zero-alpha) container before it touches its children, so the
 * sentinel's render() is reached only from a frame that draws
 * `container`; it removes itself and resolves there. The caller's
 * continuation runs as a microtask after that render call returns, so the
 * whole frame has been drawn by then and whatever the caller shows next
 * appears from the following frame.
 *
 * The timeout is the safety net: no renderer at all (the specs, under
 * node), a container torn down before it was ever drawn, or a window so
 * throttled the ticker does not run. A second, like afterSimulationFrames.
 */
export function afterNextRender(container: PIXI.Container,
    timeoutMs = 1000): Promise<void> {
    return new Promise(resolve => {
        if (container.destroyed) {
            resolve();
            return;
        }
        const sentinel = new RenderSentinel();
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            sentinel.onRender = undefined;
            // Removed AFTER the render call that reached it returns: the
            // parent's render loop indexes its children with a length it
            // read before the loop, so taking a child out mid-loop would
            // skip the next sibling and run off the end.
            void Promise.resolve().then(() => {
                if (!sentinel.destroyed) {
                    sentinel.destroy();
                }
            });
            resolve();
        };
        sentinel.onRender = finish;
        container.addChild(sentinel);
        timer = setTimeout(finish, timeoutMs);
    });
}

/** An empty container that reports the first frame that draws it. */
class RenderSentinel extends PIXI.Container {
    onRender?: () => void;

    constructor() {
        super();
        this.name = 'RenderSentinel';
    }

    override render(renderer: PIXI.Renderer) {
        super.render(renderer);
        this.onRender?.();
    }
}
