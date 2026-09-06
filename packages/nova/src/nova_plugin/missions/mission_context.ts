import { GovtData } from 'novadatainterface/govt_data';
import { DiscoveryAccess } from '../player/index.js';
import type { SystemInfo } from './mission_ship_logic.js';
import type { StellarInfo } from './mission_stellar.js';
import { Missions } from '../player/index.js';
import { LegalRecords } from '../reputation/index.js';

/**
 * What mission availability and offer resolution need to know about the
 * player and the galaxy. Split out of mission_logic.ts.
 */

export interface MissionContext {
    /** The stellar the player is landed on. */
    stellar: StellarInfo;
    /** All landable stellars, for resolving random/ranged destinations. */
    stellarCandidates: StellarInfo[];
    /** The player's REAL control bits. */
    bits: Set<number>;
    /** Global id of the player's ship type. */
    shipId: string;
    /**
     * Global gövt id of the player's ship's inherent government, or
     * null/undefined when it has none (or the ship data isn't loaded).
     * Gates the AvailShipType ship-govt ranges (2128+/3128+).
     */
    shipGovt?: string | null;
    /**
     * The player's ship class's shïp InherentAI (1 wimpy trader, 2 brave
     * trader, 3 warship, 4 interceptor), gating mïsn Flags 0x2000 /
     * 0x4000. Absent (ship data not loaded) leaves both gates open,
     * like `shipGovt`.
     */
    shipInherentAI?: number;
    /** Missions already active (missions can't be offered twice). */
    activeMissions: Missions;
    /** Free cargo space in tons (capacity minus cargo aboard). */
    freeCargoSpace: number;
    /** The player's legal records (AvailRecord); absent = no records. */
    records?: LegalRecords;
    /** The player's combat-rating kill points (AvailRating). */
    combatRating?: number;
    /**
     * The player's combined 64-bit Contribute mask (ship + outfits),
     * checked against the mïsn Require field. Absent = 0n (only a
     * zero Require passes).
     */
    playerContribute?: bigint;
    /** Uniform [0, 1). Player-local; plain randomness is fine. */
    random(): number;
    /** Synchronous cached govt lookup (warm the cache first). */
    getGovt(id: string): GovtData | undefined;
    /** Current absolute day number (calendar.ts dayNumber). */
    currentDay: number;
    /**
     * All systems, for resolving special/aux ship spawn systems
     * (mission_ship_logic.ts). Optional: callers that don't supply it
     * keep ship-goal missions unofferable (fail closed).
     */
    systems?: SystemInfo[];
    /** Maps a planet id to its containing system id. */
    systemIdOfStellar?(planetId: string): string | undefined;
    /**
     * `Exxx` in AvailBits: the player's per-system discovery record
     * (discovery.ts). Optional — absent leaves every `Exxx` false, which is
     * how the term behaved before this was threaded through.
     */
    discovery?: DiscoveryAccess;
    /**
     * Whether a sÿst with this global id exists, so `Exxx`'s bare number
     * resolves stock-first like every other numeric reference. Without it a
     * plug-in's number always means that plug-in's own system.
     */
    systemExists?(globalId: string): boolean;
    /**
     * `Oxxx` in AvailBits: the player's owned outfits (global id -> count),
     * the same map the set-string `Gxxx`/`Dxxx` operators work on. Optional
     * — absent leaves every `Oxxx` false, which is what the term evaluated
     * to before this was threaded through (and what left mïsn nova:649
     * "Renew darts", `b371 & !O226`, firing on EVERY landing: `!O226` was
     * always true, so a Vell-os pilot holding darts was handed three more
     * each time). MissionSession supplies its working copy.
     */
    ownedOutfits?: ReadonlyMap<string, number>;
    /**
     * The player's current fuel, for mïsn Flags 0x0008's offer gate:
     * "Mission takes away 100 units of fuel upon auto-abort. (mission won't
     * be offered if player has less than 100 units of fuel)". Optional —
     * a caller with no fuel reading (the bare test contexts) leaves the gate
     * open, the pre-existing behaviour, rather than silencing every Refuel
     * Trader for want of a number.
     */
    fuel?: number;
}
