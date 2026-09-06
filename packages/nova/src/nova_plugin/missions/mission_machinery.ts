import { GovtData } from 'novadatainterface/govt_data';
import { RankData } from 'novadatainterface/rank_data';
import { MissionData } from 'novadatainterface/mission_data';
import { Cargo } from '../ship/index.js';
import { DiscoveryAccess } from '../player/index.js';
import { MissionContext } from './mission_context.js';
import { MissionEventType } from '../player/index.js';
import { ShipChangeMode } from '../ncb/index.js';
import { ActiveRanks } from '../ncb/index.js';
import { Missions, PendingAutoAbortShip } from '../player/index.js';
import { LegalRecords } from '../reputation/index.js';

/**
 * The shapes mission processing operates on: the UI-facing MissionEvent,
 * the player-local MissionWorkingState (the spaceport commit pattern's
 * working copies) and the MissionMachineryContext that wires the working
 * state to the loaded universe. Split out of mission_logic.ts.
 */

/** An observable consequence of mission processing, for the UI. */
export interface MissionEvent {
    missionId: string;
    missionName: string;
    type: MissionEventType;
    /** The mission's dësc text for this event ('' if none). */
    text: string;
    /**
     * The global PICT id of the dësc Graphic paired with `text`, shown
     * beside it in the result popup (completion/fail/shipDone), or absent
     * when that dësc has no graphic. Already a resolved global id from the
     * misn parser (misn_parse.ts descGraphic), so it needs no prefixing.
     */
    pict?: string | null;
    /** Credits paid (positive) with this event, if any. */
    payment?: number;
    /**
     * The mission's special-ship name (ActiveMission.shipName), so the
     * landing popups can expand <SN> in completion/failure/ShipDone/
     * cargo texts — stock missions do use it there (e.g. mïsn nova:158
     * and nova:159, the Polaris "Watch Wraith Talks" pair). The event
     * is the only mission shape those popups get; absent when the
     * mission has no ShipNameID list.
     */
    specialShipName?: string;
    /**
     * For cargo events: which stop the transfer happened at. 'return' is
     * the DropOffMode 1 drop at the mission's end, where "here" is the
     * RETURN stellar (the mission is already gone from the player's state
     * when the popup is shown, so the popup can't look it up).
     */
    stop?: 'travel' | 'return';
}

/**
 * The player-local mutable state mission processing operates on.
 * These are working copies (the spaceport commit pattern): the caller
 * builds them from the entity's components and commits them back.
 */
export interface MissionWorkingState {
    missions: Missions;
    cargo: Cargo;
    credits: { credits: number };
    bits: Set<number>;
    /** Total cargo capacity in tons (not free space). */
    cargoCapacity: number;
    /** Days the game date should be advanced (DatePostInc), summed. */
    dateAdvance: number;
    events: MissionEvent[];
    /**
     * The player's legal records, for CompReward and the PayVal
     * record-cleaning encodings. Optional so bare test states keep
     * working; reputation effects are skipped when absent.
     */
    records?: LegalRecords;
    /**
     * The player's active ranks, for the Kxxx/Lxxx set operators
     * (rank_logic.ts). Optional so bare test states keep working; rank
     * activation is then reported as an unimplemented hook, exactly as it
     * was before ranks existed.
     */
    ranks?: ActiveRanks;
    /**
     * Special-ship batches of missions that auto-aborted at accept while
     * docked, waiting for lift-off (PendingAutoAbortShipsComponent).
     * acceptOffer appends; MissionSession seeds and commits it. Optional so
     * bare test states keep working — without it an auto-abort's ships are
     * simply not recorded, as before.
     */
    autoAbortShips?: PendingAutoAbortShip[];
}

export interface MissionMachineryContext {
    state: MissionWorkingState;
    /**
     * Cached mission data lookup (warm the cache first). Doubles as the
     * missions-exists lookup the Sxxx/Axxx/Fxxx operators resolve their
     * bare numbers through (resolveNumberedResource, stock-first), so it
     * must answer for every loaded mission — MissionUniverse's
     * missionsById does.
     */
    getMission(id: string): MissionData | undefined;
    /** Context for resolving Sxxx-started missions' destinations. */
    offerContext(): MissionContext;
    random(): number;
    /**
     * Every govt (deterministic order), for ally/classmate scopes of
     * the PayVal record-cleaning encodings. Optional; cleaning
     * degrades to the named govt only when absent.
     */
    allGovts?(): Iterable<readonly [string, GovtData]>;
    /**
     * Whether two stellar ids denote the "same stellar" — identical name
     * and map coordinates — so landing on one fulfils a travel/return
     * objective set to the other (EVN Bible, TravelStel/ReturnStel: "the
     * mission travel objectives will also be fulfilled when landing on a
     * duplicate stellar that has the idendical name and coordinates to the
     * stellar you specify here"). Optional; without it only exact-id
     * matches complete a landing.
     */
    sameStellar?(a: string, b: string): boolean;
    /**
     * Resolves a global rank id to its data, so the Kxxx/Lxxx operators can
     * run the Bible's deactivation cascades. Doubles as the ranks-exists
     * lookup those operators resolve their bare numbers through
     * (resolveNumberedResource, stock-first), so it must answer for every
     * loaded rank — MissionUniverse's ranksById does. Optional; without it
     * a rank is still activated/deactivated under the writer's own prefix,
     * just with no cascade (rank_logic.ts records unresolvable ranks
     * rather than dropping player state).
     */
    getRank?(id: string): RankData | undefined;
    /**
     * Whether an oütf with this global id exists, so `Gxxx` / `Dxxx` can
     * resolve their bare numbers stock-first like every other numeric
     * reference (resolveNumberedResource). Optional; without it a plug-in's
     * number always means that plug-in's own outfit.
     */
    outfitExists?(globalId: string): boolean;
    /**
     * `Xxxx` ("make system ID xxx be explored"): the player's per-system
     * discovery record. Player-local display/save state, threaded in like
     * the outfits map rather than imported (see discovery.ts's
     * DiscoveryAccess). Optional; without it `Xxxx` is reported as an
     * unimplemented hook, as it was before this existed.
     */
    discovery?: DiscoveryAccess;
    /**
     * Whether a sÿst with this global id exists, so `Xxxx` resolves its
     * bare number stock-first and ignores a number no data set defines.
     */
    systemExists?(globalId: string): boolean;
    /**
     * `Cxxx` / `Exxx` / `Hxxx` (change the player's ship to type xxx; the
     * three outfit treatments are ncb.ts's ShipChangeMode).
     * The ship is an ENTITY swap, which only the venue holding the docked
     * entity can perform, so this is supplied by that venue (the
     * outfitter, for an oütf OnPurchase like stock 314's `H165`) and is
     * otherwise reported as an unimplemented hook. `globalShipId` is
     * already resolved stock-first through `shipExists`.
     */
    changeShip?(globalShipId: string, mode: ShipChangeMode): void;
    /**
     * Whether a shïp with this global id exists, so the change-ship
     * operators resolve their bare number stock-first like every other
     * numeric reference.
     */
    shipExists?(globalId: string): boolean;
}
