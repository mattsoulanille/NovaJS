// The galaxy as DATA, before anything is drawn: which systems exist for the
// player, which one of a stacked spot answers clicks, which lanes are known,
// and what is reachable. Pure (no PIXI) so every rule here is unit-testable
// (starmap_test.ts); SystemGraph (system_graph.ts) builds itself from these.
import { SystemData } from "novadatainterface/system_data";
import { DiscoveryLevel, linkKnown } from "../nova_plugin/discovery.js";
import { evaluateNCBTest } from "../nova_plugin/ncb.js";

/**
 * Whether a system exists for the player according to its visibility NCB
 * test, evaluated against the player's control bits. Nova swaps between
 * alternate copies of a system (stacked at the same map position) by
 * giving each a different visibility expression, e.g. the four Sols
 * at (0,0).
 */
export function systemVisible(system: SystemData,
    bits: ReadonlySet<number>): boolean {
    try {
        return evaluateNCBTest(system.visibility ?? '', {
            getBit: bit => bits.has(bit),
        });
    } catch (e) {
        // Show systems with malformed visibility expressions rather than
        // hiding parts of the map.
        console.warn(`Bad visibility NCB test for ${system.id}: ${e}`);
        return true;
    }
}

/**
 * Computes the system-to-system hypergate links to overlay on the map from a
 * spöb -> system index and a per-gate destination lookup. Pure (no PIXI, no
 * async) so it is unit-testable. `gateDestinations` maps a hypergate spöb
 * global id to the spöb global ids it links to; non-hypergate spöbs are absent.
 */
export function computeHypergateSystemLinks(
    systemOfSpob: Map<string, string>,
    gateDestinations: Map<string, string[]>): [string, string][] {
    const links: [string, string][] = [];
    for (const [spob, destinations] of gateDestinations) {
        const fromSystem = systemOfSpob.get(spob);
        if (!fromSystem) {
            continue;
        }
        for (const dest of destinations) {
            const toSystem = systemOfSpob.get(dest);
            if (toSystem) {
                links.push([fromSystem, toSystem]);
            }
        }
    }
    return links;
}

/**
 * Resolves hypergate link ids to the systems they connect, once per
 * unordered pair. Links touching a system not on the map (NCB-hidden) are
 * dropped, like normal jump links, and so are self-links.
 */
export function resolveGateLinks(systems: ReadonlyMap<string, SystemData>,
    gateLinks: readonly [string, string][]): [SystemData, SystemData][] {
    const resolved: [SystemData, SystemData][] = [];
    const seenGateLink = new Set<string>();
    for (const [a, b] of gateLinks) {
        const sa = systems.get(a);
        const sb = systems.get(b);
        if (!sa || !sb || a === b) {
            continue;
        }
        const key = [a, b].sort().join('<->');
        if (seenGateLink.has(key)) {
            continue;
        }
        seenGateLink.add(key);
        resolved.push([sa, sb]);
    }
    return resolved;
}

/** The map spot a system occupies: its exact map coordinates. */
export function placeKey(position: readonly number[]): string {
    return `${position[0]},${position[1]}`;
}

/**
 * Picks the ONE system each map spot should draw, label and answer clicks
 * for. Nova stacks copies of a system at the same coordinates and swaps
 * between them with control bits, so several can share a spot; NCB
 * visibility filtering usually collapses a stack to one already, and this
 * handles what is left (a plugin system with blank visibility stacked on a
 * stock one, or the player standing in a copy their bits say is hidden —
 * that one is kept on the map deliberately).
 *
 * THE CURRENT SYSTEM ALWAYS REPRESENTS ITS OWN SPOT. Clicking the spot you
 * are standing in must pin the system you are standing IN: pinning a
 * different id for the same place asks the router for a path from a system
 * to itself, which it answers by flying out to a neighbour and back — the
 * pilot enters the same system twice (Matthew's playtest, 2026-08-17).
 * Otherwise a system reachable from the current one is preferred over an
 * unreachable one, breaking ties by data order.
 *
 * Pure (no PIXI) so it is unit-testable.
 */
export function representativeSystems<
    T extends { id: string, position: readonly number[] }>(
        systems: readonly T[], currentSystem: string,
        reachable: (id: string) => boolean): T[] {
    const byPosition = new Map<string, T>();
    for (const system of systems) {
        const key = placeKey(system.position);
        const existing = byPosition.get(key);
        if (!existing || system.id === currentSystem) {
            byPosition.set(key, system);
            continue;
        }
        if (existing.id === currentSystem) {
            continue;
        }
        // Keep the existing pick unless this one is reachable and the
        // existing one isn't.
        if (!reachable(existing.id) && reachable(system.id)) {
            byPosition.set(key, system);
        }
    }
    return [...byPosition.values()];
}

/**
 * The hyperspace lanes to draw, one per unordered pair. A lane is
 * knowledge the player only has once they have BEEN to one of its ends
 * (discovery.ts linkKnown): that is exactly what the reference capture
 * shows — lanes fan out from every named system to its dim unnamed
 * neighbours, and the lone faraway mission dot sits connected to nothing.
 */
export function knownLinks(systems: ReadonlyMap<string, SystemData>,
    discoveryOf: (systemId: string) => DiscoveryLevel)
    : [SystemData, SystemData][] {
    const linksMap = new Map<string, [SystemData, SystemData]>();
    for (const [source, sourceSystem] of systems) {
        for (const dest of sourceSystem.links) {
            const linkEntry = [source, dest].sort().join('<->');
            const destSystem = systems.get(dest);
            if (destSystem && linkKnown(source, dest, discoveryOf)) {
                linksMap.set(linkEntry, [sourceSystem, destSystem]);
            }
        }
    }
    return [...linksMap.values()];
}

/**
 * Every system reachable by hyperspace from `start`, with the hop path
 * that reaches it (breadth-first over `links`). Only systems in `systems`
 * are expanded from, but the ids they link to are all recorded — a lane
 * into a system not on the map still counts as reaching it.
 */
export function reachablePaths(systems: ReadonlyMap<string, SystemData>,
    start: string): Map<string, string[]> {
    // Dijkstra's
    let frontier = new Set<string>([start]);
    const paths = new Map<string, string[]>([[start, []]]);

    while (true) {
        const newFrontier = new Set<string>();
        for (const id of frontier) {
            const system = systems.get(id);
            if (!system) {
                continue;
            }

            const path = paths.get(id);
            if (!path) {
                throw new Error(`Path to ${id} should exist`);
            }

            for (const link of system.links) {
                if (paths.has(link)) {
                    continue;
                }
                newFrontier.add(link);
                paths.set(link, [...path, link]);
            }
        }
        if (newFrontier.size === 0) {
            break;
        }
        frontier = newFrontier;
    }
    return paths;
}
