/**
 * Importing an ORIGINAL EV Nova pilot file as a NovaJS pilot.
 *
 * novaparse's pilot parser (packages/novaparse/src/pilot) decodes the two
 * SimpleCrypt-scrambled 'NpïL' blobs; this module maps its PilotData onto
 * our SaveData + PilotProfile. What comes across, and what cannot:
 *
 *   ship, outfits (index + 128 -> 'nova:<id>'), credits, date, last
 *   stellar -> the system it is in, control bits (bare numbers, legacy
 *   `novaControlBits` field), ranks, combat rating (kill count), standard
 *   cargo + jünk aboard, legal records (see below), and active missions
 *   WITHOUT special ships (see below). Nickname / gender / strict play
 *   feed the profile; the pilot's NAME is not stored in the file (only the
 *   ship's), so the file's name stands in.
 *
 *   Legal status: the original keeps it PER SYSTEM; NovaJS keeps records
 *   PER GOVERNMENT (reputation.ts). Each system's status is attributed to
 *   that system's gövt, and a gövt with several systems keeps the value of
 *   largest magnitude — a rough carry-over, noted on import.
 *
 *   Missions: an active slot maps onto ActiveMission when it has no
 *   special ships (a special-ship goal's runtime state — the mission ship
 *   entities, their fates — has no counterpart in the file and cannot be
 *   re-created faithfully); those are skipped with a note. acceptedDay /
 *   acceptedAt are not stored either, so the current day / last stellar
 *   stand in.
 *
 *   Exploration: the file's 2048-entry per-system map imports as-is —
 *   its three states are the ones NovaJS uses (see discovery.ts).
 *
 *   NOT importable: escorts and deployed fighters (no NovaJS entities to
 *   build them from — noted with a count), fuel and shield (not part of
 *   SaveData), stellar domination / defense fleets / përs liveness /
 *   disasters / cröns (no NovaJS state for them yet).
 *
 * WHAT A BROWSER CAN READ. The file picker yields the DATA FORK. A Windows
 * `.plt` is a flat data-fork file and imports directly. A Mac pilot's data
 * lives in its RESOURCE FORK, which the browser never sees (the picked
 * file reads as empty) — the parser explains this and how to copy the
 * fork out (`cp "Pilot/..namedfork/rsrc" Pilot.rsrc`), which then imports
 * as resource-fork-format bytes.
 */

import { PilotData } from 'novaparse/pilot/pilot_data';
import { parsePilotBytes } from 'novaparse/pilot/pilot_parse';
import { dayNumber, daysInMonth } from '../nova_plugin/calendar.js';
import {
    DISCOVERY_UNKNOWN, toDiscoveryLevel,
} from '../nova_plugin/discovery.js';
import { ActiveMission } from '../nova_plugin/player_state_plugin.js';
import { SaveData } from '../nova_plugin/save_game.js';
import { saveDefaults } from '../nova_plugin/save_migrations.js';
import { PilotProfile } from './client_prefs.js';

/** Arrays in a pilot file are indexed by resource id - 128. */
const RESOURCE_INDEX_OFFSET = 128;

/**
 * Whether file bytes look like an ORIGINAL pilot rather than a NovaJS
 * (JSON) pilot file: JSON starts with '{' after optional whitespace/BOM.
 */
export function looksLikeOriginalPilot(bytes: Uint8Array): boolean {
    let i = 0;
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb
        && bytes[2] === 0xbf) {
        i = 3;
    }
    while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09
        || bytes[i] === 0x0a || bytes[i] === 0x0d)) {
        i++;
    }
    return !(i < bytes.length && bytes[i] === 0x7b /* { */);
}

/** Game-data lookups the conversion needs (all by global id). */
export interface OriginalPilotContext {
    knownShip(id: string): boolean;
    knownOutfit(id: string): boolean;
    knownMission(id: string): boolean;
    knownRank(id: string): boolean;
    knownJunk(id: string): boolean;
    /**
     * The system a planet is in, or undefined for an unknown planet. The
     * pilot's set control bits are passed so a stellar stacked in duplicate
     * systems under exclusive Visibility bits resolves to the copy this
     * pilot can see (MissionUniverse.systemIdOfPlanet).
     */
    systemOfPlanet(planetId: string, bits: ReadonlySet<number>):
        string | undefined;
    /** A system's gövt id, or null/undefined for independent/unknown. */
    govtOfSystem(systemId: string): string | null | undefined;
    /** Where a pilot goes when its last stellar is unknown. */
    fallbackSystem: string;
}

export interface OriginalPilotConversion {
    save: SaveData;
    profile: PilotProfile;
    /** Human-readable caveats: what was skipped or approximated. */
    notes: string[];
    /** The last stellar landed on (global id), when it is a known planet. */
    lastStellar?: string;
}

function globalId(index: number): string {
    return `nova:${index + RESOURCE_INDEX_OFFSET}`;
}

/** The file stores cash as a signed int32; the game only ever shows
 * [0, 2^31). */
const MAX_CREDITS = 0x7fffffff;

function clampCredits(cash: number, notes: string[]): number {
    if (Number.isSafeInteger(cash) && cash >= 0 && cash <= MAX_CREDITS) {
        return cash;
    }
    const clamped = Number.isSafeInteger(cash) && cash > MAX_CREDITS
        ? MAX_CREDITS : 0;
    notes.push(`The file's credits (${cash}) were out of range and were `
        + `set to ${clamped}.`);
    return clamped;
}

/**
 * A calendar date within the proleptic Gregorian calendar calendar.ts
 * implements: month 1-12, day within the month, a non-negative year.
 * Out-of-range parts are clamped into range (the year is kept when it
 * is a year at all — it is what the pilot's crön history hangs on).
 */
function clampDate(date: { year: number, month: number, day: number },
    notes: string[]): { year: number, month: number, day: number } {
    const year = Number.isSafeInteger(date.year) && date.year >= 0
        ? date.year : 0;
    const month = Number.isSafeInteger(date.month)
        ? Math.min(12, Math.max(1, date.month)) : 1;
    const day = Number.isSafeInteger(date.day)
        ? Math.min(daysInMonth(month, year), Math.max(1, date.day)) : 1;
    if (year !== date.year || month !== date.month || day !== date.day) {
        notes.push(`The file's date (${date.year}-${date.month}-${date.day}) `
            + `was not a calendar date and was clamped to `
            + `${year}-${month}-${day}.`);
    }
    return { year, month, day };
}

/** Maps a parsed original pilot onto a NovaJS save + profile. */
export function convertOriginalPilot(pilot: PilotData,
    fileName: string, ctx: OriginalPilotContext): OriginalPilotConversion {
    const notes: string[] = [];
    const player = pilot.player;
    const globals = pilot.globals;

    const shipId = globalId(player.shipClass);
    if (!ctx.knownShip(shipId)) {
        notes.push(`Ship ${shipId} is not in this game's data.`);
    }

    const outfits: [string, number][] = [];
    let unknownOutfits = 0;
    player.outfitCount.forEach((count, i) => {
        if (count <= 0) {
            return;
        }
        const id = globalId(i);
        if (!ctx.knownOutfit(id)) {
            unknownOutfits++;
            return;
        }
        outfits.push([id, count]);
    });
    if (unknownOutfits > 0) {
        notes.push(`${unknownOutfits} owned outfit${unknownOutfits === 1 ? '' : 's'}`
            + ' not in this game\'s data were dropped.');
    }

    const novaControlBits: [string, number][] = [];
    const bits = new Set<number>();
    player.missionBits.forEach((set, bit) => {
        if (set) {
            novaControlBits.push([String(bit), 1]);
            bits.add(bit);
        }
    });

    const lastStellar = player.lastStellar >= 0
        ? globalId(player.lastStellar) : undefined;
    let system = lastStellar
        ? ctx.systemOfPlanet(lastStellar, bits) : undefined;
    if (!system) {
        notes.push(`Last stellar ${lastStellar ?? '(none)'} is unknown; the `
            + 'pilot starts in the default system.');
        system = ctx.fallbackSystem;
    }

    // The file's fields are read as raw int16/int32 and land in the save
    // unvalidated otherwise. A crafted or corrupt pilot can carry a
    // negative int32 cash (EV Nova has no debt — every in-game credit
    // change clamps at 0, and a negative starting balance would skip
    // that) or a month/day outside the calendar, which dayNumber's month
    // table cannot index (NaN deadlines). Clamp both and say so.
    const date = clampDate(player.date, notes);
    const today = dayNumber(date);
    const credits = clampCredits(player.cash, notes);
    const kills = Number.isSafeInteger(player.rating) && player.rating > 0
        ? player.rating : 0;

    const ranks: string[] = [];
    globals.rankActive.forEach((active, i) => {
        if (active !== 0) {
            const id = globalId(i);
            if (ctx.knownRank(id)) {
                ranks.push(id);
            }
        }
    });

    const cargo: [string, number][] = [];
    player.cargo.forEach((tons, i) => {
        if (tons > 0) {
            cargo.push([`cargo:${i}`, tons]);
        }
    });
    globals.junkQty.forEach((tons, i) => {
        if (tons > 0) {
            const id = globalId(i);
            if (ctx.knownJunk(id)) {
                cargo.push([`junk:${id}`, tons]);
            }
        }
    });

    // Legal status per system -> record per gövt (largest magnitude wins).
    const records = new Map<string, number>();
    let attributed = 0;
    player.legalStatus.forEach((status, i) => {
        if (status === 0) {
            return;
        }
        const govt = ctx.govtOfSystem(globalId(i));
        if (!govt) {
            return;
        }
        attributed++;
        const current = records.get(govt);
        if (current === undefined || Math.abs(status) > Math.abs(current)) {
            records.set(govt, status);
        }
    });
    if (attributed > 0) {
        notes.push('Legal status was per system in the original; each '
            + 'government keeps its strongest value.');
    }

    // Missions without special ships.
    const missions: [string, ActiveMission][] = [];
    let skippedMissions = 0;
    for (const slot of player.missions) {
        if (!slot.objectives.active) {
            continue;
        }
        const data = slot.data;
        const id = data.missionId >= 0 ? globalId(data.missionId) : undefined;
        if (!id || !ctx.knownMission(id) || data.specialShipCount > 0
            || data.initialShipCount > 0 || data.auxShipCount > 0) {
            skippedMissions++;
            continue;
        }
        const travelPlanet = data.travelStellar >= 0
            ? globalId(data.travelStellar) : null;
        const returnPlanet = data.returnStellar >= 0
            ? globalId(data.returnStellar) : null;
        missions.push([id, {
            id,
            acceptedDay: today,
            acceptedAt: lastStellar ?? '',
            travelPlanet,
            returnPlanet,
            cargoType: data.cargoType,
            cargoQty: data.cargoQty > 0 ? data.cargoQty : 0,
            cargoLoaded: data.cargoLoaded,
            travelDone: slot.objectives.travelObjComplete,
            deadlineDay: data.timeLeft > 0 ? today + data.timeLeft : null,
            ...(slot.objectives.missionFailed ? { failed: true } : {}),
        }]);
    }
    if (skippedMissions > 0) {
        notes.push(`${skippedMissions} active mission${skippedMissions === 1 ? '' : 's'}`
            + ' could not be imported (special ships, or unknown mission).');
    }
    if (player.escorts.length > 0 || player.fighters.length > 0) {
        notes.push(`${player.escorts.length} escort(s) and `
            + `${player.fighters.length} deployed fighter(s) were not imported.`);
    }

    // The exploration map imports 1:1: the file's per-system value uses the
    // SAME three states NovaJS does ("<= 0 unexplored, 1 visited, 2 visited
    // and landed within" — novaparse pilot_data.ts, and discovery.ts).
    // Unexplored entries are simply left out; an id this data set has no
    // sÿst for is harmless, since nothing ever looks it up.
    const discovery: [string, number][] = [];
    player.exploration.forEach((value, index) => {
        const level = toDiscoveryLevel(value);
        if (level > DISCOVERY_UNKNOWN) {
            discovery.push([globalId(index), level]);
        }
    });

    // The fields the file has nothing for take the save's own defaults:
    // no cron progress (crons are NovaJS's own record), no escorts (not
    // imported; see the note above), no auto-abort squad pending.
    const save: SaveData = {
        ...saveDefaults(),
        ship: shipId,
        outfits,
        system,
        credits,
        date,
        missions,
        novaControlBits,
        ranks: ranks.sort(),
        cargo,
        reputations: [...records],
        combatRatings: [['kills', kills]],
        discovery,
    };

    const baseName = fileName.replace(/\.[^.]*$/, '').trim();
    const profile: PilotProfile = {
        name: baseName || pilot.shipName || 'Imported Pilot',
        nickname: globals.nickname,
        gender: globals.gender === 1 ? 'male' : 'female',
        strict: globals.strictPlay,
    };
    return {
        save, profile, notes,
        ...(lastStellar && ctx.systemOfPlanet(lastStellar, bits)
            ? { lastStellar } : {}),
    };
}

/** Parses + converts file bytes in one step (throws on an unreadable file). */
export function convertOriginalPilotBytes(bytes: Uint8Array, fileName: string,
    ctx: OriginalPilotContext): OriginalPilotConversion {
    return convertOriginalPilot(parsePilotBytes(bytes), fileName, ctx);
}
