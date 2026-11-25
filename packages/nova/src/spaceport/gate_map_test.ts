import "jasmine";
import { getDefaultMissionData } from "novadatainterface/mission_data";
import { MockGameData } from "novadatainterface/mock_game_data";
import { getDefaultPlanetData } from "novadatainterface/planet_data";
import { getDefaultSystemData, SystemData } from "novadatainterface/system_data";
import { Entity } from "nova_ecs/entity";
import * as PIXI from "pixi.js";
import { getIntegrationGameData } from "../communication/simulation_test_fixture.js";
import { gateMapMissionMarks } from "../display/gate_map_plugin.js";
import { MissionMapMark } from "../nova_plugin/missions/index.js";
import { ControlBitsComponent } from "../nova_plugin/ncb/index.js";
import {
    ActiveMission, DISCOVERY_ENTERED, DISCOVERY_UNKNOWN, MissionsComponent,
} from "../nova_plugin/player/index.js";
import { landable } from "../nova_plugin/core/index.js";
import {
    computeGateMapView, computeSelectableSystems,
    GateMapIndex, gateMapGraphOptions,
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
    async function stockGateMapIndex(): Promise<GateMapIndex> {
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
        return {
            systemById: new Map(systems.map(s => [s.id, s])),
            systemsOfSpob, network,
        };
    }

    // HG-V0a (nova:1402, in Vellos nova:424) has ONE HyperLink: HG-V02
    // (nova:1401, in VNP-002 nova:425). HG-Moash (nova:1416) sits four lanes
    // away in Moash (nova:366) — same network, not adjacent.
    const LEAF_GATE = 'nova:1402';
    const LEAF_SYSTEM = 'nova:424';

    /** What the map offers a fresh pilot (no bits) docked at HG-V0a. */
    async function offered(transitive: boolean) {
        return computeGateMapView(await stockGateMapIndex(), {
            gateSpob: LEAF_GATE, systemId: LEAF_SYSTEM, transitive,
            playerBits: new Set(),
        }).selectable;
    }

    it('offers only the adjacent system with transitivity OFF', async () => {
        const selectable = await offered(false);
        // VNP-002 (the copy a fresh pilot sees), and nothing else.
        expect([...new Set(selectable.values())]).toEqual(['nova:1401']);
        expect(selectable.get('nova:425')).toBe('nova:1401');
        expect(selectable.has('nova:366')).toBeFalse();
    }, 60_000);

    it('offers the whole network with transitivity ON', async () => {
        const selectable = await offered(true);
        // The adjacent one is still there...
        expect(selectable.get('nova:425')).toBe('nova:1401');
        // ...and so is Moash, four lanes away, mapped to its gate.
        expect(selectable.get('nova:366')).toBe('nova:1416');
        // All 18 other live gates are reachable, so a system holding each
        // is offered (the copy the player's bits show).
        expect([...new Set(selectable.values())].sort().length).toBe(18);
        // Never the gate the ship is standing on.
        expect([...selectable.values()]).not.toContain(LEAF_GATE);
        expect(selectable.has('nova:424')).toBeFalse();
    }, 60_000);

    it('never offers a destroyed gate\'s system, either way', async () => {
        for (const transitive of [false, true]) {
            const selectable = await offered(transitive);
            // nova:130 (HG-Aldebaran) is one of the 16 collapsed gates.
            expect([...selectable.values()]).not.toContain('nova:130');
        }
    }, 60_000);

    // HG-Kania (nova:1404) in Kania (nova:128).
    async function kania(transitive: boolean) {
        return computeGateMapView(await stockGateMapIndex(), {
            gateSpob: 'nova:1404', systemId: 'nova:128', transitive,
            playerBits: new Set(),
        });
    }

    it('draws only HG-Kania\'s own lanes, as arrows out of Kania, with '
        + 'transitivity OFF (the original)', async () => {
            const gameData = await getIntegrationGameData();
            const own = (await gameData.data.Planet.get('nova:1404'))
                .gate!.destinations;
            const v = await kania(false);
            expect(v.gateLinks.length).toBe(own.length);
            for (const [from] of v.gateLinks) {
                expect(from).toBe('nova:128');
            }
            expect([...new Set(v.selectable.values())].sort())
                .toEqual([...own].sort());
        }, 60_000);

    // All 19 working stock gates form one network (every stock link is
    // mirrored), so under transitivity a stock gate reaches them all and
    // the map draws every live lane — pointing away from Kania.
    it('draws every live stock lane under transitivity, none into Kania, '
        + 'and no destroyed gate', async () => {
            const v = await kania(true);
            expect(v.networkGates.length).toBe(19);
            expect(v.networkGates).not.toContain('nova:130');
            // The 25 lanes between live gates, each at least once.
            const pairs = new Set(v.gateLinks.map(l => [...l].sort().join()));
            expect(pairs.size).toBe(25);
            for (const [, to] of v.gateLinks) {
                expect(to).not.toBe('nova:128');
            }
            // Every offered system has a white route that starts at Kania
            // and ends at it.
            for (const system of v.selectable.keys()) {
                const route = v.routes.get(system)!;
                expect(route[0]![0]).withContext(system).toBe('nova:128');
                expect(route[route.length - 1]![1]).withContext(system)
                    .toBe(system);
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

/**
 * What the gate map draws and offers. MEASURED (reference "Gate map, wave
 * 24"): only the current gate's OWN links, as arrows out of the current
 * system; other networks, the rest of the gate's own network and one-way
 * lanes INTO the gate get no lane at all. (Matthew's playtest, 2026-11-24,
 * had already asked for the arpia plug-in's unreachable P-153 / P-173
 * network to go.) Transitivity, a NovaJS addition, offers and draws the
 * chain the gate's links reach, each followed in its own direction.
 */
describe('computeGateMapView', () => {
    /** A system holding `spobs`, visible under `visibility`. */
    function system(id: string, spobs: string[], visibility = ''): SystemData {
        return {
            ...getDefaultSystemData(), id, name: id, planets: spobs,
            visibility,
        };
    }

    /** An index over `systems` and `links`. */
    function makeIndex(systems: SystemData[], links: Map<string, string[]>,
        unusable: string[] = []): GateMapIndex {
        const systemsOfSpob = new Map<string, string[]>();
        for (const s of systems) {
            for (const spob of s.planets) {
                systemsOfSpob.set(spob,
                    [...systemsOfSpob.get(spob) ?? [], s.id]);
            }
        }
        return {
            systemById: new Map(systems.map(s => [s.id, s])),
            systemsOfSpob,
            network: { links, unusable: new Set(unusable) },
        };
    }

    /**
     * Two networks with no lane between them — A: a1 - a2 - a3, B: b1 - b2
     * — plus whatever `extra` systems and links a spec adds.
     */
    function index(extraSystems: SystemData[] = [],
        extraLinks: [string, string[]][] = [],
        unusable: string[] = []): GateMapIndex {
        const systems = [
            system('A1', ['a1', 'port']), system('A2', ['a2']),
            system('A3', ['a3']), system('B1', ['b1']), system('B2', ['b2']),
            ...extraSystems,
        ];
        const links = new Map<string, string[]>([
            ['a1', ['a2']], ['a2', ['a1', 'a3']], ['a3', ['a2']],
            ['b1', ['b2']], ['b2', ['b1']],
        ]);
        for (const [from, to] of extraLinks) {
            links.set(from, [...links.get(from) ?? [], ...to]);
        }
        return makeIndex(systems, links, unusable);
    }

    /**
     * The wave-24 rig: Kit Gates A1 <-> A2, B1 <-> B2, C1 -> C2 (one way),
     * C2 <-> C3, each gate alone in its system.
     */
    function wave24(): GateMapIndex {
        return makeIndex(
            ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'C3']
                .map(id => system(id, [id.toLowerCase()])),
            new Map([
                ['a1', ['a2']], ['a2', ['a1']], ['b1', ['b2']], ['b2', ['b1']],
                ['c1', ['c2']], ['c2', ['c3']], ['c3', ['c2']],
            ]));
    }

    function view(gateIndex: GateMapIndex, gateSpob: string,
        systemId: string, transitive: boolean, bits: number[] = []) {
        return computeGateMapView(gateIndex, {
            gateSpob, systemId, transitive, playerBits: new Set(bits),
        });
    }

    /** The drawn arrows, "from>to", sorted. */
    function arrows(links: [string, string][]): string[] {
        return links.map(([from, to]) => `${from}>${to}`).sort();
    }

    describe('the wave-24 rig, transitivity OFF (the original)', () => {
        it('at A1: one arrow A1 -> A2, A2 alone selectable, no B1 - B2 lane',
            () => {
                const v = view(wave24(), 'a1', 'A1', false);
                expect(arrows(v.gateLinks)).toEqual(['A1>A2']);
                expect([...v.selectable]).toEqual([['A2', 'a2']]);
                expect(arrows(v.routes.get('A2')!)).toEqual(['A1>A2']);
            });

        it('at C1: one arrow C1 -> C2; C3, two hops out, neither drawn nor '
            + 'selectable', () => {
                const v = view(wave24(), 'c1', 'C1', false);
                expect(arrows(v.gateLinks)).toEqual(['C1>C2']);
                expect([...v.selectable]).toEqual([['C2', 'c2']]);
            });

        it('at C2 (the one-way lane\'s far end): one arrow C2 -> C3; the '
            + 'incoming C1 -> C2 lane is not drawn, C1 not selectable', () => {
                const v = view(wave24(), 'c2', 'C2', false);
                expect(arrows(v.gateLinks)).toEqual(['C2>C3']);
                expect([...v.selectable]).toEqual([['C3', 'c3']]);
            });
    });

    describe('the wave-24 rig under transitivity (a NovaJS addition)', () => {
        it('at C1: the chain C1 -> C2 -> C3, both offered, C3\'s pick '
            + 'whitening the whole chain', () => {
                const v = view(wave24(), 'c1', 'C1', true);
                expect(arrows(v.gateLinks)).toEqual(['C1>C2', 'C2>C3']);
                expect([...v.selectable.keys()].sort()).toEqual(['C2', 'C3']);
                expect(v.routes.get('C3')).toEqual(
                    [['C1', 'C2'], ['C2', 'C3']]);
                expect(v.routes.get('C2')).toEqual([['C1', 'C2']]);
            });

        it('at C2: still never back along the one-way lane to C1', () => {
            const v = view(wave24(), 'c2', 'C2', true);
            expect(arrows(v.gateLinks)).toEqual(['C2>C3']);
            expect([...v.selectable.keys()]).toEqual(['C3']);
            expect(v.networkGates).toEqual(['c2', 'c3']);
        });

        it('at A1: other networks stay plain dots', () => {
            const v = view(wave24(), 'a1', 'A1', true);
            expect(arrows(v.gateLinks)).toEqual(['A1>A2']);
            expect([...v.selectable.keys()]).toEqual(['A2']);
        });
    });

    // Measured: reference "Wave-24 leftovers, wave 25", Kit Gate A1 with
    // ONLY its own system explored: the arrow A1 -> A2 at full length, no
    // dot or name at A2, and one click on it selected nothing.
    describe('an UNEXPLORED destination (wave 25)', () => {
        /** Only `entered` have been entered. */
        function known(...entered: string[]) {
            return (id: string) => entered.includes(id)
                ? DISCOVERY_ENTERED : DISCOVERY_UNKNOWN;
        }

        it('keeps its lane but is not offered', () => {
            const v = computeGateMapView(wave24(), {
                gateSpob: 'a1', systemId: 'A1', transitive: false,
                playerBits: new Set(), discoveryOf: known('A1'),
            });
            expect(arrows(v.gateLinks)).toEqual(['A1>A2']);
            expect([...v.selectable]).toEqual([]);
            expect(v.routes.size).toBe(0);
        });

        it('is offered once explored', () => {
            const v = computeGateMapView(wave24(), {
                gateSpob: 'a1', systemId: 'A1', transitive: false,
                playerBits: new Set(), discoveryOf: known('A1', 'A2'),
            });
            expect([...v.selectable]).toEqual([['A2', 'a2']]);
        });

        it('under transitivity, offers only the explored gates of the '
            + 'chain, the lanes all drawn', () => {
                const v = computeGateMapView(wave24(), {
                    gateSpob: 'c1', systemId: 'C1', transitive: true,
                    playerBits: new Set(), discoveryOf: known('C1', 'C3'),
                });
                expect(arrows(v.gateLinks)).toEqual(['C1>C2', 'C2>C3']);
                expect([...v.selectable.keys()]).toEqual(['C3']);
                expect(v.routes.get('C3')).toEqual(
                    [['C1', 'C2'], ['C2', 'C3']]);
            });
    });

    it('draws only the gate\'s own links with transitivity off, even inside '
        + 'a bigger network', () => {
            const v = view(index(), 'a1', 'A1', false);
            expect(v.networkGates).toEqual(['a1', 'a2', 'a3']);
            expect(arrows(v.gateLinks)).toEqual(['A1>A2']);
            expect([...v.selectable]).toEqual([['A2', 'a2']]);
            const middle = view(index(), 'a2', 'A2', false);
            expect(arrows(middle.gateLinks)).toEqual(['A2>A1', 'A2>A3']);
        });

    it('offers the reachable chain, and nothing past it, under transitivity, '
        + 'its lanes pointing away from the gate', () => {
            const v = view(index(), 'a1', 'A1', true);
            expect(arrows(v.gateLinks)).toEqual(['A1>A2', 'A2>A3']);
            expect([...v.selectable].sort()).toEqual(
                [['A2', 'a2'], ['A3', 'a3']]);
        });

    it('shows the other network from inside it, and only that one', () => {
        for (const transitive of [false, true]) {
            const v = view(index(), 'b2', 'B2', transitive);
            expect(v.networkGates).toEqual(['b1', 'b2']);
            expect(arrows(v.gateLinks)).toEqual(['B2>B1']);
            expect([...v.selectable]).toEqual([['B1', 'b1']]);
        }
    });

    it('never offers or draws a one-way lane from its far end, either way, '
        + 'and offers it from its near end', () => {
            // c1 -> a1, never a1 -> c1: arpia's finished Scheall gate and
            // stock HG-Koria have exactly this shape.
            const gateIndex = index([system('C1', ['c1'])], [['c1', ['a1']]]);
            for (const transitive of [false, true]) {
                const v = view(gateIndex, 'a1', 'A1', transitive);
                expect(v.selectable.has('C1')).withContext(`${transitive}`)
                    .toBeFalse();
                expect(arrows(v.gateLinks).some(a => a.includes('C1')))
                    .toBeFalse();
                expect(v.networkGates).toEqual(['a1', 'a2', 'a3']);
            }
            const off = view(gateIndex, 'c1', 'C1', false);
            expect(arrows(off.gateLinks)).toEqual(['C1>A1']);
            expect([...off.selectable]).toEqual([['A1', 'a1']]);
            const on = view(gateIndex, 'c1', 'C1', true);
            expect(arrows(on.gateLinks)).toEqual(
                ['A1>A2', 'A2>A3', 'C1>A1']);
            expect([...on.selectable.keys()].sort())
                .toEqual(['A1', 'A2', 'A3']);
        });

    it('does not walk through a gate the player\'s bits hide', () => {
        // h joins A and B, but its only system needs bit 5.
        const gateIndex = index([system('H', ['h'], 'b5')],
            [['a3', ['h']], ['h', ['a3', 'b1']], ['b1', ['h']]]);
        const hidden = view(gateIndex, 'a1', 'A1', true);
        expect(hidden.networkGates).toEqual(['a1', 'a2', 'a3']);
        expect(arrows(hidden.gateLinks)).toEqual(['A1>A2', 'A2>A3']);
        expect([...hidden.selectable.keys()].sort()).toEqual(['A2', 'A3']);

        const shown = view(gateIndex, 'a1', 'A1', true, [5]);
        expect(shown.networkGates).toEqual(
            ['a1', 'a2', 'a3', 'b1', 'b2', 'h']);
        expect(arrows(shown.gateLinks)).toEqual(
            ['A1>A2', 'A2>A3', 'A3>H', 'B1>B2', 'H>B1']);
        expect([...shown.selectable.keys()].sort()).toEqual(
            ['A2', 'A3', 'B1', 'B2', 'H']);
        expect(arrows(shown.routes.get('B2')!)).toEqual(
            ['A1>A2', 'A2>A3', 'A3>H', 'B1>B2', 'H>B1']);
    });

    it('keeps both heads on a lane between two gates the same hops out', () => {
        // a1 -> x, a1 -> y, x <-> y: x and y are both one hop out.
        const gateIndex = makeIndex(
            [system('A1', ['a1']), system('X', ['x']), system('Y', ['y'])],
            new Map([['a1', ['x', 'y']], ['x', ['y', 'a1']],
                ['y', ['x', 'a1']]]));
        const v = view(gateIndex, 'a1', 'A1', true);
        expect(arrows(v.gateLinks)).toEqual(['A1>X', 'A1>Y', 'X>Y', 'Y>X']);
    });

    it('does not walk through a destroyed gate', () => {
        const gateIndex = index([system('H', ['h'])],
            [['a3', ['h']], ['h', ['a3', 'b1']], ['b1', ['h']]], ['h']);
        const v = view(gateIndex, 'a1', 'A1', true);
        expect(v.networkGates).toEqual(['a1', 'a2', 'a3']);
        expect(arrows(v.gateLinks)).toEqual(['A1>A2', 'A2>A3']);
        expect(v.selectable.has('B1')).toBeFalse();
    });

    it('draws a lane to, and offers, the visible copy of a stacked system',
        () => {
            // a2's system is swapped by bit 7 for a stacked copy.
            const gateIndex = index([system('A2x', ['a2'], 'b7')]);
            (gateIndex.systemById.get('A2') as SystemData).visibility = '!b7';
            const before = view(gateIndex, 'a1', 'A1', false);
            expect(arrows(before.gateLinks)).toEqual(['A1>A2']);
            expect([...before.selectable]).toEqual([['A2', 'a2']]);

            const after = view(gateIndex, 'a1', 'A1', false, [7]);
            expect(arrows(after.gateLinks)).toEqual(['A1>A2x']);
            expect([...after.selectable]).toEqual([['A2x', 'a2']]);
            expect(arrows(after.routes.get('A2x')!)).toEqual(['A1>A2x']);
            expect(arrows(view(gateIndex, 'a1', 'A1', true, [7]).gateLinks))
                .toEqual(['A1>A2x', 'A2x>A3']);
        });

    it('works from a gate in a copy the player\'s bits say is hidden', () => {
        const gateIndex = index();
        (gateIndex.systemById.get('A1') as SystemData).visibility = 'b9';
        const v = view(gateIndex, 'a1', 'A1', true);
        expect(v.networkGates).toEqual(['a1', 'a2', 'a3']);
        expect(arrows(v.gateLinks)).toEqual(['A1>A2', 'A2>A3']);
        expect([...v.selectable.keys()].sort()).toEqual(['A2', 'A3']);
    });

    it('hands the player\'s bits and the pick routes to the graph', () => {
        const bits = new Set([7]);
        expect(gateMapGraphOptions([], new Set(), [], undefined, undefined,
            undefined, bits).playerBits).toBe(bits);
        expect(gateMapGraphOptions([], new Set()).playerBits).toBeUndefined();
        const routes = new Map<string, [string, string][]>(
            [['b', [['a', 'b']]]]);
        expect(gateMapGraphOptions([['a', 'b']], new Set(['b']), [],
            undefined, undefined, undefined, undefined, routes).gateRoutes)
            .toBe(routes);
    });

    it('draws a gate-only system grey: a gate settles nothing', () => {
        // The portSpobs the map passes are landable.ts isSettledPort ones,
        // so a system whose only port is a gate is not inhabited
        // (#c6c6c6, Kit Gate B1 / B2 on the original's gate map).
        const options = gateMapGraphOptions([], new Set(), [], undefined,
            new Set(['port']));
        expect(options.isSystemInhabited!(system('A1', ['a1', 'port'])))
            .toBeTrue();
        expect(options.isSystemInhabited!(system('B1', ['b1']))).toBeFalse();
    });
});
