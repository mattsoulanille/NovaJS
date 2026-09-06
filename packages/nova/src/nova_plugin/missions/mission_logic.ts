/**
 * Pure mission mechanics: availability evaluation, offer resolution
 * (random destinations and cargo quantities are frozen at offer time,
 * as in EV Nova), acceptance, and landing processing (travel legs,
 * completion, deadlines, aborts).
 *
 * Everything here is player-local: it runs while the player's entity
 * is out of the simulation (docked, or in the hands of the jump
 * handoff), so the `random` source may be plain randomness — only the
 * resulting component state reaches the simulation. See
 * mission_board.ts and browser.ts for the wiring.
 *
 * This file is the public façade; the code lives in one module per
 * concern (all under this directory):
 *  - mission_ids.ts          numeric-reference scoping (setStringPrefix,
 *                            resolveNumberedResource and kin)
 *  - mission_stellar.ts      StellarInfo, sÿst Visibility, AvailStel /
 *                            TravelStel / ReturnStel matching, stellarRecord
 *  - mission_context.ts      MissionContext
 *  - mission_availability.ts the offer gates (missionMatchesLocation)
 *  - mission_offer.ts        MissionOffer, makeMissionOffer, checkAcceptable
 *  - mission_cargo.ts        cargo names, mission cargo key, load/unload
 *  - mission_map_marks.ts    starmap marks for active missions
 *  - mission_machinery.ts    MissionEvent, MissionWorkingState,
 *                            MissionMachineryContext
 *  - mission_payval.ts       PayVal spending and CompReward reputation
 *  - mission_auto_abort.ts   mïsn Flags 0x0001 auto-abort
 *  - mission_set_strings.ts  set-string hooks (Sxxx/Axxx/Fxxx, Gxxx, ...)
 *  - mission_accept_offer.ts acceptOffer, refuseOffer, startMissionById
 *  - mission_transitions.ts  abortMission, failMission, completeMission
 *  - mission_landing.ts      date-advance sweeps and processLanding
 */

export {
    idPrefix,
    numericId,
    ownsOutfit,
    resolveExistingNumberedResource,
    resolveNumberedResource,
    sameNumberedResource,
    setStringPrefix,
    systemDiscoveryOperators,
} from './mission_ids.js';
export {
    matchesStellarRef,
    stellarAdjacencyOf,
    stellarInfoOf,
    stellarRecord,
    stellarVisible,
} from './mission_stellar.js';
export type { StellarAdjacency, StellarInfo } from './mission_stellar.js';
export type { MissionContext } from './mission_context.js';
export {
    LOCATION_BAR,
    LOCATION_MAIN_SPACEPORT,
    LOCATION_MISSION_COMPUTER,
    LOCATION_OUTFIT,
    LOCATION_SHIP,
    LOCATION_SHIPYARD,
    LOCATION_TRADING,
    missionMatchesLocation,
} from './mission_availability.js';
export { checkAcceptable, makeMissionOffer } from './mission_offer.js';
export type { MissionOffer } from './mission_offer.js';
export {
    cargoName, missionCargoKey, STANDARD_CARGO_NAMES,
} from './mission_cargo.js';
export { missionMapMarks } from './mission_map_marks.js';
export type { MissionMapMark } from './mission_map_marks.js';
export type {
    MissionEvent, MissionMachineryContext, MissionWorkingState,
} from './mission_machinery.js';
export {
    AUTO_ABORT_FUEL_COST, deferredAutoAbort,
} from './mission_auto_abort.js';
export {
    makeMissionSetHooks, runMissionSetString,
} from './mission_set_strings.js';
export {
    acceptOffer, refuseOffer, startMissionById,
} from './mission_accept_offer.js';
export type { AcceptResult } from './mission_accept_offer.js';
export { abortMission, failMission } from './mission_transitions.js';
export {
    failExpiredMissions,
    processLanding,
    runPendingAutoAborts,
    runPendingShipDone,
} from './mission_landing.js';
