import * as t from 'io-ts';
import { Emit, Entities } from 'nova_ecs/arg_types';
import { EcsEvent } from 'nova_ecs/events';
import { Optional } from 'nova_ecs/optional';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import {
    GovtComponent, SimulationGameDataResource, SystemIdResource,
} from '../core/index.js';
import { CreditsComponent, MissionsComponent } from '../player/index.js';
import { LegalRecordsComponent, localLawIn } from '../reputation/index.js';
import {
    applyContrabandScan, CONTRABAND_SCAN_RANGE, hasContraband,
} from './contraband.js';
import {
    ContrabandScannedComponent, contrabandAboard, holdingScan, needsScan,
    scannable, scannedMarker,
} from './contraband_target.js';
import { NpcComponent } from './npc_component.js';
import { NpcFireControlSystem } from './npc_fire_control.js';
import { NpcPlunderBoardSystem } from './npc_plunder_board.js';
import { NpcSteeringSystem } from './npc_steering.js';

/**
 * ============================================================================
 * The AI 4 contraband scan: who is buzzed, the scan itself, the marker
 * ============================================================================
 *
 * The rules (what is illegal, what a scan costs) are contraband.ts; the
 * scanned-this-visit marker and the choice of whom to scan are
 * contraband_target.ts. This is the simulation half:
 *
 *  - NpcDecisionSystem (case 4) picks a player ship to scan with
 *    chooseScanTarget and puts the interceptor in mode 'scan';
 *  - NpcSteeringSystem flies it there (steerArrive at top speed);
 *  - ContrabandScanSystem performs the scan once it is within
 *    CONTRABAND_SCAN_RANGE, applies the consequences to the scanned
 *    pilot's synced state, marks the ship scanned, and tells that pilot
 *    (ContrabandScanEvent, targeted at the scanned ship: the status line
 *    shows on its owner's client only).
 *
 * MULTIPLAYER. A scan is per player ship: each pilot's outfits, cargo,
 * missions, credits and records are its own, and the marker lives on the
 * scanned ship, so one pilot's scan never touches another's.
 *
 * Measured (reference S1 / S2, waves 11-12): the scan comes within about
 * 3 s of an arrival, by jump or not, from a cutter that comes up beside
 * the player; one fine only. A CLEAN ship is approached too, and the
 * cutter sits on it, saying nothing ("A14 / contraband wave 16",
 * `w16_clean_several`; wave 11 had read "a clean ship is never
 * approached"): see needsScan and CONTRABAND_SCAN_HOLD_MS.
 */


/**
 * Emitted, targeted at the SCANNED ship, when a scan found something. The
 * display turns it into the status line (status_message_plugin), shown
 * only on that ship's owner's client. Carries what the line needs; the
 * simulation never reads it back.
 */
export interface ContrabandScanEventData {
    /** The scanning ship's uuid, for its name on the line. */
    scanner: string;
    /** The illegal outfit's lower-case name, when one was found. */
    outfit?: string;
    /** The illegal jünk's lower-case name (its LCName), when one was
     * found. */
    junk?: string;
    /** Illegal cargo of a plain mission was found. */
    smuggled: boolean;
    /** A mission with Flags 0x0020 failed. */
    missionFailed: boolean;
    /** The fine the line names: the govt's whole ScanFine (0: none, or a
     * warning), even when the pilot had less cash and lost only that
     * (contraband.ts's statedFine). */
    fine: number;
}
export const ContrabandScanEventType = t.intersection([t.type({
    scanner: t.string,
    smuggled: t.boolean,
    missionFailed: t.boolean,
    fine: t.number,
}), t.partial({
    outfit: t.string,
    junk: t.string,
})]);
export const ContrabandScanEvent =
    new EcsEvent<ContrabandScanEventData>('ContrabandScanEvent');
registerSimulationBridgeEvent({ event: ContrabandScanEvent });


/**
 * THE SCAN. An interceptor in mode 'scan' that has come within
 * CONTRABAND_SCAN_RANGE of its target scans it: the findings are taken
 * NOW (cargo jettisoned on the way no longer counts), applied to the
 * pilot (contraband.ts's applyContrabandScan), the ship is marked
 * scanned, and the pilot is told. A DETECTION (contraband.ts's
 * isDetection: the fine line) also names the scanning govt on the marker
 * (contraband_target.ts's `hostile`), and from the next think every
 * hunter of that govt in the system attacks the pilot until he lands or
 * leaves, whatever its CrimeTol (reference "Contraband wave 14": a
 * CrimeTol-30000 customs govt's cutters fired on a pod pilot for the rest
 * of the visit).
 *
 * The marker remembers what the scan found, so a ship already scanned
 * this visit is scanned again only for contraband that scan did not find
 * (contraband_target.ts's needsScan; reference wave 15, `w15_several`: a
 * pod pilot rescanned at takeoff after buying illegal jünk). A rescan
 * applies everything aboard as one scan: one line, one fine.
 *
 * A scan that finds nothing (a clean ship, or the hold was emptied en
 * route) still marks the ship, and says nothing: MEASURED, "A14 /
 * contraband wave 16" (no status line at all while a cutter sat on a clean
 * pilot; the stock "Have a nice day." line, STR# 2002 #389, was not shown).
 *
 * After the scan the interceptor STAYS on the ship (mode 'scan', steered
 * onto it) until CONTRABAND_SCAN_HOLD_MS after the scan (holdingScan), then
 * goes back to its business: the reference cutter sat on the clean pilot
 * for 30+ s; what ends it is a GUESS. A detection's hostility takes over at
 * the interceptor's next think (the decision step attacks before it
 * scans).
 *
 * Why a once-per-tick sweep in UUID order rather than an arm of the
 * steering system: two interceptors can reach the same ship on the same
 * tick, and the first to scan marks it, so the other must find the mark.
 * Entity-map order differs between a peer that built its map by
 * insertion and one restored from a wire snapshot; sorted order does not
 * (NpcPlunderBoardSystem's reasoning). No PRNG.
 */
export const ContrabandScanSystem = new System({
    name: 'ContrabandScanSystem',
    args: [SingletonComponent, Entities, Emit, TimeResource,
        SimulationGameDataResource, Optional(SystemIdResource)] as const,
    step(_singleton, entities, emit, time, gameData, systemId) {
        const scanning: string[] = [];
        for (const [uuid, entity] of entities) {
            if (entity.components.get(NpcComponent)?.mode === 'scan') {
                scanning.push(uuid);
            }
        }
        if (scanning.length === 0) {
            return;
        }
        const law = localLawIn(gameData, systemId);
        for (const uuid of scanning.sort()) {
            const scanner = entities.get(uuid)!;
            const npc = scanner.components.get(NpcComponent)!;
            const giveUp = () => {
                npc.mode = undefined;
                delete npc.scanTarget;
            };
            const target = npc.scanTarget
                ? entities.get(npc.scanTarget) : undefined;
            const govtId = scanner.components.get(GovtComponent)?.id;
            const govt = govtId
                ? gameData.data.Govt.getCached(govtId) : undefined;
            if (!scannable(target) || !govt) {
                // Gone, disabled or cloaked.
                giveUp();
                continue;
            }
            const from = scanner.components.get(MovementStateComponent);
            const to = target.components.get(MovementStateComponent)!;
            if (!from || from.position.subtract(to.position).lengthSquared
                > CONTRABAND_SCAN_RANGE * CONTRABAND_SCAN_RANGE) {
                continue; // Still on the way; NpcSteeringSystem flies it.
            }
            const findings = contrabandAboard(target, govt.scanMask, gameData);
            if (target.components.has(ContrabandScannedComponent)
                && !needsScan(target, findings)) {
                // Scanned this visit with nothing new aboard: this
                // interceptor sitting on the ship it scanned, or one beaten
                // to it by another interceptor (it sits too), or the new
                // contraband went overboard en route. It stays
                // until the hold runs out.
                if (!holdingScan(target, time.time)) {
                    giveUp();
                }
                continue;
            }
            target.components.set(ContrabandScannedComponent,
                scannedMarker(time.time, govt.id, findings));
            if (hasContraband(findings)) {
                const result = applyContrabandScan(findings, govt, law, {
                    credits: target.components.get(CreditsComponent),
                    records: target.components.get(LegalRecordsComponent),
                    missions: target.components.get(MissionsComponent),
                });
                const { taken: _taken, ...line } = result;
                emit(ContrabandScanEvent, { scanner: uuid, ...line },
                    [npc.scanTarget!]);
            }
            // No giveUp: it sits on the ship while holdingScan.
        }
    },
    // Pinned into the NPC chain right after the plunder claim, the other
    // once-per-tick uuid-order sweep (#237: both read and write across
    // every entity), and before fire control, so a ship that has just
    // been scanned and turned criminal is fired on from the next think.
    after: [TimeSystem, NpcSteeringSystem, NpcPlunderBoardSystem],
    before: [NpcFireControlSystem],
});
