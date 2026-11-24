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
 * this visit and is not scanned again. GUESS, after the measured "ONE
 * fine only" (two cutters, 2.7 min): once per system VISIT, by anyone.
 * The visit ends at a landing (encounters/boarding_plugin's
 * BoardingLandingResetSystem, the landing's life-segment reset) or when
 * the ship leaves for another system (pilot/transition_prep.ts clears it
 * on every crossing into a fresh world), so a pilot is scanned again
 * after either.
 */
export const ContrabandScannedType = t.type({
    /** Sim time (ms) of the scan. */
    at: t.number,
});
export type ContrabandScannedState = t.TypeOf<typeof ContrabandScannedType>;
export const ContrabandScannedComponent =
    new Component<ContrabandScannedState>('ContrabandScanned');

/** Drops a ship's scanned-this-visit marker (a visit boundary). */
export function clearContrabandScan(entity: Entity): void {
    entity.components.delete(ContrabandScannedComponent);
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
