import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { getDefaultStatusBarData } from 'novadatainterface/status_bar_data';
import { Entity } from 'nova_ecs/entity';
import { Position } from 'nova_ecs/datatypes/position';
import { MovementState, MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { requireNovaData } from '../test_support/nova_data_gate.js';
import { styleForTarget } from '../nova_plugin/combat/index.js';
import {
    GovtComponent, SimulationGameDataResource, SystemIdResource,
} from '../nova_plugin/core/index.js';
import { FormationComponent, NpcComponent } from '../nova_plugin/npc/index.js';
import { PlayerShipSelector } from '../nova_plugin/player/index.js';
import {
    IFF_FRIENDLY_COLOR, IFF_HOSTILE_COLOR, IFF_NEUTRAL_COLOR, LegalRecordsComponent,
} from '../nova_plugin/reputation/index.js';
import {
    OutfitsStateComponent, ShipDataComponent, TargetComponent,
} from '../nova_plugin/ship/index.js';
import {
    PlanetComponent, PlanetDataComponent,
} from '../nova_plugin/travel/index.js';
import { SimulationTimeResource } from './simulation_time.js';
import { StatusBar } from './status_bar.js';
import {
    blipPixels, centerArrowPixels, centerArrowShown, CENTER_ARROW_HEAD,
    CENTER_ARROW_RADIUS, CENTER_ARROW_TAIL, CENTER_ARROW_TIP, DrawRadar, linePixels, RadarPane, radarBlinkOn,
    radarCenterPixel, radarRefreshIndex, RADAR_REFRESH_MS, shipBlipSize,
    planetRadarShape, stellarRadarShape, stellarRadarSize,
    STELLAR_RING_MIN_SIZE, STELLAR_RING_PIXELS,
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

describe('centerArrowShown (reference K8, waves 43-44)', () => {
    it('gates on the distance to the centre: a circle of 2,404-2,650 px '
        + '(reference "The centre arrow\'s onset (K8 leftover), wave 44")',
        () => {
            expect(CENTER_ARROW_RADIUS).toBeGreaterThan(2404);
            expect(CENTER_ARROW_RADIUS).toBeLessThan(2650);
            expect(centerArrowShown({ x: 0, y: 0 })).toBeFalse();
            // The axis starts: shown at 2,650 / 2,750 / 2,850, not at
            // 2,400 / 2,200 / 2,000 / 1,700.
            for (const x of [2650, 2750, 2850]) {
                expect(centerArrowShown({ x: -x, y: 0 })).withContext(`${x}`)
                    .toBeTrue();
            }
            for (const x of [2400, 2200, 2000, 1700]) {
                expect(centerArrowShown({ x: -x, y: 0 })).withContext(`${x}`)
                    .toBeFalse();
            }
            // The diagonal: (2000, 2000) is 2,828 px out and shows,
            // though neither axis passes 2,400; (1700, 1700) is 2,404 px
            // out and does not.
            expect(centerArrowShown({ x: -2300, y: -2300 })).toBeTrue();
            expect(centerArrowShown({ x: -2000, y: -2000 })).toBeTrue();
            expect(centerArrowShown({ x: -1700, y: -1700 })).toBeFalse();
            expect(centerArrowShown({ x: 0, y: -CENTER_ARROW_RADIUS }))
                .toBeFalse();
            expect(centerArrowShown({ x: 0, y: CENTER_ARROW_RADIUS + 1 }))
                .toBeTrue();
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
    it('rings planet-sized planets and dots small ones', () => {
        expect(stellarRadarShape(40, false)).toBe('dot');   // Europa
        expect(stellarRadarShape(48, false)).toBe('dot');   // Kolan, Mars
        expect(stellarRadarShape(60, false)).toBe('dot');   // gate art
        expect(stellarRadarShape(110, false)).toBe('ring'); // Kiniké
        expect(stellarRadarShape(120, false)).toBe('ring'); // Ryll
        expect(stellarRadarShape(323, false)).toBe('ring'); // Jupiter
        expect(stellarRadarShape(undefined, false)).toBe('ring');
    });

    it('rings a planet from 96 px: the K8 kit planets (wave 22)', () => {
        expect(STELLAR_RING_MIN_SIZE).toBe(96);
        expect(stellarRadarShape(72, false)).toBe('dot');   // spïn 2006
        expect(stellarRadarShape(87, false)).toBe('dot');   // spïn 2019
        expect(stellarRadarShape(88, false)).toBe('dot');   // spïn 2024
        // GUESS: the unmeasured 89-95 px gap is dots.
        expect(stellarRadarShape(95, false)).toBe('dot');
        expect(stellarRadarShape(96, false)).toBe('ring');  // spïn 2026
        expect(stellarRadarShape(104, false)).toBe('ring'); // spïn 2017
        expect(stellarRadarShape(150, false)).toBe('ring'); // spïn 2001
    });

    it('dots every station whatever its size (K8, wave 22)', () => {
        expect(stellarRadarShape(72, true)).toBe('dot');
        expect(stellarRadarShape(104, true)).toBe('dot');
        expect(stellarRadarShape(150, true)).toBe('dot');   // HG-Secundus
        expect(stellarRadarShape(315, true)).toBe('dot');
        expect(stellarRadarShape(undefined, true)).toBe('dot');
    });

    it('reads the size off the larger side of the sprite frame', () => {
        expect(stellarRadarSize([53, 60])).toBe(60);   // spïn 2063 gate
        expect(stellarRadarSize([120, 73])).toBe(120); // Spacedock V
        expect(stellarRadarSize(undefined)).toBeUndefined();
        expect(stellarRadarSize([])).toBeUndefined();
    });

    it('dots the working hypergates (stations) and the unlandable gate art; '
        + 'rings the 150 px gate art on a plain planet', () => {
        const shape = (frame: [number, number], isStation: boolean) =>
            planetRadarShape({ spriteFrameSize: frame,
                flags: { isStation } as PlanetData['flags'] });
        expect(shape([150, 150], true)).toBe('dot');   // HG-Secundus, 0x11
        expect(shape([150, 150], false)).toBe('ring'); // k8_shapes Type 1
        expect(shape([53, 60], false)).toBe('dot');    // HG-Aldebaran
        expect(shape([40, 48], false)).toBe('dot');
    });

    it('dots a WORMHOLE whatever its size (K8 wormhole, wave 23)', () => {
        // Enlightenment's wormhole, spöb 470: flags 0x21 (land +
        // uninhabited, no station bit), 104 x 104 — over the ring
        // threshold — was a 2 x 2 dot on the original's radar.
        expect(stellarRadarShape(104, false, true)).toBe('dot');
        expect(stellarRadarShape(undefined, false, true)).toBe('dot');
        const wormhole = (frame: [number, number]) => planetRadarShape({
            spriteFrameSize: frame,
            flags: { isStation: false, uninhabited: true } as
                PlanetData['flags'],
            gate: { kind: 'wormhole', destinations: [],
                emergenceAngle: null },
        });
        expect(wormhole([104, 104])).toBe('dot');
    });

    it('keeps an uninhabited non-wormhole planet on the size rule: Jupiter '
        + '(0x0020 set, 325 px) is a ring on in_space.png', () => {
            // Why the rule is the wormhole flag and not 0x0020 alone.
            expect(planetRadarShape({
                spriteFrameSize: [325, 325],
                flags: { isStation: false, uninhabited: true,
                    canLand: false } as PlanetData['flags'],
                gate: null,
            })).toBe('ring');
        });

    it('keeps a LANDABLE uninhabited planet on the size rule: Spica (0x21, '
        + '120 px) is a ring (wave 24)', () => {
            // Why the rule is the wormhole flag and not "landable AND
            // uninhabited".
            expect(planetRadarShape({
                spriteFrameSize: [120, 120],
                flags: { isStation: false, uninhabited: true,
                    canLand: true } as PlanetData['flags'],
                gate: null,
            })).toBe('ring');
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

    it('draws an uncoloured stellar in the flat dimRadar grey, not yellow',
        () => {
            // No IFF: DrawRadar leaves landable stellars out of planetColors,
            // and the ring must read the same grey as an uncoloured ship.
            const pane = recordingPane(data);
            const planets = [['inhabited', state(-1200, 0)]] as unknown as
                Parameters<RadarPane['drawRadar']>[2];
            pane.drawRadar(here, [], planets);
            const rects = drawnRects(pane);
            expect([...rects.get(data.colors.dimRadar) ?? []].sort()).toEqual(
                STELLAR_RING_PIXELS.map(([x, y]) => key([52 + x, 88 + y]))
                    .sort());
            expect(rects.has(0xffff00)).toBeFalse();
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
            radar: { drawRadar },
        } as unknown as StatusBar);
        world.addSystem(DrawRadar);
        const player = new Entity('player');
        player.components.set(PlayerShipSelector, undefined);
        // Far out: the centre is off the radar, so the arrow's gate holds.
        player.components.set(MovementStateComponent,
            { position: new Position(-9000, 2000) } as MovementState);
        player.components.set(TargetComponent, { target: 'npc' });
        world.entities.set('player', player);
        const stepAt = (ms: number) => {
            time.time = ms;
            world.step();
        };
        return { drawRadar, stepAt, world };
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

    it('draws the arrow over a stellar ON the radar once the centre is off '
        + 'it (K8, wave 43)', () => {
        // The wave-43 rig: the player sits on a port 4,000 px from an empty
        // centre. The original showed the arrow from the first frame.
        const { drawRadar, stepAt, world } = radarWorld();
        world.entities.get('player')!.components.set(MovementStateComponent,
            { position: new Position(4000, 0) } as MovementState);
        const port = new Entity('port');
        port.components.set(MovementStateComponent,
            { position: new Position(4000, 0) } as MovementState);
        port.components.set(PlanetDataComponent, getDefaultPlanetData());
        port.components.set(PlanetComponent, { id: 'nova:128' });
        world.entities.set('port', port);
        stepAt(0);
        expect(drawRadar.calls.mostRecent().args[4])
            .toEqual({ x: -4000, y: 0 });
    });

    it('draws no arrow while the centre is within CENTER_ARROW_RADIUS, '
        + 'stellars or not', () => {
            const { drawRadar, stepAt, world } = radarWorld();
            // 2,404 px out: wave 44's (1700, 1700) start, no arrow.
            world.entities.get('player')!.components.set(
                MovementStateComponent,
                { position: new Position(1700, -1700) } as MovementState);
            stepAt(0);
            expect(drawRadar.calls.mostRecent().args[4]).toBeNull();
        });

    it('leaves an inhabited, landable stellar uncoloured (dimRadar grey) '
        + 'while the player has no IFF', () => {
        // Matthew: "Inhabited planets should still show up grey until the
        // player has an iff sensor." The player here owns no outfits.
        const { drawRadar, stepAt, world } = radarWorld();
        const planet = new Entity('earth');
        planet.components.set(MovementStateComponent,
            { position: new Position(-9000, 2100) } as MovementState);
        const planetData = getDefaultPlanetData();
        expect(planetData.flags.canLand).toBeTrue();
        expect(planetData.flags.uninhabited).toBeFalse();
        planet.components.set(PlanetDataComponent, planetData);
        planet.components.set(PlanetComponent, { id: 'nova:128' });
        world.entities.set('earth', planet);
        stepAt(0);
        expect(drawRadar).toHaveBeenCalledTimes(1);
        const planetColors = drawRadar.calls.mostRecent().args[6] as
            ReadonlyMap<string, number> | undefined;
        expect(planetColors?.get('earth')).toBeUndefined();
    });

    it('shapes stellars by their station flag and sprite frame from the '
        + 'first refresh, with no sprite sheet loaded', () => {
        // Nesre Secundus: the 250 px planet, Spacedock V (120 x 73,
        // station), HG-Secundus (150 x 150 frames, station) and Pyrogenesis
        // I (40 x 48, station); plus an 88 px planet just under the ring.
        const { drawRadar, stepAt, world } = radarWorld();
        const stellars: [string, [number, number], boolean][] = [
            ['planet', [250, 250], false], ['station', [120, 73], true],
            ['gate', [150, 150], true], ['moon', [40, 48], true],
            ['small', [88, 88], false],
        ];
        for (const [uuid, frame, isStation] of stellars) {
            const stellar = new Entity(uuid);
            stellar.components.set(MovementStateComponent,
                { position: new Position(-9000, 2100) } as MovementState);
            const data = getDefaultPlanetData();
            stellar.components.set(PlanetDataComponent, {
                ...data, spriteFrameSize: frame,
                flags: { ...data.flags, isStation },
            });
            stellar.components.set(PlanetComponent, { id: 'nova:128' });
            world.entities.set(uuid, stellar);
        }
        stepAt(0);
        const shapes = drawRadar.calls.mostRecent().args[8] as
            ReadonlyMap<string, string>;
        expect([...shapes].sort()).toEqual([
            ['gate', 'dot'], ['moon', 'dot'], ['planet', 'ring'],
            ['small', 'dot'], ['station', 'dot'],
        ]);
    });
});

/**
 * The IFF radar paints every ship exactly as the target brackets would
 * (hostility.ts's styleForTarget), so a blip and the corners around the same
 * ship cannot disagree. Reference K9 and Matthew's ruling (2026-11-23):
 * "IFF bracket colors correspond to hostility regardless of govt's stance" —
 * an AI 1 trader of an always-attacks govt is yellow on the original while
 * that govt's warships are red.
 */
describe('DrawRadar IFF ship colours match the brackets (K9)', () => {
    const IFF_OUTFIT = 'test:iff';
    const alwaysAttacks = { ...getDefaultGovtData(), id: 'test:362' };
    alwaysAttacks.flags = { ...alwaysAttacks.flags, alwaysAttacksPlayer: true };
    const lawful = { ...getDefaultGovtData(), id: 'test:370', crimeTol: 10 };
    const OWN_370_SYSTEM = 'test:2110';
    const govts: { [id: string]: GovtData } = {
        'test:362': alwaysAttacks, 'test:370': lawful,
    };
    const gameData = {
        data: {
            Outfit: {
                getCached: (id: string) => id === IFF_OUTFIT
                    ? { ...getDefaultOutfitData(), id, iff: true }
                    : undefined,
            },
            Govt: { getCached: (id: string) => govts[id] },
            // The radar's system is govt 370's own: a criminal record
            // counts by the law of the system it is in (reference A14).
            System: {
                getCached: (id: string) => id === OWN_370_SYSTEM
                    ? { govt: 'test:370' } : undefined,
            },
            SpriteSheet: {
                getCached: () => undefined,
                get: () => Promise.resolve(undefined),
            },
        },
    } as unknown as SimulationGameDataInterface;

    function radarWorld(records?: Map<string, number>) {
        const world = new World('radar iff test');
        const time = { time: 0, delta_ms: 16, delta_s: 0.016 };
        world.resources.set(TimeResource, time as never);
        world.resources.set(SimulationTimeResource, time as never);
        world.resources.set(SimulationGameDataResource, gameData);
        world.resources.set(SystemIdResource, OWN_370_SYSTEM);
        const drawRadar = jasmine.createSpy('drawRadar');
        world.resources.set(StatusBarResource, {
            radar: { drawRadar },
        } as unknown as StatusBar);
        world.addSystem(DrawRadar);
        const player = new Entity('player');
        player.components.set(PlayerShipSelector, undefined);
        player.components.set(MovementStateComponent,
            { position: new Position(0, 0) } as MovementState);
        player.components.set(OutfitsStateComponent,
            new Map([[IFF_OUTFIT, { count: 1 }]]));
        if (records) {
            player.components.set(LegalRecordsComponent, records);
        }
        world.entities.set('player', player);
        return { drawRadar, world, player };
    }

    function addShip(world: World, uuid: string, govtId: string,
        aiType: number, configure: (e: Entity) => void = () => { }) {
        const ship = new Entity(uuid);
        ship.components.set(MovementStateComponent,
            { position: new Position(100, 0) } as MovementState);
        ship.components.set(ShipDataComponent, getDefaultShipData());
        ship.components.set(GovtComponent, { id: govtId });
        ship.components.set(NpcComponent, { aiType, mode: 'travel' });
        configure(ship);
        world.entities.set(uuid, ship);
        return ship;
    }

    /** The blip colours DrawRadar handed the pane on its last refresh. */
    function blipColors(drawRadar: jasmine.Spy) {
        return drawRadar.calls.mostRecent().args[3] as
            ReadonlyMap<string, number>;
    }

    /** The brackets' verdict, as a blip colour. */
    function bracketColor(world: World, player: Entity, uuid: string) {
        const style = styleForTarget(uuid, world.entities.get(uuid)!,
            'player', player, gameData, u => world.entities.get(u), 0,
            OWN_370_SYSTEM);
        return style === 'hostile' ? IFF_HOSTILE_COLOR
            : style === 'friendly' ? IFF_FRIENDLY_COLOR : IFF_NEUTRAL_COLOR;
    }

    it('gövt 0x0004: the trader is a yellow blip, the warship red, and '
        + 'the trader goes red when it attacks', () => {
            const { drawRadar, world, player } = radarWorld();
            addShip(world, 'trader', 'test:362', 1);
            addShip(world, 'warship', 'test:362', 3);
            addShip(world, 'attacker', 'test:362', 2, ship => {
                ship.components.set(NpcComponent,
                    { aiType: 2, mode: 'attack' });
                ship.components.set(TargetComponent, { target: 'player' });
            });
            world.step();
            const colors = blipColors(drawRadar);
            expect(colors.get('trader')).toBe(IFF_NEUTRAL_COLOR);
            expect(colors.get('warship')).toBe(IFF_HOSTILE_COLOR);
            expect(colors.get('attacker')).toBe(IFF_HOSTILE_COLOR);
            for (const uuid of ['trader', 'warship', 'attacker']) {
                expect(colors.get(uuid)).withContext(uuid)
                    .toBe(bracketColor(world, player, uuid));
            }
        });

    it('a criminal record: the trader is yellow, the warship and the '
        + 'interceptor red', () => {
            const { drawRadar, world, player } =
                radarWorld(new Map([[OWN_370_SYSTEM, -500]]));
            addShip(world, 'trader', 'test:370', 1);
            addShip(world, 'warship', 'test:370', 3);
            addShip(world, 'interceptor', 'test:370', 4);
            world.step();
            const colors = blipColors(drawRadar);
            expect(colors.get('trader')).toBe(IFF_NEUTRAL_COLOR);
            expect(colors.get('warship')).toBe(IFF_HOSTILE_COLOR);
            expect(colors.get('interceptor')).toBe(IFF_HOSTILE_COLOR);
            for (const uuid of ['trader', 'warship', 'interceptor']) {
                expect(colors.get(uuid)).withContext(uuid)
                    .toBe(bracketColor(world, player, uuid));
            }
        });

    it('the player\'s own escort is green, as its brackets are', () => {
        const { drawRadar, world, player } = radarWorld();
        const escort = new Entity('escort');
        escort.components.set(MovementStateComponent,
            { position: new Position(50, 0) } as MovementState);
        escort.components.set(ShipDataComponent, getDefaultShipData());
        escort.components.set(FormationComponent,
            { leader: 'player', slot: 0 });
        world.entities.set('escort', escort);
        world.step();
        expect(blipColors(drawRadar).get('escort')).toBe(IFF_FRIENDLY_COLOR);
        expect(bracketColor(world, player, 'escort')).toBe(IFF_FRIENDLY_COLOR);
    });
});

/**
 * Matthew's playtest (2026-11-24, Nesre Secundus): three rings on the
 * radar, the planet, the station and the hypergate. The original (K8,
 * wave 22) draws only the planet as a ring: Spacedock V and HG-Secundus
 * are stations, so dots. Pinned against the stock data so the shapes
 * follow the station flags and frame sizes the parser stages.
 */
describe('stock stellar radar shapes (Nesre Secundus)', () => {
    beforeEach(requireNovaData);

    it('rings the planet, dots Spacedock V, HG-Secundus, Pyrogenesis I and '
        + 'the unlandable gate art', async () => {
        const gameData = await getIntegrationGameData();
        const system = await gameData.data.System.get('nova:133');
        const shapes: [string, string, number[], boolean, string][] = [];
        for (const id of [...system.planets, 'nova:130']) {
            const planet = await gameData.data.Planet.get(id);
            shapes.push([id, planet.name, planet.spriteFrameSize,
                planet.flags.isStation, planetRadarShape(planet)]);
        }
        expect(shapes).toEqual([
            ['nova:161', 'Pyrogenesis I', [40, 48], true, 'dot'],
            ['nova:176', 'Nesre Secundus IV', [250, 250], false, 'ring'],
            ['nova:150', 'Spacedock V', [120, 73], true, 'dot'],
            ['nova:1408', 'HG-Secundus', [150, 150], true, 'dot'],
            ['nova:130', 'HG-Aldebaran', [53, 60], true, 'dot'],
        ]);
    }, 120_000);

    it('dots an 88 px planet and a wormhole, rings a 96 px one', async () => {
        const gameData = await getIntegrationGameData();
        const shapes: [string, number[], boolean, string][] = [];
        // Fermia (Arcturus), Georgia (Nesre Primus), Spica's wormhole.
        for (const id of ['nova:166', 'nova:175', 'nova:466']) {
            const planet = await gameData.data.Planet.get(id);
            shapes.push([planet.name, planet.spriteFrameSize,
                planet.flags.isStation, planetRadarShape(planet)]);
        }
        expect(shapes).toEqual([
            ['Fermia', [88, 88], false, 'dot'],
            ['Georgia', [96, 96], false, 'ring'],
            // K8 wormhole, wave 23: a 2 x 2 dot, not a ring.
            ['Wormhole', [104, 104], false, 'dot'],
        ]);
    }, 120_000);

    it('dots all 24 stock wormholes and still rings Jupiter (0x0020, '
        + '325 px)', async () => {
        const gameData = await getIntegrationGameData();
        const ids = (await gameData.ids).Planet
            .filter(id => id.startsWith('nova:'));
        const wormholes: string[] = [];
        for (const id of ids) {
            const planet = await gameData.data.Planet.get(id);
            if (planet.gate?.kind === 'wormhole') {
                wormholes.push(id);
                expect(planetRadarShape(planet)).withContext(id).toBe('dot');
            }
        }
        expect(wormholes.length).toBe(24);
        const jupiter = await gameData.data.Planet.get('nova:159');
        expect(jupiter.flags.uninhabited).toBeTrue();
        expect(planetRadarShape(jupiter)).toBe('ring');
        // Spica (spöb 172, Flags 0x21: land + uninhabited, 120 px) is a 4 x 4
        // RING on the original's radar (reference "Hypergates and the radar,
        // wave 24"), so "landable AND uninhabited" does not make a dot.
        const spica = await gameData.data.Planet.get('nova:172');
        expect(spica.name).toBe('Spica');
        expect(spica.flags.canLand).toBeTrue();
        expect(spica.flags.uninhabited).toBeTrue();
        expect(spica.gate).toBeFalsy();
        expect(planetRadarShape(spica)).toBe('ring');
    }, 120_000);
});
