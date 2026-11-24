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
    CONTRABAND_SCAN_HOLD_MS, CONTRABAND_SCAN_SEEK_RANGE, ContrabandFindings,
    findContraband, isDetection, newContraband,
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
 * this visit, and what that scan found (`found`). It is not scanned
 * again on this visit unless it carries contraband the marker does not
 * name.
 *
 * THE RULE, from two measurements (docs/reference_experiments.md):
 * a ship is scanned again on the same visit only when it carries
 * contraband that its last scan did not find; a new visit (an arrival by
 * jump) starts afresh.
 *  - "Contraband wave 14": the visit is a stay in the system between two
 *    ARRIVALS BY JUMP, not between landings. A pod pilot was fined once in
 *    a 5.5 min visit, not again in 70 s after a landing and takeoff, and
 *    a pilot scanned before landing (who then accepted a ScanMask-0
 *    mission: nothing new that was illegal) was not rescanned on takeoff;
 *    a jump out to the linked system and straight back was fined again
 *    within about 10 s of the arrival.
 *  - "A14 / contraband wave 15", `w15_several`: a pod pilot fined at
 *    Enter Ship landed, bought illegal jünk and took a Flags 0x0020
 *    mission whose cargo was illegal, and WAS scanned again at takeoff
 *    (one line, naming the jünk; one more fine).
 * So the marker survives a landing (the ship leaves the world and comes
 * back with it) and goes only when the ship crosses into a fresh world
 * (pilot/transition_prep.ts clears it on every crossing: a jump, a
 * hypergate or wormhole transit, a mission's system move); and while it
 * stands, needsScan asks whether anything illegal aboard is missing from
 * `found`. GUESSES: contraband gained in space (plunder) counts as new
 * too, not only what a landing brings; and a second scanning govt with a
 * different ScanMask scans for what the first did not find.
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
    /** What the scan found (contraband.ts's ContrabandFindings.items:
     * sorted "outfit:<id>" / "junk:<id>" / "mission:<id>" keys); absent
     * when it found nothing. */
    found: t.array(t.string),
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
 * scanned marker stays, with what it found, so the pilot is not scanned
 * again until he arrives by jump or takes off with new contraband. Sets
 * a fresh object rather than editing the stored one (the component is
 * synced state).
 */
export function endContrabandHostility(entity: Entity): void {
    const scanned = entity.components.get(ContrabandScannedComponent);
    if (scanned?.hostile !== undefined) {
        entity.components.set(ContrabandScannedComponent, {
            at: scanned.at,
            ...(scanned.found ? { found: scanned.found } : {}),
        });
    }
}

/** The marker a scan with `findings` leaves, at sim time `at`, by
 * `govtId`: a DETECTION names the govt as `hostile`, and whatever was
 * found is remembered as `found`. */
export function scannedMarker(at: number, govtId: string,
    findings: ContrabandFindings): ContrabandScannedState {
    return {
        at,
        ...(isDetection(findings) ? { hostile: govtId } : {}),
        ...(findings.items.length > 0 ? { found: [...findings.items] } : {}),
    };
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
 * disabled, not exploding) and visible. Whether it NEEDS a scan is
 * needsScan's question.
 */
export function scannable(ship: Entity | undefined): ship is Entity {
    return ship !== undefined
        && ship.components.has(MovementStateComponent)
        && !ship.components.has(DisabledComponent)
        && !ship.components.has(ExplodingComponent)
        && isTargetable(ship.components.get(CloakActiveComponent));
}

/**
 * Whether `ship`, on which a scan would find `findings`, is due one: it
 * has not been scanned this visit, CLEAN OR NOT, or it carries contraband
 * its last scan did not find (the marker's `found`; see
 * ContrabandScannedType for the measurements).
 *
 * A clean ship is scanned too, once a visit: reference "A14 / contraband
 * wave 16", `w16_clean_several`, a cutter came up to a pilot carrying
 * nothing illegal and sat on it, and nothing was said (one cutter, one
 * run; the scan of a clean ship says nothing, ContrabandScanSystem). This
 * replaces wave 11's "a clean ship is never approached".
 */
export function needsScan(ship: Entity, findings: ContrabandFindings):
    boolean {
    const scanned = ship.components.get(ContrabandScannedComponent);
    return !scanned || newContraband(findings, scanned.found).length > 0;
}

/**
 * Whether an interceptor that is on `ship` for a scan stays there at sim
 * time `now`: the ship was scanned less than CONTRABAND_SCAN_HOLD_MS ago
 * (its marker's `at`). The reference cutter sat on the clean pilot it had
 * scanned (contraband.ts's CONTRABAND_SCAN_HOLD_MS; the end is a GUESS).
 */
export function holdingScan(ship: Entity, now: number): boolean {
    const scanned = ship.components.get(ContrabandScannedComponent);
    return scanned !== undefined
        && now - scanned.at < CONTRABAND_SCAN_HOLD_MS;
}

/**
 * The player ship an interceptor of a scanning govt goes to scan, among
 * `candidates` ([uuid, distance²] of the player ships it may consider:
 * the decision system has already dropped its own side, a briber, the
 * disabled, the cloaked and every ship it is about to attack). One is
 * taken when it is within CONTRABAND_SCAN_SEEK_RANGE and is due a scan
 * by `govtMask` (needsScan: not scanned this visit, clean or not, or
 * carrying new contraband since). STICKY, like the plunder run: the ship
 * it is already flying to is kept while it still qualifies, or while the
 * interceptor is SITTING on it after the scan (holdingScan, at sim time
 * `now`); otherwise the nearest (uuid tie-break, chooseNearest). Reads
 * synced state and staged caches only; no PRNG.
 */
export function chooseScanTarget(current: string | undefined,
    candidates: ReadonlyArray<readonly [string, number]>, govtMask: number,
    getEntity: (uuid: string) => Entity | undefined,
    gameData: SimulationGameDataInterface, now: number): string | undefined {
    const inReach = candidates.filter(([uuid, d2]) =>
        d2 <= CONTRABAND_SCAN_SEEK_RANGE * CONTRABAND_SCAN_SEEK_RANGE
        && scannable(getEntity(uuid)));
    const qualifying = inReach.filter(([uuid]) => {
        const ship = getEntity(uuid)!;
        return needsScan(ship, contrabandAboard(ship, govtMask, gameData));
    });
    if (current !== undefined && (qualifying.some(([u]) => u === current)
        || (inReach.some(([u]) => u === current)
            && holdingScan(getEntity(current)!, now)))) {
        return current;
    }
    return chooseNearest(qualifying);
}
