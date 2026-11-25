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
    CONTRABAND_SCAN_SEEK_RANGE, CONTRABAND_SIT_LEASH, ContrabandFindings,
    findContraband,
    isDetection, newContraband,
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
 * Whether an interceptor that is on `ship` for a scan STAYS there: the
 * ship has been scanned on this visit (it carries the marker), so the
 * interceptor keeps station on it for the rest of the visit, until the
 * ship lands or jumps out (it leaves the world: the scan sweep and the
 * steering arm then drop it) or the interceptor has something better to
 * do (the decision system: an enemy or an aggressor first, then a ship
 * still due a scan; chooseScanTarget).
 *
 * MEASURED, reference "Contraband / W1 / C1, wave 18" (pilot
 * `w17_scan_clean`, a clean Kit Lancer among four Kit Customs Big
 * cutters): the cutters sat 23-51 px from the pilot, not moving at all,
 * from 20 s to the end of an 8.5 min watch. Wave 16 had seen one cutter
 * sit 30+ s and NovaJS let it go after 30 s; that guess is gone.
 *
 * MEASURED, reference "Contraband / rescue / A14, wave 19" (the same
 * pilot and cutters): a cutter does NOT follow a clean ship that flies
 * off. The pilot flew 2,700 px north; the cutters stayed with the port,
 * one blip on the radar, and none came after him in the next 50 s. So the
 * sit holds the SPOT, not the ship: once an interceptor has come up to the
 * ship (NpcState.scanSatOn) it moves after it no faster than
 * CONTRABAND_SIT_SPEED, and lets go when the ship is CONTRABAND_SIT_LEASH
 * away (chooseScanTarget; the steering arm brakes it there meanwhile). The
 * wave-18 GUESS that the cutter follows is gone.
 *
 * GUESS: a landing ends the sit and the cutters do not come back to the
 * pilot when he takes off (the marker survives the landing, so he is not
 * due a scan; unmeasured).
 */
export function holdingScan(ship: Entity): boolean {
    return ship.components.has(ContrabandScannedComponent);
}

/**
 * The player ship an interceptor of a scanning govt goes to scan, among
 * `candidates` ([uuid, distance²] of the player ships it may consider:
 * the decision system has already dropped its own side, a briber, the
 * disabled, the cloaked and every ship it is about to attack).
 *
 *  1. A ship DUE a scan by `govtMask` within CONTRABAND_SCAN_SEEK_RANGE
 *     (needsScan: not scanned this visit, clean or not, or carrying new
 *     contraband since): the one it is already flying to while it still
 *     qualifies (sticky, like the plunder run), else the nearest (uuid
 *     tie-break, chooseNearest). A ship due a scan comes before sitting
 *     on one already scanned, so a second pilot arriving in the system is
 *     still buzzed by the cutters sitting on the first.
 *  2. Else, when `mayHold`, the ship it is SITTING on (holdingScan: the
 *     current target, scanned this visit, still scannable and still a
 *     candidate): it keeps station on that ship for the visit — while it
 *     is still closing on it, at any distance (a second cutter on its way
 *     to a ship the first has scanned), and once it has come up to it
 *     (`satOn` names it: NpcState.scanSatOn) only while the ship stays
 *     within CONTRABAND_SIT_LEASH. A ship that flies off is let go, and
 *     the interceptor stays where it sat (reference wave 19, holdingScan).
 *
 * Reads synced state and staged caches only; no PRNG.
 */
export function chooseScanTarget(current: string | undefined,
    candidates: ReadonlyArray<readonly [string, number]>, govtMask: number,
    getEntity: (uuid: string) => Entity | undefined,
    gameData: SimulationGameDataInterface, mayHold = true,
    satOn?: string):
    string | undefined {
    const qualifying = candidates.filter(([uuid, d2]) => {
        const ship = getEntity(uuid);
        return d2 <= CONTRABAND_SCAN_SEEK_RANGE * CONTRABAND_SCAN_SEEK_RANGE
            && scannable(ship)
            && needsScan(ship, contrabandAboard(ship, govtMask, gameData));
    });
    if (current !== undefined && qualifying.some(([u]) => u === current)) {
        return current;
    }
    if (qualifying.length > 0) {
        return chooseNearest(qualifying);
    }
    const sittingOn = current !== undefined ? getEntity(current) : undefined;
    const entry = candidates.find(([u]) => u === current);
    if (mayHold && entry && scannable(sittingOn) && holdingScan(sittingOn)
        && !flownOff(current, satOn, entry[1])) {
        return current;
    }
    return undefined;
}

/**
 * Whether the scanned ship `current`, `distanceSquared` from an
 * interceptor that has come up to `satOn`, has FLOWN OFF: the interceptor
 * had settled on it and it is now past CONTRABAND_SIT_LEASH (see
 * chooseScanTarget). An interceptor still closing on the ship never
 * counts it flown off.
 */
export function flownOff(current: string | undefined,
    satOn: string | undefined, distanceSquared: number): boolean {
    return current !== undefined && satOn === current
        && distanceSquared > CONTRABAND_SIT_LEASH * CONTRABAND_SIT_LEASH;
}
