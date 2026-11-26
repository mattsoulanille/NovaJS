/**
 * Importing an ORIGINAL EV Nova pilot file as a NovaJS pilot.
 *
 * novaparse's pilot parser (packages/novaparse/src/pilot) decodes the two
 * SimpleCrypt-scrambled 'NpïL' blobs; this module maps its PilotData onto
 * our SaveData + PilotProfile. What comes across, and what cannot:
 *
 *   ship, outfits (index + 128 -> 'nova:<id>'), mounted weapons and
 *   ammunition (see below), credits, date, last
 *   stellar -> the system it is in, control bits (bare numbers, legacy
 *   `novaControlBits` field), ranks, combat rating (kill count), standard
 *   cargo + jünk aboard, legal records (see below), and active missions
 *   WITHOUT special ships (see below). Nickname / gender / strict play
 *   feed the profile; the pilot's NAME is not stored in the file (only the
 *   ship's, which becomes the save's `shipName`), so the file's name
 *   stands in.
 *
 *   Legal status: kept PER SYSTEM by both (ruling #380), so each system's
 *   value maps straight across to the same sÿst id. A value equal to what
 *   an absent entry would read anyway (the system's status govt's
 *   InitialRec) is left out; systems this data set lacks are skipped.
 *
 *   Missions: an active slot maps onto ActiveMission when it has no
 *   special ships (a special-ship goal's runtime state — the mission ship
 *   entities, their fates — has no counterpart in the file and cannot be
 *   re-created faithfully); those are skipped with a note. acceptedDay /
 *   acceptedAt are not stored either, so the current day / last stellar
 *   stand in.
 *
 *   Weapons and ammo: the file keeps a weapCount and an ammo count per
 *   wëap alongside outfitCount. In a pilot the original wrote they mirror
 *   the oütfs (a new Shuttle stores oütf 128 and wëap 128 once each; the
 *   stock Fed scenario pilot's bay fighters sit in both ammo[] and their
 *   ammo oütfs), so only what the oütfs do NOT already account for is
 *   added: a weapon no owned item mounts (a hull weapon with no oütf, or
 *   an edited file) through the implicit built-in weapon outfit, and
 *   rounds beyond what the owned ammo oütfs hold onto the ammo oütf
 *   feeding the weapon's AmmoType supply, as novaparse's ship_parse loads
 *   a hull's stock AmmoLoad, capped like a purchase (see importWeaponry).
 *
 *   Exploration: the file's 2048-entry per-system map imports as-is —
 *   its three states are the ones NovaJS uses (see discovery.ts).
 *
 *   NOT importable: escorts and deployed fighters (no NovaJS entities to
 *   build them from — noted with a count), fuel and shield (not part of
 *   SaveData), defense fleet counts (not kept between visits here) / përs
 *   liveness / disasters / cröns (no NovaJS state for them yet). The
 *   dominated stellars ARE imported (`dominated`).
 *
 * WHAT A BROWSER CAN READ. The file picker yields the DATA FORK. A Windows
 * `.plt` is a flat data-fork file and imports directly. A Mac pilot's data
 * lives in its RESOURCE FORK, which the browser never sees (the picked
 * file reads as empty) — the parser explains this and how to copy the
 * fork out (`cp "Pilot/..namedfork/rsrc" Pilot.rsrc`), which then imports
 * as resource-fork-format bytes.
 */

import type { OutfitData } from 'novadatainterface/outfit_data';
import type { ShipData } from 'novadatainterface/ship_data';
import type { WeaponData } from 'novadatainterface/weapon_data';
import {
    ammoSupplyWeaponId, builtInAmmoOutfitId, builtInOutfitWeaponId,
    builtInWeaponOutfitId, makeBuiltInAmmoOutfit, makeBuiltInWeaponOutfit,
    preferredAmmoOutfit,
} from 'novaparse/built_in_weapon_outfit';
import { PilotData } from 'novaparse/pilot/pilot_data';
import { parsePilotBytes } from 'novaparse/pilot/pilot_parse';
import {
    dayNumber, daysInMonth, DISCOVERY_UNKNOWN, toDiscoveryLevel, ActiveMission,
    sanitizeShipName,
} from '../nova_plugin/player/index.js';
import {
    ammoPurchaseRoom, SaveData, saveDefaults,
} from '../nova_plugin/pilot/index.js';
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
    /**
     * What an ABSENT record entry reads as in a known system: its status
     * govt's InitialRec (reputation/system_records.ts). Optional; without
     * it every non-zero value is imported and zeroes are left out.
     */
    initialRecordIn?(systemId: string): number;
    /** Where a pilot goes when its last stellar is unknown. */
    fallbackSystem: string;
    /**
     * Data lookups for the file's weapon and ammo counts (importWeaponry).
     * Optional; without them those counts are not imported, with a note.
     */
    weaponry?: OriginalPilotWeaponry;
}

/** Game data the weapon and ammo import reads, by global id. */
export interface OriginalPilotWeaponry {
    /** An oütf, including an implicit built-in one; undefined if unknown. */
    getOutfit(id: string): OutfitData | undefined;
    getWeapon(id: string): WeaponData | undefined;
    getShip(id: string): ShipData | undefined;
    /** Every oütf whose ammoFor is `supply`, in id-space order. */
    ammoOutfitsFeeding(supply: string): readonly string[];
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

/** The slice of game data loadOriginalPilotWeaponry reads. */
export interface WeaponryGameData {
    readonly ids: Promise<{ readonly Outfit: readonly string[],
        readonly Weapon: readonly string[], readonly Ship: readonly string[] }>;
    readonly data: {
        readonly Outfit: { get(id: string): Promise<OutfitData> };
        readonly Weapon: { get(id: string): Promise<WeaponData> };
        readonly Ship: { get(id: string): Promise<ShipData> };
    };
}

/**
 * Loads every oütf, wëap and shïp up front so the (synchronous) import
 * can look them up. An implicit built-in outfit id resolves the way
 * novaparse serves it, from its weapon. A resource that fails to load
 * reads as unknown.
 */
export async function loadOriginalPilotWeaponry(gameData: WeaponryGameData):
    Promise<OriginalPilotWeaponry> {
    const ids = await gameData.ids;
    async function load<T>(list: readonly string[],
        get: (id: string) => Promise<T>): Promise<Map<string, T | undefined>> {
        const loaded = await Promise.all(list.map(
            id => get(id).catch(() => undefined)));
        return new Map(list.map((id, i) => [id, loaded[i]]));
    }
    const [outfits, weapons, ships] = await Promise.all([
        load(ids.Outfit, id => gameData.data.Outfit.get(id)),
        load(ids.Weapon, id => gameData.data.Weapon.get(id)),
        load(ids.Ship, id => gameData.data.Ship.get(id)),
    ]);
    const feeding = new Map<string, string[]>();
    for (const id of ids.Outfit) {
        const ammoFor = outfits.get(id)?.ammoFor;
        if (ammoFor) {
            feeding.set(ammoFor, [...(feeding.get(ammoFor) ?? []), id]);
        }
    }
    return {
        getOutfit(id) {
            const builtIn = builtInOutfitWeaponId(id);
            if (!builtIn) {
                return outfits.get(id);
            }
            const weapon = weapons.get(builtIn.weaponId);
            return weapon && (builtIn.kind === 'weapon'
                ? makeBuiltInWeaponOutfit(weapon)
                : makeBuiltInAmmoOutfit(weapon));
        },
        getWeapon: id => weapons.get(id),
        getShip: id => ships.get(id),
        ammoOutfitsFeeding: supply => feeding.get(supply) ?? [],
    };
}

/**
 * Adds to `outfits` (the file's oütfs, already imported) whatever the
 * file's weapCount and ammo arrays hold that those oütfs do not.
 *
 * WEAPONS. For each wëap, the count the owned items already mount is
 * subtracted from weapCount; any remainder is a weapon the pilot has but
 * owns no item for, and it is mounted through the implicit built-in
 * weapon outfit (novaparse built_in_weapon_outfit.ts) — massless and
 * unsellable, as the original offers no item to sell. A weapon count
 * BELOW what the items mount removes nothing: the items are what was
 * bought.
 *
 * AMMO. ammo[i] is rounds for wëap i's supply: the weapon its AmmoType
 * names (EVN Bible ~:3117), which ship_parse also follows for a hull's
 * AmmoLoad. Rounds the owned ammo oütfs feeding that supply already hold
 * are subtracted; the rest become the oütf preferredAmmoOutfit picks
 * among those feeding it (or, when none does, the weapon's implicit
 * magazine, as ship_parse does), capped like a purchase: the oütf's Max,
 * the launchers' room when the supply weapon sets MaxAmmo, and the hull's
 * free mass (ammoPurchaseRoom). Two entries drawing on one supply count
 * once (the larger). A weapon with no supply (unlimited, fuel per shot)
 * has no rounds to import.
 */
function importWeaponry(player: PilotData['player'], shipId: string,
    outfits: [string, number][], data: OriginalPilotWeaponry,
    notes: string[]) {
    const add = (id: string, count: number) => {
        const entry = outfits.find(([other]) => other === id);
        if (entry) {
            entry[1] += count;
        } else {
            outfits.push([id, count]);
        }
    };

    let unknownWeapons = 0;
    player.weaponCount.forEach((count, i) => {
        if (count <= 0) {
            return;
        }
        const weaponId = globalId(i);
        if (!data.getWeapon(weaponId)) {
            unknownWeapons++;
            return;
        }
        let mounted = 0;
        for (const [id, n] of outfits) {
            mounted += (data.getOutfit(id)?.weapons[weaponId] ?? 0) * n;
        }
        if (count > mounted) {
            add(builtInWeaponOutfitId(weaponId), count - mounted);
        }
    });
    if (unknownWeapons > 0) {
        notes.push(`${unknownWeapons} weapon${unknownWeapons === 1 ? '' : 's'}`
            + ' not in this game\'s data were dropped.');
    }

    // Supply -> rounds, and the weapon whose implicit magazine carries
    // them when no oütf feeds the supply (the first entry naming it).
    const rounds = new Map<string, { count: number, carrier: string }>();
    player.ammo.forEach((count, i) => {
        if (count <= 0) {
            return;
        }
        const weapon = data.getWeapon(globalId(i));
        const supply = weapon && ammoSupplyWeaponId(weapon);
        if (!weapon || supply === undefined) {
            return;
        }
        const seen = rounds.get(supply);
        rounds.set(supply, {
            count: Math.max(count, seen?.count ?? 0),
            carrier: seen?.carrier ?? weapon.id,
        });
    });
    const ship = data.getShip(shipId);
    let dropped = 0;
    for (const [supply, { count, carrier }] of rounds) {
        let held = 0;
        for (const [id, n] of outfits) {
            if (data.getOutfit(id)?.ammoFor === supply) {
                held += n;
            }
        }
        if (count <= held) {
            continue;
        }
        const target = preferredAmmoOutfit(data.ammoOutfitsFeeding(supply))
            ?? builtInAmmoOutfitId(carrier);
        const targetData = data.getOutfit(target);
        if (!targetData) {
            dropped += count - held;
            continue;
        }
        const room = ammoPurchaseRoom(targetData, outfits, ship,
            id => data.getOutfit(id), data.getWeapon(supply));
        const added = Math.min(count - held, room);
        if (added > 0) {
            add(target, added);
        }
        dropped += count - held - added;
    }
    if (dropped > 0) {
        notes.push(`${dropped} round${dropped === 1 ? '' : 's'} of ammunition`
            + ' did not fit this ship and were dropped.');
    }
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

    if (ctx.weaponry) {
        importWeaponry(player, shipId, outfits, ctx.weaponry, notes);
    } else if (player.weaponCount.some(n => n > 0)
        || player.ammo.some(n => n > 0)) {
        notes.push('Weapon and ammunition counts were not imported.');
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

    // Legal status per system -> record per system, straight across (both
    // keep it per sÿst; ruling #380). Unknown systems are skipped, and a
    // value an absent entry would read as anyway is not materialized.
    const records = new Map<string, number>();
    player.legalStatus.forEach((status, i) => {
        const systemId = globalId(i);
        if (ctx.govtOfSystem(systemId) === undefined) {
            return;
        }
        if (status !== (ctx.initialRecordIn?.(systemId) ?? 0)) {
            records.set(systemId, status);
        }
    });

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

    // The stellars the pilot dominated (#353), by the file's per-stellar
    // flag (spöb id = index + 128). An id this data set has no spöb for
    // pays no tribute (encounters/tribute.ts's dailyTribute skips it).
    // The file's per-stellar defence-ship counts are not imported: here a
    // fleet is not kept between visits (Matthew's ruling on #353).
    const dominated: string[] = [];
    player.dominated.forEach((flag, index) => {
        if (flag) {
            dominated.push(globalId(index));
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
        legalRecords: [...records],
        combatRatings: [['kills', kills]],
        discovery,
    };
    // The ship's name, as the player named it in the original (its
    // pilot file keeps it), cleaned like any typed name (player_names.ts).
    const shipName = sanitizeShipName(pilot.shipName);
    if (shipName !== undefined) {
        save.shipName = shipName;
    }
    if (dominated.length > 0) {
        save.dominated = dominated.sort();
    }

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
