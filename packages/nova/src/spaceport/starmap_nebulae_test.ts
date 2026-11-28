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
    DISCOVERY_ENTERED, DISCOVERY_UNKNOWN, DiscoveryLevel,
} from '../nova_plugin/player/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import {
    NEBULA_MAP_SCALES, nearestMapScale, nebulaImageFor, nebulaRect,
    nebulaVisible,
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

describe('the star map\'s nebula picture choice', () => {
    it('snaps a zoom to the nearest of the original\'s seven map scales', () => {
        expect(NEBULA_MAP_SCALES.length).toBe(7);
        // The map opens at the original's 177.7% (DEFAULT_PX_PER_UNIT).
        expect(nearestMapScale(BASE_SCALE * DEFAULT_ZOOM)).toBe(1.777);
        expect(nearestMapScale(1)).toBe(1);
        expect(nearestMapScale(1.16)).toBe(1.333);
        // NovaJS zooms past both ends; the end scales cover them.
        expect(nearestMapScale(0.1)).toBe(0.421);
        expect(nearestMapScale(8)).toBe(2.37);
    });

    // Holpa Nebula (stock nova:128): 251x298, pictures 63, 126 and 251 wide.
    const holpa = nebula([251, 298], [63, 126, 251]);

    it('picks the picture closest in size to the nebula at that scale', () => {
        const at = (scale: number) => nebulaImageFor(holpa, scale)?.width;
        // 100% and up: the full-size picture, stretched above 100%.
        expect(at(2.37)).toBe(251);
        expect(at(1.777)).toBe(251);
        expect(at(1)).toBe(251);
        // 75%: 188 px wanted; 251 is nearer by ratio than 126.
        expect(at(0.75)).toBe(251);
        // 56.2% and 42.1%: the half-size picture (141 / 106 px wanted).
        expect(at(0.562)).toBe(126);
        expect(at(0.421)).toBe(126);
    });

    it('uses a double-size picture when a nebula has one (stock L-1551)', () => {
        const l1551 = nebula([146, 71], [73, 146, 292]);
        expect(nebulaImageFor(l1551, 1.777)?.width).toBe(292);
        expect(nebulaImageFor(l1551, 1)?.width).toBe(146);
        expect(nebulaImageFor(l1551, 0.421)?.width).toBe(73);
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

    it('draws a visible nebula beneath every other layer, over its '
        + 'rectangle', () => {
            const g = graph([SYNTHETIC.systems.thessaly,
                SYNTHETIC.systems.kestrel]);
            expect(g.nebulae?.shown).toEqual([SYNTHETIC.nebulae.haze]);
            const layers = mapLayers(g);
            expect(layers[0]).toBe(g.nebulae!.container);
            const sprite = g.nebulae!.container.children[0] as PIXI.Sprite;
            const rect = nebulaRect(syntheticNebulae[0]);
            expect([sprite.x, sprite.y, sprite.width, sprite.height])
                .toEqual([rect.x, rect.y, rect.width, rect.height]);
        });

    it('re-picks the picture as the map zooms', () => {
        const g = graph([SYNTHETIC.systems.kestrel]);
        const haze = SYNTHETIC.nebulae.haze;
        const slot = (n: number) => sid(nebulaPict(NEBULAE[0].id, n));
        // The opening 177.7%: the largest of 40/80/160.
        g.zoomBy(DEFAULT_ZOOM);
        expect(g.nebulae?.pictures.get(haze)).toBe(slot(2));
        // Three steps out (~75%): 120 px wanted, 160 is nearer than 80.
        const step = 1.15 ** 2;
        g.zoomBy(1 / step ** 3);
        expect(g.nebulae?.pictures.get(haze)).toBe(slot(2));
        // Two more (~42%): 67 px wanted, the 80 px picture.
        g.zoomBy(1 / step ** 2);
        expect(g.nebulae?.pictures.get(haze)).toBe(slot(1));
        const sprite = g.nebulae!.container.children[0] as PIXI.Sprite;
        expect(sprite.texture).toBe(textureOf(slot(1)));
        // The sprite still spans the nebula's rectangle.
        expect(sprite.width).toBe(nebulaRect(syntheticNebulae[0]).width);
    });

    it('is not drawn by a graph that is not handed nebulae (the minimap, '
        + 'the gate map)', () => {
            const g = new SystemGraph(syntheticSystems,
                SYNTHETIC.systems.kestrel, { miniMap: true });
            expect(g.nebulae).toBeUndefined();
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
