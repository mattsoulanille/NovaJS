import 'jasmine';
import { SystemData } from 'novadatainterface/system_data';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { novaDataInstalled, requireNovaData } from '../test_support/nova_data_gate.js';
import {
    DISCOVERY_ENTERED, DISCOVERY_LANDED, DISCOVERY_UNKNOWN, DiscoveryLevel,
    drawnSystems, knownSystemProperties, linkKnown,
} from '../nova_plugin/player/discovery.js';
import { systemIsInhabited } from '../nova_plugin/core/landable.js';
import { buildAdjacency } from './route.js';
import {
    SYSTEM_INHABITED_COLOR, SYSTEM_UNEXPLORED_COLOR,
    SYSTEM_UNINHABITED_COLOR, systemDotColor,
} from './starmap_draw.js';

/**
 * ============================================================================
 * What the star map shows a pilot, against the real stock galaxy
 * ============================================================================
 *
 * SystemGraph itself cannot be built headlessly (PIXI.Graphics wants a
 * canvas), so this exercises the rules the graph is assembled from — the
 * drawn set, the label/dot rule and the properties gate — over the REAL
 * sÿst link graph, which is the part a toy fixture cannot check.
 *
 * The behaviour being pinned, measured on the original at 1:1 in
 * ui_screenshots/original_macos_screenshots/map/
 * map_zoomed_out_showing_far_away_mission.png:
 *
 *   level 2  landed within      blue/#c6c6c6 dot, labeled, everything shown
 *   level 1  entered            blue/#c6c6c6 dot, labeled, no goods/services
 *   level 0  one jump out       #424242 dot, NO label, nothing shown
 *   level 0  further out        not drawn at all
 *   level 0  active mission     #424242 dot, NO label, NO link lines
 */

/** sÿst nova:130 "Kania", the fresh pilot's starting system. */
const KANIA = 'nova:130';

describe('the star map and what the pilot knows', () => {
    let systems: SystemData[];
    let adjacency: ReturnType<typeof buildAdjacency>;
    let kania: SystemData;

    beforeEach(requireNovaData);
    beforeAll(async () => {
        if (!novaDataInstalled()) return; // each spec pends instead
        const gameData = await getIntegrationGameData();
        const ids = (await gameData.ids).System;
        systems = await Promise.all(
            ids.map(id => gameData.data.System.get(id)));
        adjacency = buildAdjacency(systems);
        kania = systems.find(s => s.id === KANIA)!;
    });

    describe('a pilot who has only ever been to Kania', () => {
        const levelOf = (id: string): DiscoveryLevel =>
            id === KANIA ? DISCOVERY_ENTERED : DISCOVERY_UNKNOWN;
        let drawn: Set<string>;

        beforeAll(() => {
            if (!novaDataInstalled()) return; // each spec pends instead
            drawn = drawnSystems([KANIA], adjacency, [], KANIA);
        });

        it('draws Kania and exactly its neighbours', () => {
            expect(drawn.has(KANIA)).toBeTrue();
            for (const link of kania.links) {
                expect(drawn.has(link)).withContext(link).toBeTrue();
            }
            expect(drawn.size).toBe(1 + new Set(kania.links).size);
        });

        it('leaves the rest of the galaxy off the map entirely', () => {
            // The stock galaxy is over a thousand systems; a new pilot sees
            // a handful. This is the whole point of the feature.
            expect(systems.length).toBeGreaterThan(drawn.size * 10);
            const twoHops = kania.links
                .flatMap(id => adjacency.get(id) ?? [])
                .filter(id => !drawn.has(id));
            expect(twoHops.length).toBeGreaterThan(0);
            for (const id of twoHops) {
                expect(drawn.has(id)).withContext(id).toBeFalse();
            }
        });

        it('labels Kania and nothing else', () => {
            const labeled = [...drawn].filter(
                id => levelOf(id) >= DISCOVERY_ENTERED);
            expect(labeled).toEqual([KANIA]);
        });

        it('draws the ring dim and Kania by what is in it', async () => {
            const gameData = await getIntegrationGameData();
            const getPlanet = async (id: string) =>
                gameData.data.Planet.get(id);
            const planets = new Map(await Promise.all(
                kania.planets.map(async id =>
                    [id, await getPlanet(id)] as const)));
            const inhabited = systemIsInhabited(kania.planets,
                id => planets.get(id));
            // Kania holds Port Kane, so it is a blue dot.
            expect(inhabited).toBeTrue();
            expect(systemDotColor(true, inhabited))
                .toBe(SYSTEM_INHABITED_COLOR);
            // The unexplored ring is dim whatever is actually in it.
            for (const link of kania.links) {
                expect(systemDotColor(levelOf(link) >= DISCOVERY_ENTERED, true))
                    .toBe(SYSTEM_UNEXPLORED_COLOR);
            }
        });

        it('draws every lane out of Kania and none between ring systems', () => {
            for (const link of kania.links) {
                expect(linkKnown(KANIA, link, levelOf))
                    .withContext(link).toBeTrue();
            }
            // Two systems in the ring that link to each other still get no
            // lane: neither has been visited, so the lane is not the
            // pilot's to know.
            for (const a of kania.links) {
                for (const b of adjacency.get(a) ?? []) {
                    if (b !== KANIA) {
                        expect(linkKnown(a, b, levelOf))
                            .withContext(`${a}<->${b}`).toBeFalse();
                    }
                }
            }
        });

        it('tells the pilot nothing about a ring system', () => {
            const ring = kania.links[0];
            expect(knownSystemProperties(levelOf(ring)))
                .toEqual({ identity: false, commerce: false });
        });

        it('withholds Kania\'s goods and services until they land', () => {
            expect(knownSystemProperties(DISCOVERY_ENTERED))
                .toEqual({ identity: true, commerce: false });
            expect(knownSystemProperties(DISCOVERY_LANDED))
                .toEqual({ identity: true, commerce: true });
        });
    });

    describe('an active mission far outside the known galaxy', () => {
        const levelOf = (id: string): DiscoveryLevel =>
            id === KANIA ? DISCOVERY_ENTERED : DISCOVERY_UNKNOWN;
        /** Somewhere the fresh pilot has no chance of having discovered. */
        let far: string;

        beforeAll(() => {
            if (!novaDataInstalled()) return; // each spec pends instead
            const near = drawnSystems([KANIA], adjacency, [], KANIA);
            far = systems.find(s => !near.has(s.id))!.id;
        });

        it('draws the destination however far away it is', () => {
            expect(drawnSystems([KANIA], adjacency, [far], KANIA).has(far))
                .toBeTrue();
        });

        it('leaves it unlabeled and connected to nothing', () => {
            expect(levelOf(far)).toBe(DISCOVERY_UNKNOWN);
            expect(systemDotColor(false, true)).toBe(SYSTEM_UNEXPLORED_COLOR);
            for (const neighbour of adjacency.get(far) ?? []) {
                expect(linkKnown(far, neighbour, levelOf))
                    .withContext(neighbour).toBeFalse();
            }
        });

        it('disappears again when the mission is aborted or completed', () => {
            // Nothing marks it any more, and it is still undiscovered and
            // adjacent to nothing the pilot knows.
            expect(drawnSystems([KANIA], adjacency, [], KANIA).has(far))
                .toBeFalse();
        });

        it('changes nothing for a destination already discovered', () => {
            const marked = drawnSystems([KANIA], adjacency, [KANIA], KANIA);
            const plain = drawnSystems([KANIA], adjacency, [], KANIA);
            expect([...marked].sort()).toEqual([...plain].sort());
        });
    });

    it('shows a landed-in system in full', () => {
        // The other end of the scale: a pilot who has landed everywhere
        // gets the map the reference captures show.
        const drawn = drawnSystems(systems.map(s => s.id), adjacency, [],
            KANIA);
        expect(drawn.size).toBeGreaterThanOrEqual(systems.length);
        expect(systemDotColor(true, false)).toBe(SYSTEM_UNINHABITED_COLOR);
        expect(knownSystemProperties(DISCOVERY_LANDED).commerce).toBeTrue();
    });
});
