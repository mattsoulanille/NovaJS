import { MissionData } from 'novadatainterface/mission_data';
import { ActiveMission } from './player_state_plugin.js';

/**
 * The starmap marks an active mission earns (destination arrows and the
 * ShipSyst arrow), per the mïsn map flags. Split out of mission_logic.ts.
 */

/**
 * A system to mark on the starmap for an active mission.
 *  - 'destination': a travel or return stellar's system (the original's
 *    red destination arrows), suppressed by the mïsn hideDestArrows flag.
 *  - 'shipSyst': the special-ship spawn system, marked only when the
 *    mïsn showArrowForShipSyst flag is set (the additional arrow).
 */
export interface MissionMapMark {
    systemId: string;
    kind: 'destination' | 'shipSyst';
    missionId: string;
}

/**
 * The systems to mark on the starmap for the player's active missions,
 * per the mïsn map flags. Pure: `systemOfStellar` maps a planet id to
 * its system id (undefined = unplaced), `getMission` fetches the static
 * mission data (undefined = not loaded). Destination marks come from the
 * travel/return stellars unless hideDestArrows is set; a ship-goal
 * system is marked only under showArrowForShipSyst. Deduplicated per
 * (system, kind, mission).
 */
export function missionMapMarks(missions: Iterable<ActiveMission>,
    getMission: (id: string) => MissionData | undefined,
    systemOfStellar: (planetId: string) => string | undefined):
    MissionMapMark[] {
    const marks: MissionMapMark[] = [];
    const seen = new Set<string>();
    const add = (systemId: string | undefined,
        kind: MissionMapMark['kind'], missionId: string) => {
        if (!systemId) {
            return;
        }
        const key = `${systemId}|${kind}|${missionId}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        marks.push({ systemId, kind, missionId });
    };
    for (const active of missions) {
        const mission = getMission(active.id);
        if (!mission) {
            continue;
        }
        if (!mission.flags.hideDestArrows) {
            if (active.travelPlanet) {
                add(systemOfStellar(active.travelPlanet),
                    'destination', active.id);
            }
            if (active.returnPlanet) {
                add(systemOfStellar(active.returnPlanet),
                    'destination', active.id);
            }
        }
        if (mission.flags.showArrowForShipSyst
            && active.shipObjective?.systemId) {
            add(active.shipObjective.systemId, 'shipSyst', active.id);
        }
    }
    return marks;
}
