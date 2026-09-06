/**
 * How much the player knows about each star system — the model behind the
 * star map's "what can I see, and what does it tell me" rules.
 *
 * GROUND TRUTH. The original pilot file stores exactly three states per
 * system (novaparse pilot_data.ts `exploration`, 2048 entries, sÿst id =
 * index + 128): "<= 0 unexplored, 1 visited, 2 visited and landed within".
 * The levels below are that field, so an imported pilot maps across 1:1.
 *
 * The EVN Bible exposes the same state to plug-in authors through the two
 * NCB operators — `Exxx` "Returns 1 if the player has explored system ID
 * xxx, 0 if not" (Bible :157) and `Xxxx` "make system ID xxx be explored"
 * (Bible :263) — and confirms it is saved with the pilot: the nëbu
 * OnExplore note (Bible :1751) says the nebulae's explored state "isn't
 * saved from game to game; rather, it is recalculated every time based on
 * the systems the player has explored".
 *
 * WHAT THE MAP DRAWS, measured on the original at 1:1 in
 * ui_screenshots/original_macos_screenshots/map/
 * map_zoomed_out_showing_far_away_mission.png (a mid-game pilot at Kania,
 * zoomed all the way out so most of the galaxy is in frame):
 *
 *  - Systems the player has entered draw a colored, LABELED dot (blue with
 *    a port, #c6c6c6 without — see starmap.ts systemDotColor).
 *  - Systems one hyperspace jump from one of those draw a dim #424242 dot
 *    with NO label, still joined by their link lines.
 *  - EVERYTHING ELSE IS NOT DRAWN AT ALL. Most of that screenshot is empty
 *    black: ~1300 stock systems exist, and the pilot's known neighbourhood
 *    is the only thing on the map.
 *  - The one exception is an active mission's destination: the bottom-right
 *    of that same capture holds a lone #424242 dot with the orange mission
 *    arrow beside it, unlabeled and joined to NOTHING. A mission you are
 *    carrying tells you where to go even when you have never been near it.
 *
 * This module is pure — no PIXI, no storage, no game data loads — so all of
 * it is unit-testable. discovery_store.ts holds the player's actual levels.
 */

/** Nothing known: hidden unless adjacent to a discovered system. */
export const DISCOVERY_UNKNOWN = 0;
/** Entered: the dot is colored and labeled, and its ports are listed. */
export const DISCOVERY_ENTERED = 1;
/** Landed within: services and traded goods are known too. */
export const DISCOVERY_LANDED = 2;

export type DiscoveryLevel =
    typeof DISCOVERY_UNKNOWN | typeof DISCOVERY_ENTERED | typeof DISCOVERY_LANDED;

/** Coerces any stored number to a level, clamping to the 0..2 range. */
export function toDiscoveryLevel(value: unknown): DiscoveryLevel {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return DISCOVERY_UNKNOWN;
    }
    return value >= DISCOVERY_LANDED ? DISCOVERY_LANDED : DISCOVERY_ENTERED;
}

/** Undirected hyperspace adjacency: system id -> the systems it links to. */
export type SystemAdjacency = ReadonlyMap<string, readonly string[]>;

/**
 * What the NCB `Exxx` / `Xxxx` operators need of the player's discovery
 * record — the read/write half of discovery_store.ts, threaded in as an
 * interface exactly as the player's owned outfits are threaded into crön
 * EnableOn.
 *
 * IT IS THREADED, NOT IMPORTED, for the reason the store's own header
 * gives: discovery is display/save-side, per-CLIENT state, and the modules
 * that evaluate NCB expressions (mission_logic, cron_logic) are pure logic
 * the simulation package also holds. Handing them an interface keeps the
 * store out of them and keeps them unit-testable without a browser.
 */
export interface DiscoveryAccess {
    /** How much the player knows about `systemId` (0 when unknown). */
    level(systemId: string): DiscoveryLevel;
    /** Raises `systemId` to at least {@link DISCOVERY_ENTERED}. */
    markVisited(systemId: string): void;
}

/** The two NCB operators, with their sÿst ids already resolvable. */
export interface DiscoveryNCBOperators {
    /** `Exxx`: has the player explored sÿst xxx? */
    hasExplored(id: number): boolean;
    /** `Xxxx`: make sÿst xxx be explored. */
    exploreSystem(id: number): void;
}

/** Operator spellings already warned about, so a cron cannot spam the log. */
const warnedUnknownSystems = new Set<string>();

/**
 * The `Exxx` / `Xxxx` operators over a discovery record.
 *
 * SEMANTICS, from the EVN Bible. `Exxx` "Returns 1 if the player has
 * explored system ID xxx, 0 if not" (:157) and `Xxxx` "make system ID xxx
 * be explored" (:263). "Explored" is the pilot file's level 1 — the nëbu
 * OnExplore note (:1751) says a nebula's explored state "is recalculated
 * every time based on the systems the player has explored", which is the
 * set of systems the pilot has BEEN to, not the subset they also landed
 * in. So `Exxx` is `level >= 1` and `Xxxx` raises to 1; a system already at
 * level 2 ("visited and landed within") is never knocked back down, since
 * the store only ever raises (discovery_store.ts markDiscovered).
 *
 * `resolveSystem` turns the bare resource number into a global sÿst id
 * under the ordinary id-space rule (stock first, then the writing plug-in's
 * own — mission_logic's resolveExistingNumberedResource), and returns
 * undefined when NO loaded sÿst has that number. An unresolvable id is
 * ignored with a one-time warning rather than inventing a system: `X9999`
 * would otherwise plant a phantom id in the pilot's save forever.
 */
export function discoveryNCBOperators(access: DiscoveryAccess,
    resolveSystem: (id: number) => string | undefined): DiscoveryNCBOperators {
    const warnUnknown = (id: number, operator: string) => {
        if (!warnedUnknownSystems.has(operator)) {
            warnedUnknownSystems.add(operator);
            console.warn(`NCB ${operator} names sÿst ${id}, which no loaded`
                + ` data set defines; ignoring.`);
        }
    };
    return {
        hasExplored: id => {
            const systemId = resolveSystem(id);
            if (systemId === undefined) {
                warnUnknown(id, `E${id}`);
                return false;
            }
            return access.level(systemId) >= DISCOVERY_ENTERED;
        },
        exploreSystem: id => {
            const systemId = resolveSystem(id);
            if (systemId === undefined) {
                warnUnknown(id, `X${id}`);
                return;
            }
            access.markVisited(systemId);
        },
    };
}

/** Test seam: forget which unknown sÿst ids have already been warned about. */
export function resetDiscoveryNCBWarnings(): void {
    warnedUnknownSystems.clear();
}

/**
 * Which systems the star map draws at all, given what the player knows.
 *
 * The union of:
 *  - every DISCOVERED system (level >= 1),
 *  - every system one jump from a discovered one (the dim unlabeled ring),
 *  - every `marked` system — an active mission's destination, which shows
 *    however far away it is (see the module comment).
 *
 * `alwaysShow` is the system the player is standing in: it is drawn even if
 * something has gone wrong with the record of it, for the same reason
 * SystemGraph never filters the current system out on NCB visibility.
 */
export function drawnSystems(discovered: Iterable<string>,
    adjacency: SystemAdjacency, marked: Iterable<string> = [],
    alwaysShow?: string): Set<string> {
    const drawn = new Set<string>();
    for (const id of discovered) {
        drawn.add(id);
        for (const neighbour of adjacency.get(id) ?? []) {
            drawn.add(neighbour);
        }
    }
    for (const id of marked) {
        drawn.add(id);
    }
    if (alwaysShow !== undefined) {
        drawn.add(alwaysShow);
    }
    return drawn;
}

/**
 * Whether a link between two drawn systems should be drawn.
 *
 * A mission destination far outside the known galaxy is drawn "connected to
 * nothing" (Matthew, and the reference capture): its link lines would give
 * away neighbours the player has no way of knowing about. A link is real
 * knowledge only when at least one END is a system the player has actually
 * been to — that is exactly the set of lines the reference shows around the
 * dim ring, and it leaves a marked-only dot bare.
 */
export function linkKnown(a: string, b: string,
    levelOf: (systemId: string) => DiscoveryLevel): boolean {
    return levelOf(a) >= DISCOVERY_ENTERED || levelOf(b) >= DISCOVERY_ENTERED;
}

/**
 * What the star map's properties column is allowed to show about a system.
 *
 * Two steps, matching what each act actually teaches the pilot (Matthew's
 * spec, and the pilot file's own "visited" vs "visited and landed within"):
 * FLYING IN shows you the system — its name, whose space it is, which of
 * its stellars are inhabited ports, what the navigation hazards are.
 * LANDING is what puts you in a spaceport, and only then do you learn what
 * the ports sell and what commodities they trade.
 */
export function knownSystemProperties(level: DiscoveryLevel): {
    /** Name, government, legal status, ports and navigation hazards. */
    identity: boolean,
    /** Goods Traded and Services. */
    commerce: boolean,
} {
    return {
        identity: level >= DISCOVERY_ENTERED,
        commerce: level >= DISCOVERY_LANDED,
    };
}

/** What {@link mapOutfitSystems} needs to know about each system. */
export interface MapOutfitSystem {
    id: string;
    /** The system's gövt id, or null/undefined for an independent system. */
    govt?: string | null;
    /** Whether the system holds at least one port (landable + inhabited). */
    inhabited: boolean;
}

/**
 * The systems an oütf ModType 16 "map" reveals, per the EVN Bible :1824:
 *
 *     16   map    1 and up  How many jumps away from present system to
 *                             explore
 *                 -1        Explore all inhabited independent systems
 *                 -1000     Explore all systems of this govt class (-1000
 *                  & down     is govt class 0, -1001 is govt class 1, etc.)
 *
 * Stock maps and their ModVals (the whole set in "Nova Files"): oütf
 * nova:204 "Map; Sol/Kel'ar Iy only" 1, nova:237 "Map" 3, nova:272 "Dr
 * Ralph's Exploration Map" 10, nova:342 "Area Map - Vell-os" 2, nova:433
 * "Map; Fed/Pol" 2, nova:434 "Map; Reb/Pir/Aur" 3. The three purchasable
 * ones cost 1000 cr and are stocked through SpecialTech 80/81/82.
 *
 * `from` is the "present system" the radius is measured from. Radius counts
 * hyperspace jumps, so radius 1 is the present system plus its immediate
 * neighbours. ModVal 0 is not a documented value; it reveals just the
 * present system, which is the honest reading of "0 jumps away".
 *
 * The govt-class form is resolved through `classesOf`, which answers a
 * gövt id's Class1-4 list (GovtData.classes).
 */
export function mapOutfitSystems(modVal: number, from: string,
    systems: readonly MapOutfitSystem[], adjacency: SystemAdjacency,
    classesOf: (govtId: string) => readonly number[] = () => []): string[] {
    if (modVal <= -1000) {
        const wanted = -1000 - modVal;
        return systems
            .filter(s => s.govt != null && classesOf(s.govt).includes(wanted))
            .map(s => s.id);
    }
    if (modVal < 0) {
        // -1 (and any other negative above -1000): every inhabited system
        // that belongs to no government.
        return systems
            .filter(s => s.inhabited && s.govt == null)
            .map(s => s.id);
    }
    // Breadth-first out to `modVal` jumps, present system included.
    const seen = new Set<string>([from]);
    let frontier: string[] = [from];
    for (let hop = 0; hop < modVal && frontier.length > 0; hop++) {
        const next: string[] = [];
        for (const id of frontier) {
            for (const neighbour of adjacency.get(id) ?? []) {
                if (!seen.has(neighbour)) {
                    seen.add(neighbour);
                    next.push(neighbour);
                }
            }
        }
        frontier = next;
    }
    return [...seen];
}
