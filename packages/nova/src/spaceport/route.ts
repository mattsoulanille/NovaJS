import { GameDate } from 'novadatainterface/player_start_data';

// Pure route-planning logic for the starmap. Kept free of PIXI / ECS
// dependencies so it can be unit tested in isolation.
//
// Two kinds of routes exist simultaneously (see
// ui_screenshots/original_macos_screenshots/map/notes.txt):
//   * The multi-jump route: an ordered list of "pinned" waypoint systems the
//     player shift-clicked. Gaps between consecutive pins (and between the
//     current system and the first pin) are auto-filled with the shortest
//     path. The original game had no auto-router — routes were built pin by
//     pin — so auto-routing only engages through shift-click gap filling.
//     Rendered as a STRONG green line.
//   * The single-jump route: one adjacent system chosen with a plain click
//     (or cycled with Tab). Rendered as a WEAKER green line.
//
// The multi-jump route always takes precedence for actual hyperspace jumps.
//
// DETERMINISM CONTRACT: the effective route feeds JumpRouteComponent, whose
// consumer (jump_plugin.ts beginJump) relies on every hop being a *link* of
// the system before it — that adjacency is what makes its getCached reads
// provably warm (makeSystem stages every linked system at genesis). Every
// function here that produces a route therefore only ever emits chains of
// adjacent systems; a pin that cannot be reached through links contributes
// nothing to the route (it stays pinned visually, but is skipped).

export type Adjacency = ReadonlyMap<string, readonly string[]>;

/**
 * Whether two system ids name the same PLACE. Nova stacks several copies of
 * one system at the same map position and swaps between them with control
 * bits (the two Sols at (0,0): nova:130 under `!(b147|b305)`, nova:531 under
 * `(b147|b305)`, both linked from Tichel). The copies have different ids but
 * are one system to the player, so a route that leads to a copy of where the
 * player already is flies them out and straight back in — they enter the
 * same system twice (Matthew's playtest, 2026-08-17).
 *
 * Injected rather than derived here because this module only knows ids and
 * links; the map passes a test over system names and coordinates
 * (starmap.ts). The default is plain id equality, which is what every caller
 * without stacked data wants.
 */
export type SamePlace = (a: string, b: string) => boolean;
const sameId: SamePlace = (a, b) => a === b;

export interface RouteState {
    /** Ordered waypoint systems the player pinned via shift-click. */
    pinned: string[];
    /** The chosen single-jump (adjacent) destination, if any. */
    single?: string;
}

export function emptyRouteState(): RouteState {
    return { pinned: [] };
}

/**
 * Builds a directed adjacency map from system link data. Links pointing to
 * systems not present in `systems` (e.g. NCB-hidden ones) are dropped so
 * routing never emits a hop the map can't see or the sim can't stage.
 */
export function buildAdjacency(
    systems: Iterable<{ id: string; links: readonly string[] }>):
    Map<string, string[]> {
    const known = new Set<string>();
    for (const s of systems) {
        known.add(s.id);
    }
    const adj = new Map<string, string[]>();
    for (const s of systems) {
        adj.set(s.id, s.links.filter(l => known.has(l)));
    }
    return adj;
}

/**
 * Breadth-first shortest path from `from` to `to`.
 * Returns the path *excluding* `from` and *including* `to`.
 * Returns `[]` when `from === to`, or `null` when `to` is unreachable.
 */
export function shortestPath(adj: Adjacency, from: string,
    to: string): string[] | null {
    if (from === to) {
        return [];
    }
    const prev = new Map<string, string>();
    const visited = new Set<string>([from]);
    let frontier: string[] = [from];
    while (frontier.length > 0) {
        const next: string[] = [];
        for (const id of frontier) {
            for (const link of adj.get(id) ?? []) {
                if (visited.has(link)) {
                    continue;
                }
                visited.add(link);
                prev.set(link, id);
                if (link === to) {
                    const path: string[] = [];
                    let cur: string | undefined = to;
                    while (cur !== undefined && cur !== from) {
                        path.push(cur);
                        cur = prev.get(cur);
                    }
                    path.reverse();
                    return path;
                }
                next.push(link);
            }
        }
        frontier = next;
    }
    return null;
}

/**
 * Expands the pinned waypoints into a full ordered route starting from (but
 * not including) `current`: consecutive anchors are joined with the shortest
 * path, so every pinned system the links can reach is always included. A pin
 * with no path from the previous anchor is SKIPPED (it stays pinned on the
 * map but contributes no hops) — emitting it directly would break the
 * adjacent-consecutive-hops contract the jump plugin's staging relies on.
 *
 * A pin that is the same PLACE as the anchor is skipped as well, not only
 * the same id: routing to a stacked duplicate of where the ship already is
 * would send it out and straight back in (see {@link SamePlace}).
 */
export function expandRoute(adj: Adjacency, current: string,
    pinned: readonly string[], samePlace: SamePlace = sameId): string[] {
    const route: string[] = [];
    let anchor = current;
    for (const pin of pinned) {
        if (samePlace(pin, anchor)) {
            continue;
        }
        const segment = shortestPath(adj, anchor, pin);
        if (segment === null) {
            continue;
        }
        for (const step of segment) {
            route.push(step);
        }
        anchor = pin;
    }
    return route;
}

/** Toggles a system's membership in the pinned waypoint list. */
export function togglePin(pinned: readonly string[], id: string): string[] {
    if (pinned.includes(id)) {
        return pinned.filter(p => p !== id);
    }
    return [...pinned, id];
}

/** Systems directly reachable from `current` in one jump. */
export function adjacentSystems(adj: Adjacency, current: string): string[] {
    return [...(adj.get(current) ?? [])];
}

/**
 * Cycles the single-jump destination through the current system's
 * neighbours. The cycle includes an "off" (undefined) slot so Tab can also
 * clear the route:
 *   undefined -> adj[0] -> adj[1] -> ... -> adj[n-1] -> undefined -> ...
 * `direction` may be +1 (forward) or -1 (backward).
 */
export function cycleSingle(adjacent: readonly string[],
    current: string | undefined, direction = 1): string | undefined {
    if (adjacent.length === 0) {
        return undefined;
    }
    const cycle: (string | undefined)[] = [undefined, ...adjacent];
    let index = cycle.indexOf(current);
    if (index === -1) {
        index = 0;
    }
    const step = direction < 0 ? -1 : 1;
    return cycle[(index + step + cycle.length) % cycle.length];
}

/**
 * The route hyperspace jumps actually follow. The multi-jump route always
 * takes precedence; the single-jump route is only used when no pinned
 * waypoint produces a route.
 */
export function effectiveRoute(adj: Adjacency, current: string,
    state: RouteState, samePlace: SamePlace = sameId): string[] {
    const multi = expandRoute(adj, current, state.pinned, samePlace);
    if (multi.length > 0) {
        return multi;
    }
    if (state.single !== undefined && !samePlace(state.single, current)
        && adjacentSystems(adj, current).includes(state.single)) {
        return [state.single];
    }
    return [];
}

/**
 * Brings persisted route state up to date when the map opens in `current`:
 *  - pins the player has arrived at fall off the front of the waypoint list;
 *  - a single-jump destination that is no longer adjacent (completed, or the
 *    player went elsewhere) is cleared;
 *  - when the persisted state is empty but the simulation still has a route
 *    (e.g. the page reloaded and the client-side map state was lost), the
 *    route is adopted by pinning each of its hops, which reproduces it
 *    exactly under expandRoute.
 * Pure: returns a new state.
 */
export function reconcileRouteState(state: RouteState, current: string,
    adj: Adjacency, simRoute: readonly string[],
    samePlace: SamePlace = sameId): RouteState {
    const pinned = [...state.pinned];
    // "Arrived at" by PLACE, not by id: a pin made under different control
    // bits can name another copy of the system the player is now in.
    while (pinned.length > 0 && samePlace(pinned[0]!, current)) {
        pinned.shift();
    }
    let single = state.single;
    if (single !== undefined
        && !adjacentSystems(adj, current).includes(single)) {
        single = undefined;
    }
    if (pinned.length === 0 && single === undefined && simRoute.length > 0) {
        if (simRoute.length === 1) {
            single = simRoute[0];
        } else {
            pinned.push(...simRoute);
        }
    }
    return { pinned, single };
}

// The galactic-calendar date readout, e.g. "Nov. 18th, 1177 NC" (see
// map/map_open_over_spaceport.png). Distinct from calendar.ts formatDate
// (the BBS header's "Wed, 18 Nov 1177" shape).
const MAP_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.',
    'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];

function ordinal(day: number): string {
    const rem100 = day % 100;
    if (rem100 >= 11 && rem100 <= 13) {
        return `${day}th`;
    }
    switch (day % 10) {
        case 1: return `${day}st`;
        case 2: return `${day}nd`;
        case 3: return `${day}rd`;
        default: return `${day}th`;
    }
}

/** Formats a game date the way the original's map does: "Mar. 17th, 1178 NC". */
export function formatMapDate(date: GameDate): string {
    const month = MAP_MONTHS[date.month - 1] ?? `M${date.month}`;
    return `${month} ${ordinal(date.day)}, ${date.year} NC`;
}

/**
 * The "Navigation Hazards:" line for a system, from its asteroid density
 * (sÿst asteroids, 0-16) and sensor interference. Tiers approximate the
 * original's strings ("Moderate asteroid field" for Sol's 8,
 * "Dense asteroid field" for 16-asteroid systems).
 */
export function hazardDescription(asteroids: number,
    interference = 0): string {
    const parts: string[] = [];
    if (asteroids > 10) {
        parts.push('Dense asteroid field');
    } else if (asteroids > 4) {
        parts.push('Moderate asteroid field');
    } else if (asteroids > 0) {
        parts.push('Light asteroid field');
    }
    if (interference > 0) {
        parts.push('Sensor interference');
    }
    return parts.length > 0 ? parts.join(', ') : 'None';
}
