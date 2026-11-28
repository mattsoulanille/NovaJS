import 'jasmine';
import * as PIXI from 'pixi.js';
import { getDefaultNebulaData, NebulaData } from 'novadatainterface/nebula_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultSystemData, SystemData } from 'novadatainterface/system_data';
import { Subject } from 'rxjs';
import {
    BITS, NEBULAE, nebulaPict, sid, SYNTHETIC, SYSTS,
} from 'novaparse/synthetic/universe';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import {
    DISCOVERY_ENTERED, DISCOVERY_LANDED, DISCOVERY_UNKNOWN, DiscoveryLevel,
} from '../nova_plugin/player/index.js';
import { MAX_BLEND_MODE } from '../display/max_blend.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import {
    boundsWithNebulae, NEBULA_MAP_SCALES, nebulaImageFor, nebulaRect,
    nebulaVisible, visibleNebulae,
} from './starmap_nebulae.js';
import { Starmap } from './starmap.js';
import { BASE_SCALE, DEFAULT_ZOOM } from './starmap_viewport.js';
import { SystemGraph } from './system_graph.js';

/** A nebula with pictures of these widths (heights follow the aspect). */
function nebula(size: [number, number], widths: number[],
    over: Partial<NebulaData> = {}): NebulaData {
    return {
        ...getDefaultNebulaData(),
        id: 'nova:128',
        size,
        images: widths.map((width, i) => ({
            id: `nova:${9500 + i}`, width,
            height: Math.round(width * size[1] / size[0]),
        })),
        ...over,
    };
}

/** The synthetic scenario's nebulae as the parser hands them over. */
const syntheticNebulae: NebulaData[] = NEBULAE.map(def => ({
    ...getDefaultNebulaData(),
    id: sid(def.id), name: def.name, prefix: 'nova', writerPrefix: 'nova',
    position: def.position, size: def.size,
    activeOn: def.activeOn, onExplore: def.onExplore,
    images: def.images.map(([width, height], slot) =>
        ({ id: sid(nebulaPict(def.id, slot)), width, height })),
}));

const syntheticSystems: SystemData[] = SYSTS.map(def => ({
    ...getDefaultSystemData(), id: sid(def.id), name: def.name,
    position: def.position,
}));

const entered = (...ids: string[]) => (id: string): DiscoveryLevel =>
    ids.includes(id) ? DISCOVERY_ENTERED : DISCOVERY_UNKNOWN;

/** The stock four as the parser reads them (reference_experiments.md
 * "Star-map nebulae (nëbu), wave 53": stock data table). */
function stock(id: number, position: [number, number],
    size: [number, number], images: [number, number][]): NebulaData {
    const first = 9500 + 7 * (id - 128);
    return {
        ...getDefaultNebulaData(),
        id: `nova:${id}`, position, size,
        images: images.map(([width, height], slot) =>
            ({ id: `nova:${first + slot}`, width, height })),
    };
}
const HOLPA = stock(128, [430, 45], [251, 298],
    [[63, 75], [126, 149], [251, 298]]);
const OBATTA = stock(129, [60, 40], [65, 90],
    [[17, 25], [33, 49], [65, 98]]);
const ROCHAK = stock(130, [263, 145], [109, 95],
    [[28, 24], [55, 48], [109, 95]]);
const L1551 = stock(131, [-138, -226], [146, 71],
    [[73, 36], [146, 71], [292, 141]]);

describe('the star map\'s nebula picture choice', () => {
    const pict = (n: NebulaData, scale: number) =>
        nebulaImageFor(n, scale)?.id.replace('nova:', '');

    it('matches the original\'s pick for every stock nebula at all seven '
        + 'of its zoom levels (wave 53, 28 fits)', () => {
            // [scale, Holpa, Obatta, Rochak, L-1551], the measured table.
            const measured: [number, ...string[]][] = [
                [2.37, '9502', '9509', '9516', '9523'],
                [1.777, '9502', '9509', '9516', '9522'],
                [1.333, '9502', '9509', '9516', '9522'],
                [1, '9502', '9508', '9516', '9522'],
                [0.75, '9501', '9508', '9515', '9521'],
                [0.562, '9501', '9508', '9515', '9521'],
                [0.421, '9500', '9507', '9514', '9521'],
            ];
            expect(measured.map(([scale]) => scale))
                .toEqual([...NEBULA_MAP_SCALES].reverse());
            for (const [scale, ...picts] of measured) {
                expect([HOLPA, OBATTA, ROCHAK, L1551].map(n => pict(n, scale)))
                    .withContext(`${scale * 100}%`).toEqual(picts);
            }
        });

    it('takes the largest picture that fits, not the nearest in size', () => {
        // Holpa at 42.1%: 106 px wide; 126 is nearer, but only 63 fits.
        expect(nebulaImageFor(HOLPA, 0.421)?.width).toBe(63);
        // L-1551 at 177.7%: 259 px wide; 292 is nearer, but 146 fits.
        expect(nebulaImageFor(L1551, 1.777)?.width).toBe(146);
        // And at NovaJS's own opening scale (DEFAULT_PX_PER_UNIT 1.77).
        expect(nebulaImageFor(L1551, BASE_SCALE * DEFAULT_ZOOM)?.width)
            .toBe(146);
        // A picture exactly the target's size fits (Holpa at 100%).
        expect(nebulaImageFor(HOLPA, 1)?.width).toBe(251);
    });

    it('needs the picture to fit in BOTH dimensions (Obatta\'s 98-tall '
        + 'picture at 100%, and the wave-53 size plug-in)', () => {
            expect(nebulaImageFor(OBATTA, 1)?.height).toBe(49);
            expect(nebulaImageFor(OBATTA, 1.333)?.height).toBe(98);
            // size_a: Obatta 60 x 200 (65x98 too wide, short enough) and
            // Rochak 200 x 90 (109x95 narrow enough, too tall) skip their
            // labelled pictures at 100% and use them again at 177.7%.
            const narrow = { ...OBATTA, size: [60, 200] as [number, number] };
            const short = { ...ROCHAK, size: [200, 90] as [number, number] };
            expect(pict(narrow, 1)).toBe('9508');
            expect(pict(short, 1)).toBe('9515');
            expect(pict(narrow, 1.777)).toBe('9509');
            expect(pict(short, 1.777)).toBe('9516');
        });

    it('applies the rule at any scale in between (continuous zoom)', () => {
        // Holpa's 126x149 fits from 126/251 = 50.2% up to just under 100%.
        expect(nebulaImageFor(HOLPA, 0.5)?.width).toBe(63);
        expect(nebulaImageFor(HOLPA, 0.51)?.width).toBe(126);
        expect(nebulaImageFor(HOLPA, 0.99)?.width).toBe(126);
        // Past the original's 237% the double-size picture stays.
        expect(nebulaImageFor(L1551, 8)?.width).toBe(292);
        expect(nebulaImageFor(L1551, 0.1)?.width).toBe(73);
    });

    it('stretches a lone picture at every scale, and has none to draw '
        + 'without pictures', () => {
            const lone = nebula([100, 100], [50]);
            for (const scale of NEBULA_MAP_SCALES) {
                expect(nebulaImageFor(lone, scale)?.id).toBe('nova:9500');
            }
            expect(nebulaImageFor(nebula([100, 100], []), 1)).toBeUndefined();
        });
});

describe('which nebulae the star map shows', () => {
    const [haze, veil] = syntheticNebulae;
    const kestrel = SYSTS.find(s => sid(s.id) === SYNTHETIC.systems.kestrel)!;
    const thessaly = SYSTS.find(s => sid(s.id) === SYNTHETIC.systems.thessaly)!;
    const vael = SYSTS.find(s => sid(s.id) === SYNTHETIC.systems.vael)!;

    it('shows an ungated nebula once an explored system lies on it', () => {
        expect(nebulaVisible(haze, new Set(), [thessaly.position])).toBeFalse();
        expect(nebulaVisible(haze, new Set(),
            [thessaly.position, kestrel.position])).toBeTrue();
    });

    it('does not count a system on the picture\'s edge (reference: '
        + 'Tichel on Obatta Nebula\'s top edge reveals nothing)', () => {
            const [x, y] = haze.position;
            const [w, h] = haze.size;
            for (const edge of [[x, y + 1], [x + 1, y], [x + w, y + 1],
                [x + 1, y + h]] as [number, number][]) {
                expect(nebulaVisible(haze, new Set(), [edge]))
                    .withContext(String(edge)).toBeFalse();
            }
            expect(nebulaVisible(haze, new Set(), [[x + 1, y + 1]])).toBeTrue();
            // Stock Obatta Nebula and Tichel, as the parser reads them.
            const obatta = { ...haze, position: [60, 40] as [number, number],
                size: [65, 90] as [number, number] };
            expect(nebulaVisible(obatta, new Set(), [[110, 40]])).toBeFalse();
            expect(nebulaVisible(obatta, new Set(), [[80, 80]])).toBeTrue();
        });

    it('hides a nebula whose ActiveOn fails, explored or not', () => {
        expect(nebulaVisible(veil, new Set(), [vael.position])).toBeFalse();
        expect(nebulaVisible(veil, new Set([BITS.veilCharted]),
            [vael.position])).toBeTrue();
        expect(nebulaVisible(veil, new Set([BITS.veilCharted]),
            [thessaly.position])).toBeFalse();
    });

    it('matches the wave-53 visibility pilots on the stock nebulae', () => {
        const at = (id: string, position: [number, number]): SystemData =>
            ({ ...getDefaultSystemData(), id, position });
        const systems = [
            at('tichel', [110, 40]), at('obatta', [80, 80]),
            at('nibos', [422, 170]), at('tocc', [461, 152]),
            at('holpa', [486, 120]), at('k003', [-56, -218]),
            at('k018', [-15, -226]), at('away', [1000, 1000]),
        ];
        const nebulae = [HOLPA, OBATTA, L1551];
        const seen = (levels: { [id: string]: DiscoveryLevel },
            bits: number[] = []) => visibleNebulae(nebulae, systems, 'away',
                new Set(bits), id => levels[id] ?? DISCOVERY_UNKNOWN)
            .map(n => n.id);
        // w53_holpa: Holpa alone, in the corner, reveals all of Holpa.
        expect(seen({ holpa: DISCOVERY_LANDED })).toEqual(['nova:128']);
        // w53_nibtocc: Tocc only VISITED (level 1) reveals it too.
        expect(seen({ nibos: DISCOVERY_LANDED, tocc: DISCOVERY_ENTERED }))
            .toEqual(['nova:128']);
        // w53_nibos: Nibos 8 units outside; Tocc inside but unexplored.
        expect(seen({ nibos: DISCOVERY_LANDED })).toEqual([]);
        // w53_k003: inside L-1551.
        expect(seen({ k003: DISCOVERY_LANDED })).toEqual(['nova:131']);
        // w53_tichel / w53_k018 / w53_fresh: ON the top edge, either level.
        expect(seen({ tichel: DISCOVERY_LANDED })).toEqual([]);
        expect(seen({ tichel: DISCOVERY_ENTERED })).toEqual([]);
        expect(seen({ k018: DISCOVERY_LANDED })).toEqual([]);
        // ncb_a: ActiveOn on a bit the pilot lacks hides it, explored.
        const gated = { ...OBATTA, activeOn: 'b9351' };
        expect(visibleNebulae([gated], systems, 'obatta', new Set(),
            () => DISCOVERY_LANDED)).toEqual([]);
        expect(visibleNebulae([gated], systems, 'obatta', new Set([9351]),
            () => DISCOVERY_LANDED)).toEqual([gated]);
    });
});

describe('the star map\'s nebula layer', () => {
    beforeAll(() => installHeadlessPixi());

    /** A distinct texture per PICT, so the chosen picture can be read back. */
    const textures = new Map<string, PIXI.Texture>();
    const textureOf = (id: string) => {
        let texture = textures.get(id);
        if (!texture) {
            texture = new PIXI.Texture(PIXI.Texture.WHITE.baseTexture);
            textures.set(id, texture);
        }
        return texture;
    };
    const mapLayers = (graph: SystemGraph) => (graph as unknown as {
        viewport: { mapContainer: PIXI.Container },
    }).viewport.mapContainer.children;

    function graph(discovered: string[], bits: number[] = []) {
        return new SystemGraph(syntheticSystems, SYNTHETIC.systems.thessaly, {
            discoveryOf: entered(...discovered),
            playerBits: new Set(bits),
            nebulae: syntheticNebulae,
            nebulaTexture: textureOf,
        });
    }

    it('draws nothing before the player has explored a nebula', () => {
        const g = graph([SYNTHETIC.systems.thessaly]);
        expect(g.nebulae?.shown).toEqual([]);
    });

    it('draws a visible nebula over the borders, MAX-blended, and under '
        + 'everything else, over its rectangle', () => {
            const g = graph([SYNTHETIC.systems.thessaly,
                SYNTHETIC.systems.kestrel]);
            expect(g.nebulae?.shown).toEqual([SYNTHETIC.nebulae.haze]);
            const layers = mapLayers(g);
            const borders = (g as unknown as { borderGraphics: PIXI.Graphics })
                .borderGraphics;
            // Black background, borders, nebula, then links, dots, names...
            expect(layers[0]).toBe(borders);
            expect(layers[1]).toBe(g.nebulae!.container);
            const sprite = g.nebulae!.container.children[0] as PIXI.Sprite;
            expect(sprite.blendMode).toBe(MAX_BLEND_MODE);
            const rect = nebulaRect(syntheticNebulae[0]);
            expect([sprite.x, sprite.y, sprite.width, sprite.height])
                .toEqual([rect.x, rect.y, rect.width, rect.height]);
            // Whole source pixels as blocks, as the original draws them.
            expect(sprite.texture.baseTexture.scaleMode)
                .toBe(PIXI.SCALE_MODES.NEAREST);
        });

    it('re-picks the picture as the map zooms', () => {
        const g = graph([SYNTHETIC.systems.kestrel]);
        const haze = SYNTHETIC.nebulae.haze;
        const slot = (n: number) => sid(nebulaPict(NEBULAE[0].id, n));
        // The opening 177.7%: 283 x 212 px, the largest (160x120) fits.
        g.zoomBy(DEFAULT_ZOOM);
        expect(g.nebulae?.pictures.get(haze)).toBe(slot(2));
        // Three button steps out (~76%): 122 x 92 px, so 80x60.
        const step = 1.15 ** 2;
        g.zoomBy(1 / step ** 3);
        expect(g.nebulae?.pictures.get(haze)).toBe(slot(1));
        const sprite = g.nebulae!.container.children[0] as PIXI.Sprite;
        expect(sprite.texture).toBe(textureOf(slot(1)));
        // The sprite still spans the nebula's rectangle.
        expect(sprite.width).toBe(nebulaRect(syntheticNebulae[0]).width);
        // Back in: the largest again.
        g.zoomBy(step ** 3);
        expect(g.nebulae?.pictures.get(haze)).toBe(slot(2));
    });

    it('is not drawn by a graph that is not handed nebulae (the minimap, '
        + 'the gate map)', () => {
            const g = new SystemGraph(syntheticSystems,
                SYNTHETIC.systems.kestrel, { miniMap: true });
            expect(g.nebulae).toBeUndefined();
        });
});

describe('the star map\'s stock nebulae against the reference', () => {
    beforeAll(() => installHeadlessPixi());

    const system = (id: string, position: [number, number]): SystemData =>
        ({ ...getDefaultSystemData(), id, name: id, position });
    // Obatta 80,80 inside Obatta Nebula; Holpa 486,120 in Holpa Nebula's
    // top-left corner; nothing east of 587 or south of 300, as in stock.
    const systems = [
        system('nova:obatta', [80, 80]),
        system('nova:holpa', [486, 120]),
        system('nova:east', [587, 100]),
        system('nova:south', [300, 300]),
    ];
    const mapOf = (g: SystemGraph) => (g as unknown as {
        viewport: { mapContainer: PIXI.Container, size: PIXI.IPointData },
    }).viewport;

    function stockGraph() {
        return new SystemGraph(systems, 'nova:holpa', {
            discoveryOf: () => DISCOVERY_ENTERED,
            nebulae: [HOLPA, OBATTA],
            nebulaTexture: () => new PIXI.Texture(PIXI.Texture.WHITE.baseTexture),
        });
    }

    /** `graph` zoomed to `pxPerUnit` screen pixels per map unit. */
    function zoomTo(g: SystemGraph, pxPerUnit: number) {
        g.zoomBy(pxPerUnit / (BASE_SCALE * g.zoom));
        expect(BASE_SCALE * g.zoom).toBeCloseTo(pxPerUnit, 9);
    }

    it('stretches Obatta\'s 65x98 picture to 90 units tall: 213 px at '
        + '237% (measured 212), not 232', () => {
            const g = stockGraph();
            zoomTo(g, 2.37);
            expect(g.nebulae?.pictures.get('nova:129')).toBe('nova:9509');
            const sprite = g.nebulae!.container.children
                .find(c => c.name === 'nova:129') as PIXI.Sprite;
            const onScreen = sprite.height * mapOf(g).mapContainer.scale.y;
            expect(onScreen).toBeCloseTo(90 * 2.37, 6);
            expect(Math.abs(onScreen - 212)).toBeLessThan(1.5);
            expect(sprite.width * mapOf(g).mapContainer.scale.x)
                .toBeCloseTo(65 * 2.37, 6);
            // Its placement: (XPos, YPos) in system coordinates.
            expect([sprite.x, sprite.y])
                .toEqual([60 * BASE_SCALE, 40 * BASE_SCALE]);
        });

    it('lets the pan reach Holpa Nebula\'s lower right, past every system, '
        + 'at the closest zoom', () => {
            const g = stockGraph();
            zoomTo(g, 8);
            // Pan as far right and down as the clamp allows.
            g.pan(-1e6, -1e6);
            const view = mapOf(g);
            const corner = [(430 + 251) * BASE_SCALE, (45 + 298) * BASE_SCALE];
            const screen = corner.map((c, i) => c * g.zoom
                + [view.mapContainer.x, view.mapContainer.y][i]);
            expect(screen[0]).toBeLessThan(view.size.x);
            expect(screen[1]).toBeLessThan(view.size.y);
            expect(screen[0]).toBeGreaterThan(0);
            expect(screen[1]).toBeGreaterThan(0);
        });

    it('widens the pan bounds by the visible nebulae only', () => {
        const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
        expect(boundsWithNebulae(bounds, [])).toEqual(bounds);
        expect(boundsWithNebulae(bounds, [HOLPA, L1551])).toEqual({
            minX: -138 * BASE_SCALE, minY: -226 * BASE_SCALE,
            maxX: 681 * BASE_SCALE, maxY: 343 * BASE_SCALE,
        });
    });
});

describe('the MAX blend the nebulae are drawn with', () => {
    it('is PIXI\'s LIGHTEN, which needs no premultiplied twin', () => {
        // The batcher maps a sprite's blend mode through this table
        // before the renderer looks it up; LIGHTEN must map to itself for
        // both alpha modes, or the installed MAX would be bypassed.
        expect(MAX_BLEND_MODE).toBe(PIXI.BLEND_MODES.LIGHTEN);
        expect(PIXI.utils.premultiplyBlendMode[0][MAX_BLEND_MODE])
            .toBe(MAX_BLEND_MODE);
        expect(PIXI.utils.premultiplyBlendMode[1][MAX_BLEND_MODE])
            .toBe(MAX_BLEND_MODE);
    });
});

describe('the star map dialog\'s nebulae', () => {
    beforeAll(() => installHeadlessPixi());

    /** The synthetic galaxy and nebulae through one MockGameData, which
     * stands in for both the simulation data and the display assets. */
    function gameData(): MockGameData {
        const data = new MockGameData();
        for (const system of syntheticSystems) {
            data.data.System.map.set(system.id, system);
        }
        for (const n of syntheticNebulae) {
            data.data.Nebula.map.set(n.id, n);
        }
        return data;
    }

    function displayAssets(data: MockGameData): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.WHITE,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: { Nebula: data.data.Nebula },
        } as unknown as DisplayAssetDataInterface;
    }

    it('draws the explored nebulae on the full map, not on the minimap',
        async () => {
            const data = gameData();
            const starmap = new Starmap(displayAssets(data),
                data as unknown as SimulationGameDataInterface,
                SYNTHETIC.systems.kestrel, new Subject<ControlEvent>(),
                () => new Set(), () => [], { state: { pinned: [] } },
                entered(SYNTHETIC.systems.kestrel));
            await starmap.buildPromise;
            const shown = starmap.show([]);
            await new Promise(resolve => setTimeout(resolve, 0));
            const full = (starmap as unknown as { systemGraph?: SystemGraph })
                .systemGraph;
            expect(full?.nebulae?.shown).toEqual([SYNTHETIC.nebulae.haze]);
            const mini = await starmap.miniMapGraph({ x: 100, y: 100 }, 1, []);
            expect(mini?.nebulae).toBeUndefined();
            starmap.dismiss();
            await shown;
        });

    it('opens without nebulae when the assets have none', async () => {
        const data = gameData();
        const assets = { ...displayAssets(data), data: {} } as
            unknown as DisplayAssetDataInterface;
        const starmap = new Starmap(assets,
            data as unknown as SimulationGameDataInterface,
            SYNTHETIC.systems.kestrel, new Subject<ControlEvent>());
        await starmap.buildPromise;
        const shown = starmap.show([]);
        await new Promise(resolve => setTimeout(resolve, 0));
        const full = (starmap as unknown as { systemGraph?: SystemGraph })
            .systemGraph;
        expect(full?.nebulae?.shown).toEqual([]);
        starmap.dismiss();
        await shown;
    });
});
