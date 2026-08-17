import "jasmine";
import * as PIXI from "pixi.js";
import { computeHypergateSystemLinks, representativeSystems } from "./starmap.js";
import {
    clickRadiusWorld, DragTracker, nearestTargetIndex, screenToWorld,
} from "./starmap_hit.js";

describe('computeHypergateSystemLinks', () => {
    it('links the systems containing linked hypergates', () => {
        // Gate spöb A in system SA links to gate spöb B in system SB.
        const systemOfSpob = new Map([
            ['spobA', 'SA'],
            ['spobB', 'SB'],
        ]);
        const gateDestinations = new Map([
            ['spobA', ['spobB']],
            ['spobB', ['spobA']],
        ]);
        const links = computeHypergateSystemLinks(systemOfSpob, gateDestinations);
        expect(links).toContain(['SA', 'SB']);
        expect(links).toContain(['SB', 'SA']);
    });

    it('drops links to spöbs not in any known system', () => {
        const systemOfSpob = new Map([['spobA', 'SA']]);
        const gateDestinations = new Map([['spobA', ['spobMissing']]]);
        expect(computeHypergateSystemLinks(systemOfSpob, gateDestinations))
            .toEqual([]);
    });

    it('ignores spöbs with no gate destinations', () => {
        const systemOfSpob = new Map([['spobA', 'SA'], ['spobB', 'SB']]);
        // Only non-hypergate/absent spöbs => no gate links.
        const gateDestinations = new Map<string, string[]>();
        expect(computeHypergateSystemLinks(systemOfSpob, gateDestinations))
            .toEqual([]);
    });
});

describe('representativeSystems (one clickable system per map spot)', () => {
    // Two copies of Sol stacked at (0,0), as the stock data has them
    // (nova:130 and nova:531), plus a neighbour.
    const sol = { id: 'nova:130', position: [0, 0] as [number, number] };
    const otherSol = { id: 'nova:531', position: [0, 0] as [number, number] };
    const tichel = { id: 'nova:129', position: [110, 40] as [number, number] };

    it('represents a spot with the system the player is IN', () => {
        // Bits can make the player's own copy the hidden one, but clicking
        // the spot you are standing in must never pin a DIFFERENT id: the
        // route would then lead out and back into the same place.
        const picked = representativeSystems([otherSol, sol, tichel],
            'nova:130', id => id !== 'nova:130');
        expect(picked.map(s => s.id)).toContain('nova:130');
        expect(picked.map(s => s.id)).not.toContain('nova:531');
    });

    it('otherwise prefers a system reachable from the current one', () => {
        const picked = representativeSystems([otherSol, sol, tichel],
            'nova:129', id => id === 'nova:130');
        expect(picked.map(s => s.id)).toContain('nova:130');
        expect(picked.map(s => s.id)).not.toContain('nova:531');
    });

    it('keeps one system per distinct spot', () => {
        const picked = representativeSystems([sol, otherSol, tichel],
            'nova:129', () => false);
        expect(picked.length).toEqual(2);
    });
});

/**
 * Drives the map's pointer pipeline through PIXI's real EventBoundary — the
 * same event delivery and pointertap synthesis the browser uses — wired to the
 * production DragTracker and hit-resolution helpers exactly as SystemGraph
 * wires them. This is the headless reproduction of the "swallowed first click"
 * bug and its regression guard: PIXI fires a pointertap for a pointerdown ->
 * pointerup on the same target no matter how far the pointer moved in between,
 * so the click-vs-drag decision (and thus this reliability) is entirely the
 * DragTracker's job.
 */
describe('starmap pointer pipeline (via PIXI EventBoundary)', () => {
    // The map pane and dot geometry from starmap.ts.
    const PANE = { x: 456, y: 419 };
    const SYSTEM_RADIUS = 5.4;
    const CLICK_RADIUS = 12;

    // A cluster of systems (world / laid-out coords) around the origin, close
    // enough that they all stay inside the pane at every tested zoom.
    const targets = [
        { id: 'Sol', x: 0, y: 0 },
        { id: 'Vega', x: 40, y: -30 },
        { id: 'Rigel', x: -35, y: 25 },
        { id: 'Deneb', x: 30, y: 35 },
        { id: 'Altair', x: -40, y: -35 },
    ];

    /** A container wired for pointer events exactly like SystemGraph. */
    function makeMap() {
        const stage = new PIXI.Container();
        const container = new PIXI.Container();
        container.eventMode = 'static';
        container.hitArea = new PIXI.Rectangle(0, 0, PANE.x, PANE.y);
        stage.addChild(container);

        const drag = new DragTracker();
        // The map container's pan (screen px) and zoom, mutated by drags/zoom.
        const pan = { x: PANE.x / 2, y: PANE.y / 2 };
        let zoom = 1;
        const selections: { id: string, shift: boolean }[] = [];

        container.on('pointerdown',
            e => drag.down(e.pointerId, e.global.x, e.global.y));
        container.on('pointermove', e => {
            const d = drag.move(e.pointerId, e.global.x, e.global.y);
            if (d) {
                pan.x += d.dx;
                pan.y += d.dy;
            }
        });
        container.on('pointerup', e => drag.up(e.pointerId));
        container.on('pointerupoutside', e => drag.up(e.pointerId));
        container.on('pointertap', e => {
            if (drag.dragged) {
                return;
            }
            const [wx, wy] =
                screenToWorld(e.global.x, e.global.y, pan.x, pan.y, zoom);
            const r = clickRadiusWorld(zoom, SYSTEM_RADIUS, CLICK_RADIUS);
            const i = nearestTargetIndex(targets, wx, wy, r);
            if (i >= 0) {
                selections.push({ id: targets[i].id, shift: e.shiftKey });
            }
        });

        const boundary = new PIXI.EventBoundary(stage);
        const fire = (type: string, x: number, y: number, shift = false) => {
            const e = new PIXI.FederatedPointerEvent(boundary);
            e.type = type;
            e.pointerId = 1;
            e.pointerType = 'mouse';
            e.button = 0;
            e.buttons = type === 'pointerup' ? 0 : 1;
            e.isPrimary = true;
            e.shiftKey = shift;
            e.global.set(x, y);
            e.screen = new PIXI.Point(x, y);
            boundary.mapEvent(e);
        };
        const screenOf = (t: { x: number, y: number }): [number, number] =>
            [t.x * zoom + pan.x, t.y * zoom + pan.y];

        return {
            selections,
            setZoom: (z: number) => { zoom = z; },
            fire,
            screenOf,
            // A single physical click with a pixel of jitter (the sequence
            // that used to be swallowed).
            clickWithJitter(t: { x: number, y: number }, shift = false) {
                const [sx, sy] = screenOf(t);
                fire('pointerdown', sx, sy, shift);
                fire('pointermove', sx + 1, sy, shift);
                fire('pointerup', sx + 1, sy, shift);
            },
        };
    }

    it('registers a jittery single click exactly once (the regression)', () => {
        const map = makeMap();
        map.clickWithJitter(targets[1]);
        expect(map.selections).toEqual([{ id: 'Vega', shift: false }]);
    });

    it('registers N consecutive jittery clicks on N systems, one each', () => {
        const map = makeMap();
        for (const t of targets) {
            map.clickWithJitter(t);
        }
        expect(map.selections.map(s => s.id))
            .toEqual(targets.map(t => t.id));
    });

    it('registers every click across zoom levels', () => {
        for (const zoom of [0.3, 0.5, 1, 2, 4]) {
            const map = makeMap();
            map.setZoom(zoom);
            for (const t of targets) {
                map.clickWithJitter(t);
            }
            expect(map.selections.map(s => s.id))
                .withContext(`zoom ${zoom}`)
                .toEqual(targets.map(t => t.id));
        }
    });

    it('still registers clicks immediately after a drag-to-pan', () => {
        const map = makeMap();
        // A real drag: well past the deadzone, in two steps.
        map.fire('pointerdown', 250, 250);
        map.fire('pointermove', 300, 250);
        map.fire('pointermove', 330, 280);
        map.fire('pointerup', 330, 280);
        // The drag itself must not have selected anything.
        expect(map.selections).toEqual([]);
        // Clicks right after the pan (now that the view moved) still land.
        for (const t of targets) {
            map.clickWithJitter(t);
        }
        expect(map.selections.map(s => s.id)).toEqual(targets.map(t => t.id));
    });

    it('does not select at the end of a real drag', () => {
        const map = makeMap();
        const [sx, sy] = map.screenOf(targets[0]);
        // Press on a system, drag far away, release: this is a pan, not a
        // click, even though it started on a dot.
        map.fire('pointerdown', sx, sy);
        map.fire('pointermove', sx + 60, sy + 10);
        map.fire('pointerup', sx + 60, sy + 10);
        expect(map.selections).toEqual([]);
    });

    it('carries the shift modifier through for shift-click pinning', () => {
        const map = makeMap();
        map.clickWithJitter(targets[2], /* shift */ true);
        expect(map.selections).toEqual([{ id: 'Rigel', shift: true }]);
    });

    it('registers a click on a freshly reopened map (new tracker)', () => {
        // Reopening the map builds fresh pointer state; a click that lands
        // immediately, jitter and all, must still register.
        const reopened = makeMap();
        reopened.clickWithJitter(targets[3]);
        expect(reopened.selections).toEqual([{ id: 'Deneb', shift: false }]);
    });

    it('registers 50/50 scripted jittery clicks (reliability sweep)', () => {
        // Ten passes over the five systems at varied zooms: every one of the
        // fifty single clicks must register exactly once.
        let total = 0;
        const zooms = [0.5, 1, 2];
        for (let pass = 0; pass < 10; pass++) {
            const map = makeMap();
            map.setZoom(zooms[pass % zooms.length]);
            for (const t of targets) {
                map.clickWithJitter(t);
            }
            expect(map.selections.length).withContext(`pass ${pass}`).toBe(5);
            total += map.selections.length;
        }
        expect(total).toBe(50);
    });
});
