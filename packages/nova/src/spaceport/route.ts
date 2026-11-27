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
//     pin — so auto-routing only engages through shift-click gap filling,
//     and is a NovaJS Enhancement the player can turn off (canPin's
//     `autoRoute`).
//     Rendered as a STRONG green line.
//   * The single-jump route: one adjacent system chosen with a plain click
//     (or cycled with Tab). Rendered as a WEAKER green line.
//
// The multi-jump route takes precedence for actual hyperspace jumps, with
// one exception: a single jump picked on the `h` minimap over the route is
// the next jump until the full map's Done (RouteState.singleFirst,
// measured in wave 41).
//
// DRAWN SYSTEMS ONLY (Matthew, 2026-11-23: "I should be allowed to plan a
// route through the undiscovered system. D-U-D is allowed. Surprisingly,
// also D-U-U-D is allowed." — reversing his explored-systems-only rule of
// 403c732a). The router fills gaps through every system the map DRAWS:
// the explored ones (the discovery record, discovery.ts) and the merely
// visible ones alike — the dim unexplored ring one jump out from explored
// space, and a mission destination drawn because a mission points at it.
// A system the map does not draw is never a hop. That is the original's
// behaviour (docs/reference_experiments.md M4, wave 2): pinning East
// (unexplored), Void (unexplored), then Far (explored) drew one route
// Hub -> East -> Void -> Far. So D-U-D and D-U-U-D both route, by a single
// shift-click (the gap fills with the shortest path) or pin by pin, while
// D-U-U-U-D does not: its middle system is two jumps from anything
// explored, so the map does not draw it. See {@link Passable}.
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

/**
 * Whether a route may pass THROUGH a system: true for every system the map
 * draws, explored or not, false for one it does not draw (see the DRAWN
 * SYSTEMS ONLY note above). Here an impassable system can still be a
 * route's final hop; it just cannot be an intermediate one, nor the anchor
 * any later segment starts from. (The map only takes clicks on what it
 * draws, so it never offers an undrawn system as a pin: in practice one
 * appears in no route at all.) The system the ship is in is always
 * passable — the route starts there whatever the predicate says.
 *
 * Injected like {@link SamePlace}: this module knows ids and links, not
 * what the pilot's map draws. The default (everything passable) is what
 * maps without a discovery record of their own want, and what the
 * pure-graph specs assume.
 */
export type Passable = (id: string) => boolean;
const everywhere: Passable = () => true;

export interface RouteState {
    /** Ordered waypoint systems the player pinned via shift-click. */
    pinned: string[];
    /** The chosen single-jump (adjacent) destination, if any. */
    single?: string;
    /**
     * `single` was picked on the `h` minimap over a multi-jump route, and
     * so is the NEXT jump in place of the route's first hop, until the
     * full map's Done (see {@link settleMiniMapPick}). MEASURED (reference
     * "Map keys, minimap routes and ctrl-clicks (K4, M2, M3), wave 41"):
     * with Hub -> East -> Void -> Far plotted, a minimap pick of SW turned
     * the nav readout from "Unexplored System" (East) to "Map SW" while the
     * map kept drawing the route; after the full map's Done the nav read
     * East again and the minimap drew no SW line.
     */
    singleFirst?: boolean;
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
 *
 * Only {@link Passable} systems are expanded through: `to` itself may be
 * impassable, but no intermediate hop may be. `from` is the caller's anchor and is not
 * checked.
 */
export function shortestPath(adj: Adjacency, from: string,
    to: string, passable: Passable = everywhere): string[] | null {
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
                if (passable(link)) {
                    next.push(link);
                }
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
 *
 * Segments only pass through {@link Passable} systems, and the route ENDS
 * at the first impassable pin it reaches: a later segment would have to
 * start from (fly through) that system, so every pin after it
 * contributes nothing, like an unreachable one.
 */
export function expandRoute(adj: Adjacency, current: string,
    pinned: readonly string[], samePlace: SamePlace = sameId,
    passable: Passable = everywhere): string[] {
    const route: string[] = [];
    let anchor = current;
    for (const pin of pinned) {
        if (anchor !== current && !passable(anchor)) {
            break;
        }
        if (samePlace(pin, anchor)) {
            continue;
        }
        const segment = shortestPath(adj, anchor, pin, passable);
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

/**
 * Whether shift-clicking `candidate` onto the end of `pinned` would extend
 * the multi-jump route to it — the gate on pinning a NEW waypoint. True
 * exactly when the expanded route with the candidate appended ends at the
 * candidate: there is a path from the route's current end to it through
 * passable (drawn) systems, and the route has not already ended in an
 * impassable one.
 *
 * A refused candidate is not pinned at all. Pinning it anyway (and letting
 * {@link expandRoute} skip it, as it does for a pin that went stale) would
 * leave a waypoint box on the map that the ship will never fly to, and
 * would quietly start contributing the moment exploring one more system
 * drew the missing hop of a path — a route the player never saw being
 * plotted.
 *
 * `autoRoute` is the NovaJS Enhancements "Map auto-routing" toggle: true
 * (NovaJS) fills the gap to the candidate with the shortest path; false
 * (the original) takes only a candidate one jump past the route's end.
 */
export function canPin(adj: Adjacency, current: string,
    pinned: readonly string[], candidate: string,
    samePlace: SamePlace = sameId, passable: Passable = everywhere,
    autoRoute = true): boolean {
    if (samePlace(candidate, current)) {
        return false;
    }
    const route = expandRoute(adj, current, [...pinned, candidate],
        samePlace, passable);
    const end = route[route.length - 1];
    const before = expandRoute(adj, current, pinned, samePlace, passable)
        .length;
    if (end === undefined || !samePlace(end, candidate)
        || before >= route.length) {
        return false;
    }
    // Without auto-routing (the original's rule, NovaJS Enhancements OFF)
    // a new pin must be ONE jump past the route's end: the original
    // ignores a shift-click it would have to plot a path to, whether the
    // systems on the way are unexplored (reference_experiments "Route
    // planning through unexplored systems, wave 10") or all explored
    // ("Multi-jump routes and the `j` key, wave 11"), so a route is built
    // pin by pin.
    return autoRoute || route.length === before + 1;
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
 * neighbours, in their sÿst link-slot order (`adjacent` is the system's
 * links as declared), wrapping from the last straight back to the first:
 *   adj[0] -> adj[1] -> ... -> adj[n-1] -> adj[0] -> ...
 * Unexplored neighbours are in the cycle like any other. With nothing (or
 * a non-neighbour) picked, forward starts at adj[0] and backward at
 * adj[n-1]. There is no "nothing selected" step: reference_experiments M7
 * (the original wraps from the last neighbour to the first, and Clear
 * Route is how a pick is dropped). `direction` may be +1 or -1.
 */
export function cycleSingle(adjacent: readonly string[],
    current: string | undefined, direction = 1): string | undefined {
    if (adjacent.length === 0) {
        return undefined;
    }
    const step = direction < 0 ? -1 : 1;
    const index = current === undefined ? -1 : adjacent.indexOf(current);
    if (index === -1) {
        return step > 0 ? adjacent[0] : adjacent[adjacent.length - 1];
    }
    return adjacent[(index + step + adjacent.length) % adjacent.length];
}

/**
 * The route hyperspace jumps actually follow. The multi-jump route takes
 * precedence; the single-jump route is only used when no pinned waypoint
 * produces a route, or when it was picked on the minimap over the route
 * ({@link RouteState.singleFirst}).
 */
export function effectiveRoute(adj: Adjacency, current: string,
    state: RouteState, samePlace: SamePlace = sameId,
    passable: Passable = everywhere): string[] {
    const single = state.single !== undefined
        && !samePlace(state.single, current)
        && adjacentSystems(adj, current).includes(state.single)
        ? state.single : undefined;
    if (single !== undefined && state.singleFirst) {
        return [single];
    }
    const multi = expandRoute(adj, current, state.pinned, samePlace,
        passable);
    if (multi.length > 0) {
        return multi;
    }
    return single !== undefined ? [single] : [];
}

/**
 * A pick on the `h` minimap: `system` (a neighbour of `current`) becomes
 * the single jump. Over a multi-jump route whose first hop is elsewhere,
 * it is also the next jump ({@link RouteState.singleFirst}); the route
 * itself is kept. Picking the route's own first hop changes nothing about
 * where the ship goes.
 */
export function pickOnMiniMap(adj: Adjacency, current: string,
    state: RouteState, system: string, samePlace: SamePlace = sameId,
    passable: Passable = everywhere): RouteState {
    const multi = expandRoute(adj, current, state.pinned, samePlace,
        passable);
    const overrides = multi.length > 0 && !samePlace(multi[0]!, system);
    return {
        pinned: [...state.pinned],
        single: system,
        ...(overrides ? { singleFirst: true } : {}),
    };
}

/**
 * The full map's Done after a minimap pick (wave 41, see
 * {@link RouteState.singleFirst}): a pick that was overriding a multi-jump
 * route is dropped, so the route's first hop is the next jump again. A
 * pick with no route left to override is kept, as a plain single jump.
 */
export function settleMiniMapPick(adj: Adjacency, current: string,
    state: RouteState, samePlace: SamePlace = sameId,
    passable: Passable = everywhere): RouteState {
    if (!state.singleFirst) {
        return state;
    }
    const multi = expandRoute(adj, current, state.pinned, samePlace,
        passable);
    return {
        pinned: [...state.pinned],
        single: multi.length > 0 ? undefined : state.single,
    };
}

/**
 * The hyperspace jump that brought the player into the system it is in:
 * the system it left and every hop it took, in order, the last being where
 * it arrived. One hop for an ordinary jump; a multi-jump (oütf ModType 32)
 * also lists the systems it passed through without entering (JumpComponent
 * `via`).
 */
export interface JumpArrival {
    from: string;
    hops: readonly string[];
}

/**
 * `pinned` without the pins a jump has reached: each leading pin the
 * jump's hops reach in order (matched by PLACE), and any pin that is the
 * same place as the last one reached (or as the jump's origin), which
 * {@link expandRoute} skips anyway. Stops at the first pin the hops do not
 * reach, so a route that comes back through a system the jump passed keeps
 * its later visit (Sol, Tichel, Sol, Kania flown two hops at once leaves
 * Sol, Kania).
 *
 * Exact for pins the flown route was expanded from: a segment's shortest
 * path reaches its pin only at its end, so the earliest match of each pin
 * after the previous pin's is where the jump reached it.
 *
 * A multi-jump never ARRIVES at the systems it passes through, so the
 * "drop the pins the player is standing in" rule alone left them at the
 * head of the list, and the map routed the player straight back to them.
 */
export function dropPassedPins(pinned: readonly string[],
    arrival: JumpArrival, samePlace: SamePlace = sameId): string[] {
    const rest = [...pinned];
    let anchor = arrival.from;
    let next = 0;
    while (rest.length > 0) {
        const pin = rest[0]!;
        if (samePlace(pin, anchor)) {
            rest.shift();
            continue;
        }
        let at = -1;
        for (let i = next; i < arrival.hops.length; i++) {
            if (samePlace(arrival.hops[i]!, pin)) {
                at = i;
                break;
            }
        }
        if (at === -1) {
            break;
        }
        rest.shift();
        anchor = arrival.hops[at]!;
        next = at + 1;
    }
    return rest;
}

/**
 * Brings persisted route state up to date when the map opens in `current`:
 *  - pins the jump that brought the player here reached fall off the front
 *    of the waypoint list ({@link dropPassedPins}; `arrival`, given once,
 *    the first time the map reconciles after that jump);
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
    samePlace: SamePlace = sameId, arrival?: JumpArrival): RouteState {
    const pinned = arrival
        ? dropPassedPins(state.pinned, arrival, samePlace)
        : [...state.pinned];
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
    // A minimap pick keeps its precedence while it is still a neighbour.
    const singleFirst = state.singleFirst === true && single !== undefined
        && single === state.single;
    return { pinned, single, ...(singleFirst ? { singleFirst } : {}) };
}

// The galactic-calendar date readout, e.g. "Nov. 18th, 1177 NC" (see
// map/map_open_over_spaceport.png). Distinct from calendar.ts formatDate
// (the BBS header's "Wed, 18 Nov 1177" shape). The abbreviations are the
// original's own, STR# 137 entries 13-24 in Nova-DF.rsrc: June and July
// stay whole and September is "Sept." (docs/reference_experiments.md).
const MAP_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June',
    'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

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
