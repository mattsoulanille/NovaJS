import { isLeft } from "fp-ts/lib/Either.js";
import * as t from "io-ts";

/**
 * The hypergate graph and the server setting that decides how much of it a
 * single transit may cross.
 *
 * In the original game a hypergate offers only its own HyperLink1-8
 * destinations: the player hops from gate to adjacent gate (EVN Bible p. 61).
 * With the server's `hypergateTransitivity` setting on, a gate instead offers
 * every gate in its NETWORK — the connected component it belongs to — so one
 * transit can cross the whole reachable web at once. Multi-hop is still ONE
 * transit: gates carry no per-transit cost in the data (every stock gate's
 * spöb Fee is 0 and nothing consumes fuel), so there is nothing to charge
 * per hop.
 *
 * Everything here is pure, so the graph walk and the setting parse are unit
 * testable without a display world.
 *
 * WHY THIS IS A SERVER SETTING AND NOT A WORLD RESOURCE: the hypergate
 * destination is a player-local UI choice (the browser docks the ship, opens
 * the gate map, and re-inserts the ship in the destination system with the
 * chosen spöb written into its GateArrivalComponent). No simulation system
 * reads the setting — GateArrivalSystem only positions the ship at whatever
 * spöb the arrival marker names, adjacent or not — so the sim stays
 * bit-identical on every peer whatever the setting says, and no
 * server-distributed World Resource is needed. The value still comes from the
 * SERVER (settings/settings.json, served to every client over the settings
 * route) so that all clients in a room agree on what the gate map offers.
 */

/** The client-visible gameplay settings this module reads. */
export const HypergateSettingsType = t.partial({
    hypergateTransitivity: t.boolean,
});

/**
 * What an older settings file (or a malformed one) means: the original
 * game's adjacent-gates-only behavior.
 */
export const DEFAULT_HYPERGATE_TRANSITIVITY = false;

/**
 * Reads `hypergateTransitivity` out of a parsed settings.json. A missing key,
 * a non-boolean value, or a settings blob that isn't an object at all all
 * fall back to {@link DEFAULT_HYPERGATE_TRANSITIVITY}.
 */
export function parseHypergateTransitivity(settings: unknown): boolean {
    const decoded = HypergateSettingsType.decode(settings);
    if (isLeft(decoded)) {
        return DEFAULT_HYPERGATE_TRANSITIVITY;
    }
    return decoded.right.hypergateTransitivity
        ?? DEFAULT_HYPERGATE_TRANSITIVITY;
}

/**
 * The hypergate graph, as the gate map knows it.
 *
 * Nodes are spöb global ids; `links` maps each HYPERGATE spöb to its
 * HyperLink destinations. A destination that is not itself a key (stock data
 * has none, but a plug-in could link a gate at an ordinary stellar) is a leaf
 * node: reachable, but with no onward links of its own.
 */
export interface HypergateNetwork {
    /** Hypergate spöb global id -> its destination spöb global ids. */
    links: ReadonlyMap<string, readonly string[]>;
    /**
     * Spöbs that must never be offered as a destination nor traversed as an
     * intermediate hop: the DESTROYED gates, which fail the shared
     * `landable()` predicate (nova_plugin/core/landable.ts). In stock data these
     * are the 16 gates of the collapsed network, each with the spöb "can
     * land" bit clear and zero HyperLinks. Anything not listed is usable.
     */
    unusable?: ReadonlySet<string>;
}

function usable(network: HypergateNetwork, spob: string): boolean {
    return !network.unusable?.has(spob);
}

/**
 * The UNDIRECTED adjacency of the hypergate graph, over usable gates only.
 *
 * Stock EV Nova's hypergate links are fully symmetric — every one of the 19
 * working gates' HyperLinks is mirrored by a link back (verified over the
 * base "Nova Files" data: zero asymmetric edges) — but nothing in the spöb
 * format enforces that, so a plug-in can write a one-way link. Transitivity
 * treats links as undirected: the network is "the gates this web of lanes
 * connects", and a one-way lane still puts both ends in the same web. That
 * keeps the relation symmetric, which is what makes "the network" a
 * well-defined thing to offer from either end.
 */
export function hypergateAdjacency(
    network: HypergateNetwork): Map<string, Set<string>> {
    const adjacency = new Map<string, Set<string>>();
    const node = (id: string) => {
        let neighbors = adjacency.get(id);
        if (!neighbors) {
            neighbors = new Set();
            adjacency.set(id, neighbors);
        }
        return neighbors;
    };
    for (const [from, destinations] of network.links) {
        if (!usable(network, from)) {
            continue;
        }
        node(from);
        for (const to of destinations) {
            if (!usable(network, to)) {
                continue;
            }
            node(from).add(to);
            node(to).add(from);
        }
    }
    return adjacency;
}

/**
 * The connected components of the hypergate graph: each network of gates that
 * can reach each other through some chain of links. Destroyed gates are left
 * out entirely.
 *
 * Ids inside a component are sorted; components are ordered largest first,
 * ties broken by first id, so the result is stable.
 */
export function hypergateNetworkComponents(
    network: HypergateNetwork): string[][] {
    const adjacency = hypergateAdjacency(network);
    const seen = new Set<string>();
    const components: string[][] = [];
    for (const start of [...adjacency.keys()].sort()) {
        if (seen.has(start)) {
            continue;
        }
        const component: string[] = [];
        const stack = [start];
        seen.add(start);
        while (stack.length > 0) {
            const current = stack.pop()!;
            component.push(current);
            for (const neighbor of adjacency.get(current) ?? []) {
                if (!seen.has(neighbor)) {
                    seen.add(neighbor);
                    stack.push(neighbor);
                }
            }
        }
        components.push(component.sort());
    }
    components.sort((a, b) => b.length - a.length
        || (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
    return components;
}

/**
 * Every gate reachable from `from` through any chain of links, excluding
 * `from` itself and every unusable (destroyed) gate. This is `from`'s
 * component minus `from`.
 */
export function reachableGates(network: HypergateNetwork,
    from: string): string[] {
    if (!usable(network, from)) {
        return [];
    }
    const adjacency = hypergateAdjacency(network);
    const seen = new Set<string>([from]);
    const stack = [from];
    const reached: string[] = [];
    while (stack.length > 0) {
        const current = stack.pop()!;
        for (const neighbor of adjacency.get(current) ?? []) {
            if (seen.has(neighbor)) {
                continue;
            }
            seen.add(neighbor);
            reached.push(neighbor);
            stack.push(neighbor);
        }
    }
    return reached.sort();
}

/**
 * The gate spöbs a player standing on `from` may travel to.
 *
 * - `transitive` false (the original game): `from`'s own HyperLink
 *   destinations, exactly as before.
 * - `transitive` true: every gate in `from`'s network.
 *
 * Destroyed gates are excluded either way — a gate you cannot land on is not
 * a place a transit can put you — and the result is sorted so the offering is
 * stable.
 */
export function gateMapDestinations(network: HypergateNetwork, from: string,
    transitive: boolean): string[] {
    if (transitive) {
        return reachableGates(network, from);
    }
    if (!usable(network, from)) {
        return [];
    }
    return [...new Set(network.links.get(from) ?? [])]
        .filter(to => usable(network, to) && to !== from)
        .sort();
}
