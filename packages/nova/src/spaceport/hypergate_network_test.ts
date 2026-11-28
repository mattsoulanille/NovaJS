import "jasmine";
import fs from "fs";
import path from "path";
import { getIntegrationGameData } from "../communication/simulation_test_fixture.js";
import { landable } from "../nova_plugin/core/index.js";
import {
    DEFAULT_HYPERGATE_TRANSITIVITY, gateCycleOrder, gateMapDestinations,
    HypergateNetwork,
    hypergateNetworkComponents, hypergateReach, parseHypergateTransitivity,
    reachableGates,
} from "./hypergate_network.js";

/** The stock working network: 19 gates, all mutually reachable. */
const WORKING_NETWORK = [
    'nova:1400', // HG-V01
    'nova:1401', // HG-V02
    'nova:1402', // HG-V0a
    'nova:1403', // HG-V0b
    'nova:1404', // HG-Kania
    'nova:1405', // HG-Tichel
    'nova:1406', // HG-Alphara
    'nova:1407', // HG-Primus
    'nova:1408', // HG-Secundus
    'nova:1409', // HG-Kerella
    'nova:1410', // HG-Gateway
    'nova:1411', // HG-S. Manchester
    'nova:1412', // HG-Tekel
    'nova:1413', // HG-Dani
    'nova:1414', // HG-Aurora
    'nova:1415', // HG-Heraan
    'nova:1416', // HG-Moash
    'nova:1417', // HG-Vella
    'nova:1418', // HG-Koria
];

/** The 16 DESTROYED gates of the collapsed network (landable() false). */
const DESTROYED_GATES = [
    'nova:130', 'nova:131', 'nova:178', 'nova:231', 'nova:471', 'nova:490',
    'nova:493', 'nova:494', 'nova:495', 'nova:496', 'nova:497', 'nova:498',
    'nova:499', 'nova:500', 'nova:501', 'nova:502',
];

/** HG-V0a (nova:1402, in Vellos) has exactly ONE HyperLink: HG-V02. */
const LEAF_GATE = 'nova:1402';
const LEAF_GATE_NEIGHBOR = 'nova:1401';
/** HG-Moash: same network as HG-V0a, but four hops away. */
const FAR_GATE = 'nova:1416';

/**
 * The hypergate graph of the stock base data, built the way the gate map
 * builds it: every hypergate's HyperLinks, with the unlandable (destroyed)
 * gates marked destroyed through the shared landable() predicate.
 */
async function stockNetwork(): Promise<HypergateNetwork> {
    const gameData = await getIntegrationGameData();
    const ids = await gameData.ids;
    const planets = await Promise.all(
        ids.Planet.map(id => gameData.data.Planet.get(id)));
    const links = new Map<string, string[]>();
    const destroyed = new Set<string>();
    for (const planet of planets) {
        if (!landable(planet)) {
            destroyed.add(planet.id);
        }
        if (planet.gate?.kind === 'hypergate') {
            links.set(planet.id, planet.gate.destinations);
        }
    }
    return { links, destroyed };
}

describe('the hypergateTransitivity setting', () => {
    it('defaults to the original game\'s behavior when the key is absent',
        () => {
            expect(DEFAULT_HYPERGATE_TRANSITIVITY).toBeFalse();
            // An older settings file that predates the setting.
            expect(parseHypergateTransitivity({ jumpVisual: 'flash' }))
                .toBeFalse();
            expect(parseHypergateTransitivity({})).toBeFalse();
        });

    it('reads an explicit boolean', () => {
        expect(parseHypergateTransitivity({ hypergateTransitivity: true }))
            .toBeTrue();
        expect(parseHypergateTransitivity({ hypergateTransitivity: false }))
            .toBeFalse();
    });

    it('falls back to the default for junk rather than throwing', () => {
        expect(parseHypergateTransitivity({ hypergateTransitivity: 'yes' }))
            .toBeFalse();
        expect(parseHypergateTransitivity(undefined)).toBeFalse();
        expect(parseHypergateTransitivity(null)).toBeFalse();
        expect(parseHypergateTransitivity('not settings at all')).toBeFalse();
        expect(parseHypergateTransitivity(42)).toBeFalse();
    });

    it('is ON in the checked-in server settings file', () => {
        // The setting is SERVER-owned: settings/settings.json is served to
        // every client over the settings route, so all clients in a room
        // agree on what the gate map offers.
        const settings = JSON.parse(fs.readFileSync(
            path.join(process.cwd(), 'settings', 'settings.json'), 'utf8'));
        expect(settings.hypergateTransitivity).toBeTrue();
        expect(parseHypergateTransitivity(settings)).toBeTrue();
    });
});

describe('hypergate network components', () => {
    it('separates disjoint networks', () => {
        // a - b - c   and   d - e
        const network: HypergateNetwork = {
            links: new Map([
                ['a', ['b']],
                ['b', ['a', 'c']],
                ['c', ['b']],
                ['d', ['e']],
                ['e', ['d']],
            ]),
        };
        expect(hypergateNetworkComponents(network))
            .toEqual([['a', 'b', 'c'], ['d', 'e']]);
    });

    it('treats a one-way link as joining both ends into one network, but '
        + 'reaches only along it', () => {
            // Stock data has no one-way links, but the spöb format allows
            // one: "the network" is the web of lanes, from either end...
            const network: HypergateNetwork = {
                links: new Map([['a', ['b']], ['b', []]]),
            };
            expect(hypergateNetworkComponents(network)).toEqual([['a', 'b']]);
            // ...while a chain of transits follows each lane's direction:
            // the original neither draws nor offers a one-way lane from its
            // far end (reference "Gate map, wave 24", Kit Gate C2).
            expect(reachableGates(network, 'a')).toEqual(['b']);
            expect(reachableGates(network, 'b')).toEqual([]);
        });

    it('chains one-way lanes forward only (Kit Gates C1 -> C2 <-> C3)', () => {
        const network: HypergateNetwork = {
            links: new Map([['c1', ['c2']], ['c2', ['c3']], ['c3', ['c2']]]),
        };
        expect(gateMapDestinations(network, 'c1', true)).toEqual(['c2', 'c3']);
        expect(gateMapDestinations(network, 'c2', true)).toEqual(['c3']);
        expect(gateMapDestinations(network, 'c3', true)).toEqual(['c2']);
        const reach = hypergateReach(network, 'c1');
        expect([...reach.hops]).toEqual([['c1', 0], ['c2', 1], ['c3', 2]]);
        expect([...reach.via]).toEqual([['c2', 'c1'], ['c3', 'c2']]);
    });

    it('keeps destroyed gates out of every network', () => {
        const network: HypergateNetwork = {
            links: new Map([
                ['a', ['dead']],
                ['dead', ['a', 'c']],
                ['c', ['dead']],
            ]),
            destroyed: new Set(['dead']),
        };
        // A destroyed gate is not a node, and it does not bridge a and c.
        expect(hypergateNetworkComponents(network)).toEqual([['a'], ['c']]);
        // A lane still reaches it (wave 56), but nothing goes on from it.
        expect(reachableGates(network, 'a')).toEqual(['dead']);
        expect(reachableGates(network, 'dead')).toEqual([]);
    });

    it('leaves a gate that is not there at all unreached', () => {
        const network: HypergateNetwork = {
            links: new Map([['a', ['hidden', 'b']], ['hidden', ['c']],
                ['b', []], ['c', []]]),
            unusable: new Set(['hidden']),
        };
        expect(reachableGates(network, 'a')).toEqual(['b']);
        expect(gateMapDestinations(network, 'a', false)).toEqual(['b']);
        expect(gateCycleOrder(network, 'a', true)).toEqual(['b']);
    });

    it('finds exactly ONE live network in the stock data', async () => {
        const network = await stockNetwork();
        const components = hypergateNetworkComponents(network);
        expect(components.length).toBe(1);
        expect(components[0]).toEqual(WORKING_NETWORK);
    }, 60_000);

    it('leaves the 16 collapsed-network gates out of every component',
        async () => {
            const network = await stockNetwork();
            // They are all in the data as hypergates...
            for (const gate of DESTROYED_GATES) {
                expect(network.links.has(gate)).toBeTrue();
                expect(network.links.get(gate)).toEqual([]);
                expect(network.destroyed!.has(gate)).toBeTrue();
            }
            // ...but none of them is offered anywhere.
            const reachable =
                new Set(hypergateNetworkComponents(network).flat());
            for (const gate of DESTROYED_GATES) {
                expect(reachable.has(gate)).toBeFalse();
            }
            // Without the landable filter they would each be their own
            // (useless) one-gate component: 1 live + 16 dead = 17.
            const unfiltered = hypergateNetworkComponents(
                { links: network.links });
            expect(unfiltered.length).toBe(17);
            expect(unfiltered[0]).toEqual(WORKING_NETWORK);
        }, 60_000);
});

describe('what a gate offers', () => {
    it('offers only the direct HyperLinks with transitivity off', async () => {
        const network = await stockNetwork();
        // HG-V0a is a leaf: one lane, to HG-V02.
        expect(gateMapDestinations(network, LEAF_GATE, false))
            .toEqual([LEAF_GATE_NEIGHBOR]);
        expect(gateMapDestinations(network, LEAF_GATE, false))
            .not.toContain(FAR_GATE);
    }, 60_000);

    it('offers the whole network with transitivity on', async () => {
        const network = await stockNetwork();
        const offered = gateMapDestinations(network, LEAF_GATE, true);
        // Every gate in the live network except the one you stand on.
        expect(offered)
            .toEqual(WORKING_NETWORK.filter(g => g !== LEAF_GATE));
        // Including HG-Moash, which is nowhere near HG-V0a.
        expect(offered).toContain(FAR_GATE);
    }, 60_000);

    it('never offers the gate the ship is standing on', async () => {
        const network = await stockNetwork();
        for (const gate of WORKING_NETWORK) {
            expect(gateMapDestinations(network, gate, true)).not.toContain(gate);
            expect(gateMapDestinations(network, gate, false))
                .not.toContain(gate);
        }
    }, 60_000);

    it('offers nothing from a destroyed gate, either way', async () => {
        const network = await stockNetwork();
        for (const gate of DESTROYED_GATES) {
            expect(gateMapDestinations(network, gate, false)).toEqual([]);
            expect(gateMapDestinations(network, gate, true)).toEqual([]);
        }
    }, 60_000);

    // Reference "Tab on the hypergate map, wave 56", run b: HG-Tichel
    // linked to the destroyed HG-Aldebaran offered it, and Done transited
    // there.
    it('offers a destroyed gate a link names, and goes no further', () => {
        const network: HypergateNetwork = {
            links: new Map([['a', ['dead', 'b']], ['b', ['a']],
                ['dead', ['c']], ['c', []]]),
            destroyed: new Set(['dead']),
        };
        expect(gateMapDestinations(network, 'a', false))
            .toEqual(['b', 'dead']);
        expect(gateMapDestinations(network, 'a', true))
            .toEqual(['b', 'dead']);
        expect(hypergateReach(network, 'a').via.get('dead')).toBe('a');
    });

    it('de-duplicates a gate that is linked twice', () => {
        const network: HypergateNetwork = {
            links: new Map([['a', ['b', 'b']], ['b', ['a']]]),
        };
        expect(gateMapDestinations(network, 'a', false)).toEqual(['b']);
    });
});

describe('gateCycleOrder (Tab on the gate map)', () => {
    // Reference "Tab on the hypergate map, wave 56": HG-Tichel's links
    // reordered to [Primus, Kania, (destroyed) Aldebaran, Alphara] were
    // cycled in exactly that slot order, not by id or distance.
    it('follows the gate\'s HyperLink slots, not id order', () => {
        const network: HypergateNetwork = {
            links: new Map([['tichel', ['primus', 'kania', 'alphara']]]),
        };
        expect(gateCycleOrder(network, 'tichel', false))
            .toEqual(['primus', 'kania', 'alphara']);
    });

    it('holds the same gates gateMapDestinations offers', () => {
        const network: HypergateNetwork = {
            links: new Map([
                ['a', ['c', 'dead', 'b', 'c', 'a']], ['b', ['d']],
                ['c', ['a']], ['d', []], ['dead', ['e']], ['e', []],
            ]),
            destroyed: new Set(['dead']),
        };
        for (const transitive of [false, true]) {
            expect([...gateCycleOrder(network, 'a', transitive)].sort())
                .toEqual(gateMapDestinations(network, 'a', transitive));
        }
        // The destroyed gate keeps its slot (wave 56, run b).
        expect(gateCycleOrder(network, 'a', false))
            .toEqual(['c', 'dead', 'b']);
        // Under transitivity, the gates further out follow, breadth first;
        // nothing past the destroyed gate.
        expect(gateCycleOrder(network, 'a', true))
            .toEqual(['c', 'dead', 'b', 'd']);
    });

    it('is empty at a destroyed gate', () => {
        const network: HypergateNetwork = {
            links: new Map([['dead', ['a']], ['a', []]]),
            destroyed: new Set(['dead']),
        };
        expect(gateCycleOrder(network, 'dead', true)).toEqual([]);
    });

    it('cycles stock HG-Tichel as Kania, Alphara, Primus', async () => {
        const network = await stockNetwork();
        expect(gateCycleOrder(network, 'nova:1405', false))
            .toEqual(['nova:1404', 'nova:1406', 'nova:1407']);
    }, 60_000);
});
