import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { gateMapClearancePlayer } from '../display/gate_map_plugin.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import {
    DISCOVERY_ENTERED, DiscoveryLevel, MissionsComponent,
} from '../nova_plugin/player/index.js';
import { LegalRecordsComponent } from '../nova_plugin/reputation/index.js';
import { GateMap } from './gate_map.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import { MapClearancePlayer, Starmap } from './starmap.js';
import {
    SYSTEM_INHABITED_COLOR,
    SYSTEM_REFUSING_CLEAN_COLOR, SYSTEM_REFUSING_COLOR,
    SYSTEM_UNINHABITED_COLOR,
} from './starmap_draw.js';
import { SystemGraph } from './system_graph.js';

/**
 * Matthew's playtest, 2026-11-26: "Hypergate map doesn't show whether
 * systems are hostile?" — every inhabited dot on his gate map was blue
 * while his star map coloured them red / blue / orange / grey. The
 * original draws every gate-map dot as an ordinary map dot (reference
 * "Gate map, wave 27"), so the gate map now colours its dots by the star
 * map's own rule (starmap.ts mapDotRule / refusingSystems), and a hostile
 * system's dot is the same colour on both maps for the same pilot.
 *
 * The rig, all explored: Kit Gate N1 (a gate and an open port), whose gate
 * links to Kit Gate N2 (a gate and a MinStatus-0 station of a gövt the
 * pilot is wanted by, record -500: RED); Kit Gate Lane, a hyperspace
 * neighbour whose only port wants MinStatus 100 (record 0: ORANGE); and
 * Kit Gate Empty, gate-free and portless (grey).
 */
describe('the hypergate map\'s dot colours are the star map\'s', () => {
    beforeAll(() => installHeadlessPixi());
    afterEach(() => {
        expect(MenuControls.focused).toBeUndefined();
    });

    const N1 = 'kit:1204';
    const N2 = 'kit:1205';
    const LANE = 'kit:1207';
    const EMPTY = 'kit:1208';

    function displayAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: {},
        } as unknown as DisplayAssetDataInterface;
    }

    function gameData(): MockGameData {
        const data = new MockGameData();
        data.data.Govt.map.set('kit:360', {
            ...getDefaultGovtData(), id: 'kit:360', name: 'Kit Wanted',
            crimeTol: 10,
        });
        data.data.Govt.map.set('kit:363', {
            ...getDefaultGovtData(), id: 'kit:363', name: 'Kit Hub',
        });
        const base = getDefaultPlanetData();
        const spob = (id: string, name: string, extra: Partial<PlanetData>) =>
            data.data.Planet.map.set(id, {
                ...base, id, name,
                flags: { ...base.flags, canLand: true, uninhabited: false },
                ...extra,
            });
        spob('kit:1610', 'Kit Gate N1 Gate', {
            gate: {
                kind: 'hypergate', destinations: ['kit:1611'],
                emergenceAngle: null,
            },
        });
        spob('kit:1611', 'Kit Gate N2 Gate', {
            gate: {
                kind: 'hypergate', destinations: ['kit:1610'],
                emergenceAngle: null,
            },
        });
        spob('kit:open', 'Open Port', { govt: 'kit:363' });
        spob('kit:wanted', 'Wanted Station', {
            govt: 'kit:360', minStatus: 0,
        });
        spob('kit:picky', 'Picky Port', { govt: 'kit:363', minStatus: 100 });
        const sys = (id: string, name: string, position: [number, number],
            planets: string[], links: string[], govt: string | null) =>
            data.data.System.map.set(id, {
                ...getDefaultSystemData(), id, name, position, planets,
                links, govt,
            });
        sys(N1, 'Kit Gate N1', [0, 0], ['kit:1610', 'kit:open'],
            [LANE, EMPTY], 'kit:363');
        sys(N2, 'Kit Gate N2', [200, 0], ['kit:1611', 'kit:wanted'], [],
            'kit:360');
        sys(LANE, 'Kit Gate Lane', [-60, 0], ['kit:picky'], [N1],
            'kit:363');
        sys(EMPTY, 'Kit Gate Empty', [0, 60], [], [N1], null);
        return data;
    }

    const records = () => new Map([[N2, -500]]);
    const player = (): MapClearancePlayer => ({ records: records(), now: 0 });
    const explored = (): DiscoveryLevel => DISCOVERY_ENTERED;

    async function gateMapGraph(data: MockGameData,
        clearancePlayer: MapClearancePlayer | null = player()) {
        const map = new GateMap(displayAssets(),
            data as unknown as SimulationGameDataInterface,
            new Subject<ControlEvent>(), explored);
        await map.buildPromise;
        const shown = map.show({
            gateSpob: 'kit:1610', systemId: N1, destinationSpob: null,
            legalRecords: records(),
            clearancePlayer: clearancePlayer ?? undefined,
        });
        await new Promise(resolve => setTimeout(resolve, 0));
        const graph = map.graph!;
        map.dismiss();
        await shown;
        return graph;
    }

    async function starmapGraph(data: MockGameData) {
        const starmap = new Starmap(displayAssets(),
            data as unknown as SimulationGameDataInterface, N1,
            new Subject<ControlEvent>(), () => new Set(), undefined,
            undefined, explored, undefined, () => records(), player);
        await starmap.buildPromise;
        const shown = starmap.show([]);
        await new Promise(resolve => setTimeout(resolve, 0));
        const graph = (starmap as unknown as { systemGraph: SystemGraph })
            .systemGraph;
        starmap.dismiss();
        await shown;
        return graph;
    }

    it('draws a hostile system red on both maps for the same pilot', async () => {
        const data = gameData();
        const gate = await gateMapGraph(data);
        const star = await starmapGraph(data);
        expect(gate.dotColorOf(N2)).toBe(SYSTEM_REFUSING_COLOR);
        for (const id of [N1, N2, LANE, EMPTY]) {
            expect(gate.dotColorOf(id)).withContext(id)
                .toBe(star.dotColorOf(id));
        }
        expect([N1, N2, LANE, EMPTY].map(id => gate.dotColorOf(id)))
            .toEqual([SYSTEM_INHABITED_COLOR, SYSTEM_REFUSING_COLOR,
                SYSTEM_REFUSING_CLEAN_COLOR, SYSTEM_UNINHABITED_COLOR]);
    });

    it('draws no orange or red without the pilot\'s clearance inputs',
        async () => {
            const gate = await gateMapGraph(gameData(), null);
            expect(gate.dotColorOf(N2)).toBe(SYSTEM_INHABITED_COLOR);
            expect(gate.dotColorOf(LANE)).toBe(SYSTEM_INHABITED_COLOR);
        });

    it('reads the docked ship\'s own components for the clearance', () => {
        const ship = new Entity();
        const legal = records();
        ship.components.set(LegalRecordsComponent, legal);
        ship.components.set(MissionsComponent, new Map());
        const read = gateMapClearancePlayer(ship, 1234);
        expect(read.records).toBe(legal);
        expect(read.missions).toEqual(new Map());
        expect(read.bribes).toBeUndefined();
        expect(read.now).toBe(1234);
    });
});
