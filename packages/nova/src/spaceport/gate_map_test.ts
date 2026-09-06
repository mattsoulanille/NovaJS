import "jasmine";
import { getDefaultMissionData } from "novadatainterface/mission_data";
import { MockGameData } from "novadatainterface/mock_game_data";
import { getDefaultPlanetData } from "novadatainterface/planet_data";
import { getDefaultSystemData } from "novadatainterface/system_data";
import { Entity } from "nova_ecs/entity";
import * as PIXI from "pixi.js";
import { getIntegrationGameData } from "../communication/simulation_test_fixture.js";
import { gateMapMissionMarks } from "../display/gate_map_plugin.js";
import { MissionMapMark } from "../nova_plugin/missions/mission_logic.js";
import { ControlBitsComponent } from "../nova_plugin/ncb/ncb_plugin.js";
import { ActiveMission, MissionsComponent } from "../nova_plugin/player/player_state_plugin.js";
import { landable } from "../nova_plugin/core/landable.js";
import {
    computeGateMapSelection, computeSelectableSystems, gateMapGraphOptions,
} from "./gate_map.js";
import { HypergateNetwork } from "./hypergate_network.js";
import { MissionUniverse } from "./mission_universe.js";

describe('computeSelectableSystems', () => {
    it('maps each neighbor system to its destination gate spöb', () => {
        const systemsOfSpob = new Map([
            ['gateB', ['systemB']],
            ['gateC', ['systemC', 'systemC-copy']],
        ]);
        const selectable = computeSelectableSystems(
            systemsOfSpob, ['gateB', 'gateC']);
        expect(selectable.get('systemB')).toBe('gateB');
        // Stacked NCB copies of a system both resolve to the same gate.
        expect(selectable.get('systemC')).toBe('gateC');
        expect(selectable.get('systemC-copy')).toBe('gateC');
        expect(selectable.size).toBe(3);
    });

    it('ignores destinations that are in no known system', () => {
        const selectable = computeSelectableSystems(
            new Map(), ['gateNowhere']);
        expect(selectable.size).toBe(0);
    });

    it('offers HG-V01\'s real neighbors from stock data', async () => {
        // HG-V01 (nova:1400) links to HG-V02 (nova:1401, in VNP-002) and
        // HG-S. Manchester (nova:1411). The picker must offer exactly the
        // systems containing those gates — the gate's immediate neighbors —
        // and map them back to the right destination spöbs.
        const gameData = await getIntegrationGameData();
        const ids = await gameData.ids;
        const systems = await Promise.all(
            ids.System.map(s => gameData.data.System.get(s)));
        const systemsOfSpob = new Map<string, string[]>();
        for (const system of systems) {
            for (const spob of system.planets) {
                const all = systemsOfSpob.get(spob) ?? [];
                all.push(system.id);
                systemsOfSpob.set(spob, all);
            }
        }
        const gate = await gameData.data.Planet.get('nova:1400');
        expect(gate.gate?.kind).toBe('hypergate');
        const selectable = computeSelectableSystems(
            systemsOfSpob, gate.gate!.destinations);

        // Every offered system maps to one of the gate's own links...
        for (const spob of selectable.values()) {
            expect(gate.gate!.destinations).toContain(spob);
        }
        // ...and VNP-002 (nova:425), which contains HG-V02, is offered.
        expect(selectable.get('nova:425')).toBe('nova:1401');
    }, 30_000);
});

describe('what the gate map offers per the transitivity setting', () => {
    /**
     * The stock hypergate graph plus the spöb -> systems index, exactly as
     * GateMap.build() assembles them.
     */
    async function stockGateMapIndex() {
        const gameData = await getIntegrationGameData();
        const ids = await gameData.ids;
        const systems = await Promise.all(
            ids.System.map(s => gameData.data.System.get(s)));
        const systemsOfSpob = new Map<string, string[]>();
        for (const system of systems) {
            for (const spob of system.planets) {
                const all = systemsOfSpob.get(spob) ?? [];
                all.push(system.id);
                systemsOfSpob.set(spob, all);
            }
        }
        const planets = await Promise.all(
            ids.Planet.map(id => gameData.data.Planet.get(id)));
        const links = new Map<string, string[]>();
        const unusable = new Set<string>();
        for (const planet of planets) {
            if (!landable(planet)) {
                unusable.add(planet.id);
            }
            if (planet.gate?.kind === 'hypergate') {
                links.set(planet.id, planet.gate.destinations);
            }
        }
        const network: HypergateNetwork = { links, unusable };
        return { systemsOfSpob, network };
    }

    // HG-V0a (nova:1402, in Vellos nova:424) has ONE HyperLink: HG-V02
    // (nova:1401, in VNP-002 nova:425). HG-Moash (nova:1416) sits four lanes
    // away in Moash (nova:366) — same network, not adjacent.
    const LEAF_GATE = 'nova:1402';

    it('offers only the adjacent system with transitivity OFF', async () => {
        const { systemsOfSpob, network } = await stockGateMapIndex();
        const selectable = computeGateMapSelection(
            systemsOfSpob, network, LEAF_GATE, false);
        // VNP-002 and its stacked NCB copy, and nothing else.
        expect([...new Set(selectable.values())]).toEqual(['nova:1401']);
        expect(selectable.get('nova:425')).toBe('nova:1401');
        expect(selectable.has('nova:366')).toBeFalse();
    }, 60_000);

    it('offers the whole network with transitivity ON', async () => {
        const { systemsOfSpob, network } = await stockGateMapIndex();
        const selectable = computeGateMapSelection(
            systemsOfSpob, network, LEAF_GATE, true);
        // The adjacent one is still there...
        expect(selectable.get('nova:425')).toBe('nova:1401');
        // ...and so is Moash, four lanes away, mapped to its gate.
        expect(selectable.get('nova:366')).toBe('nova:1416');
        // All 18 other live gates are reachable, so every system that holds
        // one is offered (stacked NCB copies included).
        expect([...new Set(selectable.values())].sort().length).toBe(18);
        // Never the gate the ship is standing on.
        expect([...selectable.values()]).not.toContain(LEAF_GATE);
        expect(selectable.has('nova:424')).toBeFalse();
    }, 60_000);

    it('never offers a destroyed gate\'s system, either way', async () => {
        const { systemsOfSpob, network } = await stockGateMapIndex();
        for (const transitive of [false, true]) {
            const selectable = computeGateMapSelection(
                systemsOfSpob, network, LEAF_GATE, transitive);
            // nova:130 (HG-Aldebaran) is one of the 16 collapsed gates.
            expect([...selectable.values()]).not.toContain('nova:130');
        }
    }, 60_000);
});

describe('the hypergate map keeps the starmap\'s mission marks', () => {
    function activeMission(partial: Partial<ActiveMission>): ActiveMission {
        return {
            id: 'nova:200', acceptedDay: 0, acceptedAt: 'nova:128',
            travelPlanet: null, returnPlanet: null, cargoType: -1,
            cargoQty: 0, cargoLoaded: false, travelDone: false,
            deadlineDay: null, ...partial,
        };
    }

    /** A universe stub: one known mission, one placed stellar. */
    function stubUniverse(): MissionUniverse {
        return {
            getMission: (id: string) =>
                id === 'nova:200' ? getDefaultMissionData() : undefined,
            systemIdOfPlanet: (planetId: string) =>
                planetId === 'nova:300' ? 'nova:400' : undefined,
        } as unknown as MissionUniverse;
    }

    it('derives the docked ship\'s marks (the entity is out of the world)',
        () => {
            const ship = new Entity('docked').addComponent(MissionsComponent,
                new Map([['nova:200',
                    activeMission({ travelPlanet: 'nova:300' })]]));
            expect(gateMapMissionMarks(ship, stubUniverse())).toEqual([
                {
                    systemId: 'nova:400', kind: 'destination',
                    missionId: 'nova:200',
                },
            ]);
        });

    it('gives no marks for a pilot with no missions', () => {
        expect(gateMapMissionMarks(new Entity('docked'), stubUniverse()))
            .toEqual([]);
    });

    // The gate map builds its SystemGraph in destination-PICKER mode
    // (selectable + gateLinks). Picker mode must not swallow the marks,
    // and the marks must not touch what is selectable.
    it('carries the marks into the picker-mode graph options', () => {
        const marks: MissionMapMark[] = [
            { systemId: 'nova:400', kind: 'destination', missionId: 'nova:200' },
        ];
        const options = gateMapGraphOptions([['a', 'b']], new Set(['b']),
            marks, PIXI.Texture.EMPTY);
        expect(options.missionMarks).toEqual(marks);
        expect(options.missionMarkTextures?.active).toBe(PIXI.Texture.EMPTY);
        // Still a destination picker over the gate lanes.
        expect([...options.selectable!]).toEqual(['b']);
        expect(options.gateLinks).toEqual([['a', 'b']]);
        // The BBS-viewed (green) marks are the mission computer's, not
        // this map's.
        expect(options.viewedMarks ?? []).toEqual([]);
    });

    it('draws no marks for a pilot with no missions, and none at all '
        + 'without the icon', () => {
            expect(gateMapGraphOptions([], new Set(), [], PIXI.Texture.EMPTY)
                .missionMarks).toEqual([]);
            expect(gateMapGraphOptions([], new Set(), undefined, undefined)
                .missionMarkTextures).toBeUndefined();
        });
});

/**
 * Review finding #65: the gate map's marks resolved a stellar's system
 * without the docked ship's control bits, so a destination stacked in
 * NCB-duplicate systems (Auroran LP I in nova:308 "!b995" / nova:765
 * "b995") was marked in the copy the graph filters out once the story
 * bit is set — and so never drawn.
 */
describe('the hypergate map\'s marks under NCB-stacked systems', () => {
    async function stackedUniverse(): Promise<MissionUniverse> {
        const gameData = new MockGameData();
        gameData.data.Mission.map.set('nova:737', {
            ...getDefaultMissionData(), id: 'nova:737',
        });
        gameData.data.Planet.map.set('nova:333', {
            ...getDefaultPlanetData(), id: 'nova:333', name: 'Auroran LP I',
        });
        gameData.data.System.map.set('nova:308', {
            ...getDefaultSystemData(), id: 'nova:308', name: 'SPC-1421',
            planets: ['nova:333'], visibility: '!b995', position: [10, 20],
        });
        gameData.data.System.map.set('nova:765', {
            ...getDefaultSystemData(), id: 'nova:765', name: 'SPC-1421',
            planets: ['nova:333'], visibility: 'b995', position: [10, 20],
        });
        const universe = new MissionUniverse(gameData);
        await universe.load();
        return universe;
    }

    function docked(bits: number[]): Entity {
        return new Entity('docked')
            .addComponent(ControlBitsComponent, new Set(bits))
            .addComponent(MissionsComponent, new Map([['nova:737', {
                id: 'nova:737', acceptedDay: 0, acceptedAt: 'nova:128',
                travelPlanet: null, returnPlanet: 'nova:333', cargoType: -1,
                cargoQty: 0, cargoLoaded: false, travelDone: false,
                deadlineDay: null,
            }]]));
    }

    it('marks the copy the docked ship\'s bits make visible', async () => {
        const universe = await stackedUniverse();
        expect(gateMapMissionMarks(docked([995]), universe)
            .map(m => m.systemId)).toEqual(['nova:765']);
        expect(gateMapMissionMarks(docked([]), universe)
            .map(m => m.systemId)).toEqual(['nova:308']);
    });
});
