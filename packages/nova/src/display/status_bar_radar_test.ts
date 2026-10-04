import 'jasmine';
import { getDefaultStatusBarData } from 'novadatainterface/status_bar_data';
import { Entity } from 'nova_ecs/entity';
import { Position } from 'nova_ecs/datatypes/position';
import { MovementState, MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { Vector } from 'nova_ecs/datatypes/vector';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { SimulationGameDataResource } from '../nova_plugin/core/index.js';
import { PlayerShipSelector } from '../nova_plugin/player/index.js';
import { TargetComponent } from '../nova_plugin/ship/index.js';
import { SimulationTimeResource } from './simulation_time.js';
import { StatusBar } from './status_bar.js';
import {
    blipPixels, centerArrowPixels, CENTER_ARROW_HEAD, CENTER_ARROW_TAIL,
    CENTER_ARROW_TIP, DrawRadar, linePixels, RadarPane, radarBlinkOn,
    radarCenterPixel, radarRefreshIndex, RADAR_REFRESH_MS, shipBlipSize,
    stellarHullSize, stellarRadarShape, STELLAR_RING_PIXELS,
} from './status_bar_radar.js';
import { StatusBarResource } from './status_bar_resource.js';

const STOCK: [number, number] = [176, 176];

function key([x, y]: readonly [number, number]) {
    return `${x},${y}`;
}

describe('radar refresh clock (#358: the original redraws at 4 Hz)', () => {
    it('is a 250 ms quantum', () => {
        expect(RADAR_REFRESH_MS).toBe(250);
    });

    it('holds the same refresh for the whole quantum and changes only on '
        + 'its boundary', () => {
        expect(radarRefreshIndex(0)).toBe(0);
        expect(radarRefreshIndex(16)).toBe(0);
        expect(radarRefreshIndex(249.9)).toBe(0);
        expect(radarRefreshIndex(250)).toBe(1);
        expect(radarRefreshIndex(499)).toBe(1);
        expect(radarRefreshIndex(500)).toBe(2);
        // The display world's clock is epoch ms: still whole quanta.
        const t = 1_790_000_000_125;
        expect(radarRefreshIndex(t + 124)).toBe(radarRefreshIndex(t));
        expect(radarRefreshIndex(t + 125)).toBe(radarRefreshIndex(t) + 1);
    });

    it('blinks one refresh on, one off: a 500 ms period', () => {
        const phases = [0, 1, 2, 3, 4, 5].map(radarBlinkOn);
        expect(phases).toEqual([true, false, true, false, true, false]);
        // Every display frame of one quantum agrees.
        for (let t = 500; t < 750; t += 1000 / 60) {
            expect(radarBlinkOn(radarRefreshIndex(t))).toBeTrue();
        }
        for (let t = 750; t < 1000; t += 1000 / 60) {
            expect(radarBlinkOn(radarRefreshIndex(t))).toBeFalse();
        }
        expect(radarBlinkOn(-1)).toBeFalse();
    });
});

describe('centerArrowPixels (the original\'s thin grey line arrow)', () => {
    it('pins the fitted fractions of the radar half-size', () => {
        // Fitted over 22 frames on the original's 176 px radar.
        expect(CENTER_ARROW_TAIL * 88).toBeCloseTo(27, 10);
        expect(CENTER_ARROW_TIP * 88).toBeCloseTo(51, 10);
        expect(CENTER_ARROW_HEAD * 88).toBeCloseTo(5, 10);
    });

    it('is a radial shaft from the tail radius to the tip radius', () => {
        const pixels = centerArrowPixels(-1, 0, STOCK);
        const [cx, cy] = radarCenterPixel(STOCK);
        expect([cx, cy]).toEqual([88, 88]);
        const set = new Set(pixels.map(key));
        // Pointing left (toward the system centre at -x): the shaft runs
        // along the centre row from 27 px out to 51 px out.
        for (let x = cx - 51; x <= cx - 27; x++) {
            expect(set.has(key([x, cy]))).withContext(`shaft x=${x}`).toBeTrue();
        }
        // Nothing nearer the player's dot than the tail, nothing past the tip.
        for (const [x, y] of pixels) {
            const r = Math.hypot(x - cx, y - cy);
            expect(r).toBeGreaterThanOrEqual(27);
            expect(r).toBeLessThanOrEqual(51);
        }
        expect(set.has(key([cx - 26, cy]))).toBeFalse();
        expect(set.has(key([cx - 52, cy]))).toBeFalse();
    });

    it('has an open two-stroke chevron head at 45° back from the tip', () => {
        const pixels = centerArrowPixels(-1, 0, STOCK);
        const set = new Set(pixels.map(key));
        const tip: [number, number] = [88 - 51, 88];
        // Each stroke: 5 px back along the shaft rotated ±45°, i.e. to
        // (tip + round(3.54), tip ± round(3.54)).
        for (const p of linePixels(tip[0], tip[1], tip[0] + 4, tip[1] - 4)) {
            expect(set.has(key(p))).withContext(`upper stroke ${p}`).toBeTrue();
        }
        for (const p of linePixels(tip[0], tip[1], tip[0] + 4, tip[1] + 4)) {
            expect(set.has(key(p))).withContext(`lower stroke ${p}`).toBeTrue();
        }
        // Open, not filled: the pixel between the strokes and the shaft
        // just behind the tip stays dark.
        expect(set.has(key([tip[0] + 2, tip[1] - 1]))).toBeFalse();
        expect(set.has(key([tip[0] + 2, tip[1] + 1]))).toBeFalse();
        // Shaft (25) + two 4-pixel strokes (sharing the tip) = 33 pixels.
        expect(pixels.length).toBe(33);
    });

    it('is whole, unique, one-pixel-wide pixels at any bearing', () => {
        for (let deg = 0; deg < 360; deg += 7) {
            const a = deg * Math.PI / 180;
            const pixels = centerArrowPixels(Math.cos(a), Math.sin(a), STOCK);
            expect(pixels.length).toBeGreaterThan(20);
            const keys = pixels.map(key);
            expect(new Set(keys).size).toBe(keys.length);
            for (const [x, y] of pixels) {
                expect(Number.isInteger(x) && Number.isInteger(y)).toBeTrue();
            }
            // The tip is the pixel farthest out, along the bearing.
            const far = pixels.reduce((a, b) => Math.hypot(b[0] - 88, b[1] - 88)
                > Math.hypot(a[0] - 88, a[1] - 88) ? b : a);
            const bearing = Math.atan2(far[1] - 88, far[0] - 88);
            const err = Math.abs(((bearing - a + 3 * Math.PI) % (2 * Math.PI))
                - Math.PI);
            expect(err).withContext(`bearing ${deg}`).toBeLessThan(0.04);
        }
    });

    it('matches a fitted original frame (bearing -153.4°, frame 734)', () => {
        // The original drew its tail at (-24, -12) and tip at (-46, -23)
        // from the centre dot for this bearing.
        const a = -153.4 * Math.PI / 180;
        const pixels = centerArrowPixels(Math.cos(a), Math.sin(a), STOCK);
        const set = new Set(pixels.map(key));
        expect(set.has(key([88 - 24, 88 - 12]))).toBeTrue();
        expect(set.has(key([88 - 46, 88 - 23]))).toBeTrue();
    });

    it('scales with the radar for a non-stock ïntf (#205)', () => {
        const big = centerArrowPixels(-1, 0, [352, 300]);
        const xs = big.map(([x]) => x);
        // Half-size is min(352, 300) / 2 = 150; centre (176, 150).
        expect(Math.min(...xs)).toBe(176 - Math.round(150 * 51 / 88));
        expect(Math.max(...xs)).toBe(176 - Math.round(150 * 27 / 88));
    });

    it('draws nothing for a zero direction', () => {
        expect(centerArrowPixels(0, 0, STOCK)).toEqual([]);
    });
});

describe('radar blip sizes (density scanner, oütf ModType 13)', () => {
    it('is one pixel for every ship without a density scanner', () => {
        for (const mass of [1, 15, 99, 100, 2000, 10000, undefined]) {
            expect(shipBlipSize(mass, false)).toBe(1);
        }
    });

    it('is 2 x 2 for 100 tons and up with one (EVN Bible, shïp Mass)', () => {
        expect(shipBlipSize(99, true)).toBe(1);
        expect(shipBlipSize(100, true)).toBe(2);
        expect(shipBlipSize(255, true)).toBe(2);
        expect(shipBlipSize(10000, true)).toBe(2);
        expect(blipPixels(2).map(key)).toEqual(['0,0', '1,0', '0,1', '1,1']);
    });
});

describe('stellar radar shape', () => {
    it('rings planet-sized stellars and dots small ones', () => {
        expect(stellarRadarShape(40)).toBe('dot');   // Europa
        expect(stellarRadarShape(48)).toBe('dot');   // Kolan, Mars
        expect(stellarRadarShape(60)).toBe('dot');   // destroyed hypergate
        expect(stellarRadarShape(110)).toBe('ring'); // Kiniké
        expect(stellarRadarShape(120)).toBe('ring'); // Ryll
        expect(stellarRadarShape(323)).toBe('ring'); // Jupiter
        expect(stellarRadarShape(undefined)).toBe('ring');
    });

    it('reads the size off the frame-0 collision hull', () => {
        expect(stellarHullSize([[[[-26.5, -30], [26.5, -30], [26.5, 30]]]]))
            .toBe(60);
        expect(stellarHullSize(undefined)).toBeUndefined();
        expect(stellarHullSize([])).toBeUndefined();
    });

    it('is a hollow 5 x 5 ring with its corners cut', () => {
        expect(STELLAR_RING_PIXELS.length).toBe(12);
        const set = new Set(STELLAR_RING_PIXELS.map(key));
        for (const corner of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) {
            expect(set.has(key(corner))).toBeFalse();
        }
        for (let y = -1; y <= 1; y++) {
            for (let x = -1; x <= 1; x++) {
                expect(set.has(key([x, y]))).toBeFalse();
            }
        }
    });
});

/**
 * A stand-in for the radar's PIXI.Graphics (node has no canvas to build a
 * real one) recording the rects filled since the last clear(), by colour.
 */
class RecordingGraphics {
    readonly position = { x: 0, y: 0 };
    private color = -1;
    rects = new Map<number, Set<string>>();
    clear() { this.rects = new Map(); return this; }
    beginFill(color: number) { this.color = color; return this; }
    endFill() { this.color = -1; return this; }
    drawRect(x: number, y: number, w: number, h: number) {
        const set = this.rects.get(this.color) ?? new Set<string>();
        for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
                set.add(`${x + i},${y + j}`);
            }
        }
        this.rects.set(this.color, set);
        return this;
    }
}

function drawnRects(pane: RadarPane): Map<number, Set<string>> {
    return (pane.graphics as unknown as RecordingGraphics).rects;
}

function recordingPane(data: ReturnType<typeof getDefaultStatusBarData>) {
    return new RadarPane(data,
        new RecordingGraphics() as unknown as RadarPane['graphics']);
}

describe('RadarPane.drawRadar', () => {
    const data = getDefaultStatusBarData();
    const here = new Position(0, 0);
    const state = (x: number, y: number) =>
        ({ position: new Position(x, y) }) as MovementState;

    it('draws the centre arrow in the dimRadar grey, pixel for pixel', () => {
        const pane = recordingPane(data);
        pane.drawRadar(here, [], [], undefined, { x: -1, y: 0 });
        const rects = drawnRects(pane);
        const grey = rects.get(data.colors.dimRadar);
        expect(grey).toBeDefined();
        expect([...grey!].sort())
            .toEqual(centerArrowPixels(-1, 0, data.dataAreas.radar.size)
                .map(key).sort());
        // The player's own dot stays the bright colour at the centre.
        expect([...rects.get(data.colors.brightRadar)!]).toEqual(['88,88']);
    });

    it('sizes ship blips and flashes the target at its own size', () => {
        const pane = recordingPane(data);
        const ships = [['a', state(600, 0)], ['b', state(0, 600)]] as const;
        pane.drawRadar(here, ships, [], undefined, null, 'b', undefined,
            new Map([['a', 2], ['b', 2]]));
        const rects = drawnRects(pane);
        // 600 world units = 17.6 px on the stock radar; snapped down.
        expect([...rects.get(data.colors.dimRadar)!].sort())
            .toEqual(['105,88', '105,89', '106,88', '106,89']);
        expect([...rects.get(data.colors.brightRadar)!].sort())
            .toEqual(['88,105', '88,106', '88,88', '89,105', '89,106']);
    });

    it('rings large stellars and dots small ones', () => {
        const pane = recordingPane(data);
        const planets = [
            ['big', state(-1200, 0)], ['small', state(1200, 0)],
        ] as unknown as Parameters<RadarPane['drawRadar']>[2];
        pane.drawRadar(here, [], planets, undefined, null, null,
            new Map([['big', 0x111111], ['small', 0x222222]]), undefined,
            new Map([['big', 'ring'], ['small', 'dot']] as const));
        const rects = drawnRects(pane);
        // -1200 world units = -35.2 px -> pixel 52.
        expect([...rects.get(0x111111)!].sort()).toEqual(
            STELLAR_RING_PIXELS.map(([x, y]) => key([52 + x, 88 + y])).sort());
        expect([...rects.get(0x222222)!].sort())
            .toEqual(['123,88', '123,89', '124,88', '124,89']);
    });
});

describe('DrawRadar cadence', () => {
    const gameData = {
        data: {
            Outfit: { getCached: () => undefined },
            Govt: { getCached: () => undefined },
            SpriteSheet: {
                getCached: () => undefined,
                get: () => Promise.resolve(undefined),
            },
        },
    } as unknown as SimulationGameDataInterface;

    function radarWorld() {
        const world = new World('radar cadence test');
        const time = { time: 0, delta_ms: 16, delta_s: 0.016 };
        world.resources.set(TimeResource, time as never);
        world.resources.set(SimulationTimeResource, time as never);
        world.resources.set(SimulationGameDataResource, gameData);
        const drawRadar = jasmine.createSpy('drawRadar');
        world.resources.set(StatusBarResource, {
            radar: { drawRadar, range: new Vector(3000, 3000) },
        } as unknown as StatusBar);
        world.addSystem(DrawRadar);
        const player = new Entity('player');
        player.components.set(PlayerShipSelector, undefined);
        // Far out: nothing stellar anywhere, so the arrow's gate holds.
        player.components.set(MovementStateComponent,
            { position: new Position(-9000, 2000) } as MovementState);
        player.components.set(TargetComponent, { target: 'npc' });
        world.entities.set('player', player);
        const stepAt = (ms: number) => {
            time.time = ms;
            world.step();
        };
        return { drawRadar, stepAt };
    }

    it('redraws once per 250 ms refresh, on the boundary, from the display '
        + 'clock', () => {
        const { drawRadar, stepAt } = radarWorld();
        const frames: number[] = [];
        for (let t = 0; t < 1000; t += 1000 / 60) {
            frames.push(t);
        }
        const drawnAt: number[] = [];
        for (const t of frames) {
            const before = drawRadar.calls.count();
            stepAt(t);
            if (drawRadar.calls.count() > before) {
                drawnAt.push(radarRefreshIndex(t));
            }
        }
        expect(drawnAt).toEqual([0, 1, 2, 3]);
    });

    it('passes the arrow and the target flash on alternate refreshes only',
        () => {
            const { drawRadar, stepAt } = radarWorld();
            for (const t of [0, 100, 250, 400, 500, 600, 750]) {
                stepAt(t);
            }
            const calls = drawRadar.calls.allArgs();
            expect(calls.length).toBe(4);
            const arrows = calls.map(args => args[4]);
            const flashes = calls.map(args => args[5]);
            expect(arrows.map(a => a !== null)).toEqual([true, false, true, false]);
            expect(flashes).toEqual(['npc', null, 'npc', null]);
            // Pointing from the player back to (0, 0).
            expect(arrows[0]).toEqual({ x: 9000, y: -2000 });
        });
});
