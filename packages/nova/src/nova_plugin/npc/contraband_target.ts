import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { MissionsComponent } from '../player/index.js';
import {
    CargoComponent, CloakActiveComponent, DisabledComponent,
    ExplodingComponent, isTargetable, OutfitsStateComponent,
} from '../ship/index.js';
import {
    CONTRABAND_SCAN_SEEK_RANGE, ContrabandFindings, findContraband,
    hasContraband,
} from './contraband.js';
import { chooseNearest } from './npc_targeting.js';

/**
 * The contraband scan's TARGETING half (see contraband_scan.ts for the
 * scan itself): the scanned-this-visit marker, what a scanner finds
 * aboard a ship, and which ship an interceptor goes to scan. Kept apart
 * from the systems so the decision system can read it without an import
 * cycle through the steering system.
 */
/**
 * The marker a scan leaves on the scanned ship: it has been scanned on
 * this visit and is not scanned again.
 *
 * MEASURED (docs/reference_experiments.md, "Contraband wave 14"): the
 * visit is a stay in the system between two ARRIVALS BY JUMP, not
 * between landings. A pod pilot was fined once in a 5.5 min visit, not
 * again in 70 s after a landing and takeoff, and a pilot scanned before
 * landing was not rescanned on takeoff; a jump out to the linked system
 * and straight back was fined again within about 10 s of the arrival. So
 * the marker survives a landing (the ship leaves the world and comes back
 * with it) and goes only when the ship crosses into a fresh world
 * (pilot/transition_prep.ts clears it on every crossing: a jump, a
 * hypergate or wormhole transit, a mission's system move).
 *
 * `hostile` is the second half of the same measurement: after a
 * DETECTION (a fine line: an outfit, jünk or a mission's cargo), the
 * scanning government's ships attacked the player for the rest of that
 * stay in space, whatever their CrimeTol (30000 in the run, with the
 * record at -50), and after a landing they were peaceful again. So it
 * names the scanning govt until the ship lands
 * (encounters/boarding_plugin's BoardingLandingResetSystem calls
 * endContrabandHostility) or leaves; the reputation layer reads it
 * through govt_disposition's `otherDetectedBy`. GUESS: a scan that only
 * failed a Flags 0x0020 mission ("Your ship has been scanned - mission
 * failed.") is not a detection and leaves no hostility (wave 12 did not
 * say whether the cutters turned).
 */
export const ContrabandScannedType = t.intersection([t.type({
    /** Sim time (ms) of the scan. */
    at: t.number,
}), t.partial({
    /** The government whose scan DETECTED contraband aboard, while its
     * ships still attack this pilot (until a landing). */
    hostile: t.string,
})]);
export type ContrabandScannedState = t.TypeOf<typeof ContrabandScannedType>;
export const ContrabandScannedComponent =
    new Component<ContrabandScannedState>('ContrabandScanned');

/** Drops a ship's scanned-this-visit marker (a crossing into a fresh
 * world: a new visit). */
export function clearContrabandScan(entity: Entity): void {
    entity.components.delete(ContrabandScannedComponent);
}

/**
 * A LANDING: the detection's hostility ends (the scanning govt's ships
 * were peaceful after the reference pilot took off again), but the
 * scanned marker stays, so the pilot is not scanned again until he
 * arrives by jump. Sets a fresh object rather than editing the stored
 * one (the component is synced state).
 */
export function endContrabandHostility(entity: Entity): void {
    const scanned = entity.components.get(ContrabandScannedComponent);
    if (scanned?.hostile !== undefined) {
        entity.components.set(ContrabandScannedComponent, { at: scanned.at });
    }
}

/** The government whose contraband scan has turned its ships on `ship`
 * for the rest of this stay in space, if any. */
export function contrabandDetectedBy(ship: Entity | undefined):
    string | undefined {
    return ship?.components.get(ContrabandScannedComponent)?.hostile;
}

/** What `govtMask` finds aboard `ship`, through the staged caches. */
export function contrabandAboard(ship: Entity, govtMask: number,
    gameData: SimulationGameDataInterface): ContrabandFindings {
    return findContraband(govtMask, {
        outfits: ship.components.get(OutfitsStateComponent),
        cargo: ship.components.get(CargoComponent),
        missions: ship.components.get(MissionsComponent),
    },
        // Staged: a ship's own outfits stage with it (entity_data_loader),
        // in-flight grants through loadOutfitsGameData, and every jünk at
        // world genesis (make_system.ts). So the reads are warm on every
        // peer.
        id => gameData.data.Outfit.getCached(id),
        id => gameData.data.Junk.getCached(id));
}

/**
 * Whether `ship` may be scanned at all right now: present, flying (not
 * disabled, not exploding), visible, and not yet scanned this visit.
 */
export function scannable(ship: Entity | undefined): ship is Entity {
    return ship !== undefined
        && ship.components.has(MovementStateComponent)
        && !ship.components.has(DisabledComponent)
        && !ship.components.has(ExplodingComponent)
        && isTargetable(ship.components.get(CloakActiveComponent))
        && !ship.components.has(ContrabandScannedComponent);
}

/**
 * The player ship an interceptor of a scanning govt goes to scan, among
 * `candidates` ([uuid, distance²] of the player ships it may consider:
 * the decision system has already dropped its own side, a briber, the
 * disabled, the cloaked and every ship it is about to attack). One is
 * taken when it is within CONTRABAND_SCAN_SEEK_RANGE, unscanned this
 * visit, and carries something illegal to `govtMask`. STICKY, like the
 * plunder run: the ship it is already flying to is kept while it still
 * qualifies; otherwise the nearest (uuid tie-break, chooseNearest). Reads
 * synced state and staged caches only; no PRNG.
 */
export function chooseScanTarget(current: string | undefined,
    candidates: ReadonlyArray<readonly [string, number]>, govtMask: number,
    getEntity: (uuid: string) => Entity | undefined,
    gameData: SimulationGameDataInterface): string | undefined {
    const qualifying = candidates.filter(([uuid, d2]) => {
        if (d2 > CONTRABAND_SCAN_SEEK_RANGE * CONTRABAND_SCAN_SEEK_RANGE) {
            return false;
        }
        const ship = getEntity(uuid);
        return scannable(ship)
            && hasContraband(contrabandAboard(ship, govtMask, gameData));
    });
    if (current !== undefined && qualifying.some(([u]) => u === current)) {
        return current;
    }
    return chooseNearest(qualifying);
}
