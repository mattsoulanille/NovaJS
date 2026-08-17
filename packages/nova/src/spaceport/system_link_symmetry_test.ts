import 'jasmine';
import { SystemData } from 'novadatainterface/system_data';
import {
    getIntegrationGameData, getPluginGameData,
} from '../communication/simulation_test_fixture.js';
import { evaluateNCBTest } from '../nova_plugin/ncb.js';
import { buildAdjacency, shortestPath } from './route.js';

type GameData = Awaited<ReturnType<typeof getIntegrationGameData>>;

async function allSystems(gameData: GameData): Promise<SystemData[]> {
    const ids = [...(await gameData.ids).System].sort();
    return Promise.all(ids.map(id => gameData.data.System.get(id)));
}

/** The starmap's rule, with no control bits set: blank tests pass. */
function visible(system: SystemData): boolean {
    try {
        return evaluateNCBTest(system.visibility ?? '', { getBit: () => false });
    } catch {
        return true;
    }
}

/**
 * A hyperspace link is undirected — "Each system can be linked to up to 16
 * other systems, and the player can make hyperspace jumps back and forth
 * between them" (EVN Bible, the sÿst resource) — so only one end of an
 * edge has to declare it.
 *
 * NovaJS built its routing adjacency straight from each system's own
 * Con1-Con16, so a link declared from one end only was traversable in one
 * direction. The starmap DREW those edges (getUniqueLinks already keys
 * them undirected), which is why the symptom was a destination visible on
 * the map that no route would ever reach.
 */
describe('hyperspace links are undirected', () => {
    it('closes every one-way link in the stock data', async () => {
        // 49 of stock Nova's links are declared from one end only — every
        // swapped duplicate system (the five Glimmers, the Procyons,
        // SPC-1421) is entered through one, so before this each duplicate
        // was a one-way trip in.
        const systems = await allSystems(await getIntegrationGameData());
        expect(systems.length).withContext('the whole stock map')
            .toBeGreaterThan(500);
        const byId = new Map(systems.map(s => [s.id, s]));
        const oneWay: string[] = [];
        for (const system of systems) {
            for (const link of system.links) {
                const other = byId.get(link);
                if (other && !other.links.includes(system.id)) {
                    oneWay.push(`${system.id} -> ${link}`);
                }
            }
        }
        expect(oneWay).toEqual([]);
    }, 300_000);

    it('leaves a system\'s own declarations first and in resource order',
        async () => {
            // Link order feeds spawn choices in mission_ship_logic, so the
            // completed list has to be stable: declarations exactly as the
            // resource gives them, then the closed edges in id order.
            //
            // Sirius (nova:148) is the clearest case in stock data. It
            // declares Con 194, 193, 191, 192, 134 — unsorted, so the
            // prefix pins resource order — and five separate Glimmer
            // duplicates name it without being named back.
            const gameData = await getIntegrationGameData();
            const sirius = await gameData.data.System.get('nova:148');
            expect(sirius.links).toEqual([
                'nova:194', 'nova:193', 'nova:191', 'nova:192', 'nova:134',
                'nova:677', 'nova:678', 'nova:759', 'nova:760', 'nova:761',
            ]);
        }, 120_000);
});

/**
 * The Singularity plug-in adds two systems and hangs them off the stock
 * map by declaring links from ITS end only:
 *
 *   sÿst singularity:770 "AP Fringe IX"  Con -> singularity:769,
 *                                                nova:479, nova:563
 *
 * Nothing in the stock data names them, so with directed adjacency the
 * pair was an island: drawn on the starmap next to Fer'I'Jus, and
 * unreachable. This is Matthew's "can't get to AP Fringe IX".
 */
describe('AP Fringe IX from the Singularity plug-in', () => {
    const PLUGIN = 'singularity';
    const FRINGE_IX = `${PLUGIN}:770`;
    const FRINGE_XII = `${PLUGIN}:769`;
    /** Fer'I'Jus, the blank-visibility copy: the stock end of the edge. */
    const FERIJUS = 'nova:479';
    /** Kania: an ordinary stock starting point far from the fringe. */
    const START = 'nova:128';

    async function singularityData() {
        return getPluginGameData(PLUGIN);
    }

    it('is linked from the stock system it names', async () => {
        const gameData = await singularityData();
        if (!gameData) {
            pending('Singularity plug-in not installed');
            return;
        }
        const fringe = await gameData.data.System.get(FRINGE_IX);
        expect(fringe.name).toBe('AP Fringe IX');
        expect(fringe.links).withContext('declares its own end')
            .toContain(FERIJUS);

        const ferijus = await gameData.data.System.get(FERIJUS);
        expect(ferijus.links).withContext('and the stock end is closed')
            .toContain(FRINGE_IX);
    }, 300_000);

    it('is routable from a stock system over visible systems only',
        async () => {
            const gameData = await singularityData();
            if (!gameData) {
                pending('Singularity plug-in not installed');
                return;
            }
            const systems = (await allSystems(gameData)).filter(visible);
            const adjacency = buildAdjacency(systems);

            const path = shortestPath(adjacency, START, FRINGE_IX);
            expect(path).withContext('a route to AP Fringe IX exists')
                .not.toBeNull();
            // Every hop must be adjacent to the one before it: the sim
            // stages a jump destination off the departing system's links.
            let previous = START;
            for (const hop of path!) {
                expect(adjacency.get(previous) ?? [])
                    .withContext(`${previous} -> ${hop}`).toContain(hop);
                previous = hop;
            }
            expect(previous).toBe(FRINGE_IX);

            // And on through to the plug-in's other system.
            expect(shortestPath(adjacency, START, FRINGE_XII)).not.toBeNull();
        }, 300_000);
});
