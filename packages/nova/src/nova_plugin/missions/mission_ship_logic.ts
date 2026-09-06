import { MissionData } from 'novadatainterface/mission_data';
import {
    matchesStellarRef,
    MissionContext,
    setStringPrefix,
    StellarInfo,
} from './mission_logic.js';
import { goalSupported, ShipObjective } from '../player/index.js';

/**
 * Player-local resolution of a mission's special-ship and aux-ship
 * system references — the accept-time counterpart of
 * mission_ship_state.ts (which holds the frozen result and the goal
 * state machine) and mission_ship_spawn.ts (which spawns from it).
 *
 * Like the travel/return stellar resolution in mission_logic.ts, the
 * random choices here (a random ShipSyst, an adjacent system) are
 * frozen at offer time; a reference that cannot be satisfied makes
 * the mission unofferable.
 */

/** What ship-system resolution needs to know about a sÿst. */
export interface SystemInfo {
    id: string;
    /** Global gövt id or null for independent. */
    govt: string | null;
    /** Global ids of hyperlinked neighbor systems. */
    links: string[];
}

/** Whether a mission defines special ships at all. */
export function hasSpecialShips(mission: MissionData): boolean {
    return mission.shipCount > 0 && mission.shipDudeId !== null;
}

/**
 * The offer gate: whether the engine supports this mission's
 * special-ship goal. All seven are supported and evaluated by
 * mission_ship_plugin.ts today (board and rescue included, since
 * boarding is real now); the predicate remains as the one place a
 * future unsupported goal would be listed. See goalSupported.
 */
export function shipGoalOfferable(mission: MissionData): boolean {
    if (!hasSpecialShips(mission)) {
        return true;
    }
    return goalSupported(mission.shipGoal);
}

/** Wraps a system as a StellarInfo so the gövt-relative reference
 * ranges (10000+/15000+/...) resolve through matchesStellarRef. */
function asStellar(system: SystemInfo): StellarInfo {
    return {
        id: system.id,
        govt: system.govt,
        uninhabited: false,
        canLand: true,
    };
}

function pick<T>(items: T[], random: () => number): T | undefined {
    if (items.length === 0) {
        return undefined;
    }
    return items[Math.floor(random() * items.length)];
}

/**
 * Resolves a ShipSyst reference to a concrete system id, frozen at
 * offer time. Returns:
 *  - a system id for the concrete cases,
 *  - null for ShipSyst -6 ("whatever system the player is in"),
 *  - undefined when the reference cannot be satisfied (which makes
 *    the mission unofferable).
 */
export function resolveShipSystem(mission: MissionData, ctx: MissionContext,
    travelPlanet: string | null, returnPlanet: string | null):
    string | null | undefined {
    const { systems, systemIdOfStellar } = ctx;
    if (!systems || !systemIdOfStellar) {
        return undefined;
    }
    const ref = mission.shipSyst;
    switch (ref) {
        case -6:
            return null;
        case -1:
            return systemIdOfStellar(ctx.stellar.id);
        case -2:
            return pick(systems, ctx.random)?.id;
        // -3 "TravelStel's system", -4 "ReturnStel's system". RULING for
        // a mission that names the stellar it does not have: use the
        // destination it DOES have. Stock nova:428 "Federation Resupply;
        // Fed1" (the outfitter entry to the whole Federation string) and
        // nova:742 "Rescue Vell-os Slaves" are ShipSyst -3 with TravelStel
        // -1 and a ReturnStel — their two pirates / the slavers are meant
        // for the one leg the player flies. Read strictly, the reference
        // is unsatisfiable and the mission can never be offered at all.
        // With neither destination it still is.
        case -3: {
            const stellar = travelPlanet ?? returnPlanet;
            return stellar ? systemIdOfStellar(stellar) : undefined;
        }
        case -4: {
            const stellar = returnPlanet ?? travelPlanet;
            return stellar ? systemIdOfStellar(stellar) : undefined;
        }
        case -5: {
            const initial = systemIdOfStellar(ctx.stellar.id);
            const links = systems.find(s => s.id === initial)?.links ?? [];
            return pick(links, ctx.random);
        }
    }
    if (mission.shipSystId !== null) {
        return mission.shipSystId;
    }
    // The gövt-relative ranges: freeze one matching system.
    const matches = systems.filter(system => matchesStellarRef(ref, null,
        asStellar(system), setStringPrefix(mission), ctx.getGovt));
    return pick(matches, ctx.random)?.id;
}

/**
 * Builds the frozen ShipObjective for an offer, or undefined when the
 * mission has no special ships, or null when the spawn system cannot
 * be resolved / the goal is unsupported (mission unofferable — this
 * also covers Sxxx-started missions, which bypass the location gate).
 */
export function resolveShipObjective(mission: MissionData,
    ctx: MissionContext, travelPlanet: string | null,
    returnPlanet: string | null): ShipObjective | null | undefined {
    if (!hasSpecialShips(mission)) {
        return undefined;
    }
    if (!goalSupported(mission.shipGoal)) {
        return null;
    }
    const systemId = resolveShipSystem(mission, ctx,
        travelPlanet, returnPlanet);
    if (systemId === undefined) {
        return null;
    }
    return {
        goal: mission.shipGoal,
        systemId,
        shipStart: mission.shipStart,
        behavior: mission.shipBehav,
        dudeId: mission.shipDudeId!,
        total: mission.shipCount,
        satisfied: 0,
        complete: false,
        failed: false,
        shipDonePending: false,
        live: new Map(),
    };
}

/**
 * Whether a mission's aux ships spawn in `system` for the given
 * active-mission destinations. Aux ships are membership-matched at
 * spawn time (nothing random to freeze): -1 any system the player is
 * in; -2 TravelStel's system; -3 ReturnStel's system; a plain id;
 * 5000-7047 that system or any adjacent; the gövt ranges.
 */
export function auxShipsMatchSystem(mission: MissionData,
    destinations: { travelPlanet: string | null, returnPlanet: string | null },
    system: SystemInfo,
    systemIdOfStellar: (planetId: string) => string | undefined,
    getGovt: MissionContext['getGovt']): boolean {
    if (mission.auxShipCount <= 0 || mission.auxShipDudeId === null) {
        return false;
    }
    const ref = mission.auxShipSyst;
    switch (ref) {
        case -1:
            return true;
        case -2:
            return destinations.travelPlanet !== null
                && systemIdOfStellar(destinations.travelPlanet) === system.id;
        case -3:
            return destinations.returnPlanet !== null
                && systemIdOfStellar(destinations.returnPlanet) === system.id;
    }
    if (mission.auxShipSystId !== null) {
        return mission.auxShipSystId === system.id;
    }
    if (ref >= 5000 && ref <= 7047) {
        // That system or any adjacent to it. The bare sÿst number
        // resolves stock-first like every numeric reference
        // (mission_logic's resolveNumberedResource); with no exists
        // lookup threaded here, BOTH candidate ids are tested instead —
        // at most one of nova:n / writer:n can exist (an override keeps
        // the stock id), so membership against real system ids is
        // equivalent.
        const n = ref - 5000 + 128;
        const candidates =
            new Set([`nova:${n}`, `${setStringPrefix(mission)}:${n}`]);
        return candidates.has(system.id)
            || system.links.some(link => candidates.has(link));
    }
    return matchesStellarRef(ref, null, asStellar(system),
        setStringPrefix(mission), getGovt);
}
