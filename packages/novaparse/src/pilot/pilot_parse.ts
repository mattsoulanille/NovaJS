/**
 * Parser for EV Nova pilot (saved-game) files.
 *
 * A Nova pilot is two encrypted resources of type 'NpïL':
 *  - id 128 "Pilot Data": PlayerFileDataStruct (59826 bytes) — the player's
 *    own state (ship, cargo, outfits, explored systems, legal records,
 *    missions, mission bits, dominated stellars, escorts, credits, rating).
 *  - id 129: AltPlayerFileDataStruct (26366 bytes) — universe state (stellar
 *    defense fleets, përs liveness, disasters, cröns, ranks...). The *name*
 *    of this resource is the name of the player's ship.
 *
 * On the Mac the two resources live in a resource fork. The Windows `.plt`
 * format concatenates the two (still individually encrypted) resource blobs,
 * each prefixed with its size as a little-endian uint32, and appends the ship
 * name as a NUL-terminated string; its struct fields are little-endian and it
 * drops three unused padding runs from each MissionData (2278 bytes instead
 * of 2284, so the first blob is 59730 bytes).
 *
 * Both are scrambled with Andrew Welch's SimpleCrypt (see simple_crypt.ts).
 *
 * Byte-layout authority:
 * https://andrews05.github.io/evstuff/guides/pilotformat.txt, cross-checked
 * against vasi's evnova-utils (Scripts/lib/Nova/Old/pilot/read.pl). Absolute
 * offsets from that document appear in comments below.
 *
 * Future work hook: a "import pilot file" feature would map PilotData onto
 * packages/nova/src/nova_plugin/save_game.ts's SaveData — see
 * docs/pilot_file_format.md for the field correspondence.
 */
import { decode_macroman, parseResourceFork, ResourceMap } from "resource_fork/parse";
import { Reader } from "../resource_parsers/reader.js";
import { simpleCrypt } from "./simple_crypt.js";
import {
    PilotData,
    PilotEscort,
    PilotFighter,
    PilotGlobalsData,
    PilotMission,
    PilotMissionData,
    PilotMissionObjectives,
    PilotPlayerData,
} from "./pilot_data.js";

/** Resource type of Nova pilot resources ("NpïL" in MacRoman). */
export const NOVA_PILOT_RESOURCE_TYPE = "NpïL";

/** Size of the decrypted NpïL 128 (PlayerFileDataStruct) on Mac. */
export const MAC_PLAYER_DATA_SIZE = 59826;
/** Size of the first blob of a .plt file (16 MissionDatas × 6 bytes smaller). */
export const PLT_PLAYER_DATA_SIZE = 59730;
/** Size of the decrypted NpïL 129 (AltPlayerFileDataStruct), both formats. */
export const GLOBALS_DATA_SIZE = 26366;

/**
 * A length byte followed by a fixed-capacity character buffer (the pilot
 * file's inline pascal strings, e.g. `Byte len; char[63] name`). Always
 * consumes 1 + capacity bytes.
 */
function fixedPString(r: Reader, capacity: number): string {
    const length = r.uint8();
    const bytes = r.array(capacity, () => r.uint8());
    return decode_macroman(bytes.slice(0, Math.min(length, capacity)));
}

/** MissionObjectives (20 bytes), at 0x281e in PlayerFileDataStruct. */
function parseMissionObjectives(r: Reader): PilotMissionObjectives {
    const active = r.uint8() !== 0;
    const travelObjComplete = r.uint8() !== 0;
    const shipObjComplete = r.uint8() !== 0;
    const missionFailed = r.uint8() !== 0;
    const flags = r.uint16();
    const year = r.int16();
    const month = r.int16();
    const day = r.int16();
    r.skip(8); // unused[4]: time fields of a DateTimeRec.
    return {
        active, travelObjComplete, shipObjComplete, missionFailed, flags,
        deadline: { year, month, day },
    };
}

/**
 * MissionData, at 0x295e in PlayerFileDataStruct. 2284 bytes on Mac; the
 * .plt format omits the three unused runs marked below (2278 bytes).
 * Offsets in comments are for the first mission, as in the format doc.
 */
function parseMissionData(r: Reader, plt: boolean): PilotMissionData {
    const travelStellar = r.int16(-1);
    r.skip(2); // 0x2960 unused (was travelSystem in original EV).
    const returnStellar = r.int16(-1);
    const specialShipCount = r.int16();
    const specialShipDude = r.int16(-1);
    const specialShipGoal = r.int16(-1);
    const specialShipBehavior = r.int16(-1);
    const specialShipStart = r.int16(-1);
    const specialShipSyst = r.int16(-1);
    const cargoType = r.int16(-1);
    const cargoQty = r.int16();
    const pickupMode = r.int16(-1);
    const dropoffMode = r.int16(-1);
    const scanMask = r.int16();
    const compGovt = r.int16(-1);
    const compReward = r.int16();
    const datePostInc = r.int16();
    if (!plt) {
        r.skip(2); // 0x2980 unused; 0 bytes in the .plt format.
    }
    const pay = r.int32();
    const specialShipsKilled = r.int16();
    const specialShipsBoarded = r.int16();
    const specialShipsDisabled = r.int16();
    const specialShipsJumpedIn = r.int16();
    const specialShipsJumpedOut = r.int16();
    const initialShipCount = r.int16();
    const canAbort = r.uint8() !== 0;
    const cargoLoaded = r.uint8() !== 0;
    // 0x2994 Boolean available (unused) + 0x2995 pad byte (Mac only).
    r.skip(plt ? 1 : 2);
    const briefText = r.int16(-1);
    const quickBriefText = r.int16(-1);
    const loadCargoText = r.int16(-1);
    const dropOffCargoText = r.int16(-1);
    const compText = r.int16(-1);
    const failText = r.int16(-1);
    const refuseText = r.int16(-1);
    const shipDoneText = r.int16(-1);
    const timeLeft = r.int16();
    const specialShipNameResId = r.int16(-1);
    const specialShipNameIndex = r.int16(-1);
    r.skip(2); // 0x29ac unknown (-1).
    const missionId = r.int16(-1);
    const specialShipSubtitleResId = r.int16(-1);
    const specialShipSubtitleIndex = r.int16(-1);
    const specialShipPreselectType = r.int16(-1);
    const flags = r.uint16();
    const flags2 = r.uint16();
    r.skip(8); // 0x29ba unsigned long requireBits[2] (unused).
    const auxShipCount = r.int16();
    const auxShipDude = r.int16(-1);
    const auxShipSyst = r.int16(-1);
    const auxShipsJumpedIn = r.int16();
    const auxShipDelay = r.int16();
    const auxShipsLeft = r.int16();
    const specialShipName = fixedPString(r, 63);      // 0x29ce
    const specialShipSubtitle = fixedPString(r, 63);  // 0x2a0e
    r.skip(255); // 0x2a4e char[255] availability (unused).
    const onAccept = r.string(255);   // 0x2b4d
    const onRefuse = r.string(255);
    const onSuccess = r.string(255);
    const onFailure = r.string(255);
    const onAbort = r.string(255);
    const onShipDone = r.string(255);
    const missionName = fixedPString(r, 127);         // 0x3147
    const unknownShorts = r.array(64, () => r.int16()); // 0x31c7
    if (!plt) {
        r.skip(3); // 0x3247 unused[3]; 0 bytes in the .plt format.
    }
    return {
        missionId, travelStellar, returnStellar, specialShipCount,
        specialShipDude, specialShipGoal, specialShipBehavior,
        specialShipStart, specialShipSyst, cargoType, cargoQty, pickupMode,
        dropoffMode, scanMask, compGovt, compReward, datePostInc, pay,
        specialShipsKilled, specialShipsBoarded, specialShipsDisabled,
        specialShipsJumpedIn, specialShipsJumpedOut, initialShipCount,
        canAbort, cargoLoaded, briefText, quickBriefText, loadCargoText,
        dropOffCargoText, compText, failText, refuseText, shipDoneText,
        timeLeft, specialShipNameResId, specialShipNameIndex,
        specialShipSubtitleResId, specialShipSubtitleIndex,
        specialShipPreselectType, flags, flags2, auxShipCount, auxShipDude,
        auxShipSyst, auxShipsJumpedIn, auxShipDelay, auxShipsLeft,
        specialShipName, specialShipSubtitle, onAccept, onRefuse, onSuccess,
        onFailure, onAbort, onShipDone, missionName, unknownShorts,
    };
}

/** Parses a decrypted PlayerFileDataStruct (NpïL 128 / first .plt blob). */
export function parsePlayerData(data: DataView, plt: boolean): PilotPlayerData {
    const expected = plt ? PLT_PLAYER_DATA_SIZE : MAC_PLAYER_DATA_SIZE;
    if (data.byteLength !== expected) {
        throw new Error(`Pilot player data must be ${expected} bytes for the `
            + `${plt ? 'plt' : 'mac'} format; got ${data.byteLength}`);
    }
    const r = new Reader(data, { littleEndian: plt });
    const lastStellar = r.int16(-1);            // 0x0000
    const shipClass = r.int16(-1);              // 0x0002
    const cargo = r.array(6, () => r.int16());  // 0x0004
    const unusedShield = r.int16();             // 0x0010
    const fuel = r.int16();                     // 0x0012
    const month = r.int16();                    // 0x0014
    const day = r.int16();                      // 0x0016
    const year = r.int16();                     // 0x0018
    const exploration = r.array(2048, () => r.int16());  // 0x001a
    const outfitCount = r.array(512, () => r.int16());   // 0x101a
    const legalStatus = r.array(2048, () => r.int16());  // 0x141a
    const weaponCount = r.array(256, () => r.int16());   // 0x241a
    const ammo = r.array(256, () => r.int16());          // 0x261a
    const cash = r.int32();                              // 0x281a
    const objectives =                                   // 0x281e
        r.array(16, () => parseMissionObjectives(r));
    const missionDatas =                                 // 0x295e
        r.array(16, () => parseMissionData(r, plt));
    const missionBits =                                  // 0xb81e (Mac)
        r.array(10000, () => r.uint8() !== 0);
    const dominated = r.array(2048, () => r.uint8() !== 0);  // 0xdf2e
    const escortClass = r.array(64, () => r.int16(-1));      // 0xe72e
    const fighterClass = r.array(64, () => r.int16(-1));     // 0xe7ae
    const escortUpgrade = r.array(64, () => r.int16());      // 0xe82e
    const escortSale = r.array(64, () => r.int16());         // 0xe8ae
    const escortVoiceMode = r.array(64, () => r.int16(-1));  // 0xe92e
    const rating = r.int32();                                // 0xe9ae
    if (r.remaining !== 0) {
        throw new Error(
            `Pilot player data parse consumed the wrong number of bytes `
            + `(${r.remaining} left over)`);
    }

    const missions: PilotMission[] = objectives.map((obj, i) => ({
        objectives: obj,
        data: missionDatas[i],
    }));

    // Escort slots hold -1 (empty), 0-767 (captured, value is the ship
    // class), or 1000-1767 (hired, value - 1000 is the ship class).
    const escorts: PilotEscort[] = [];
    for (let slot = 0; slot < 64; slot++) {
        const value = escortClass[slot];
        if (value === -1) {
            continue;
        }
        const hired = value >= 1000;
        escorts.push({
            slot,
            shipClass: hired ? value - 1000 : value,
            hired,
            scheduledUpgrade: escortUpgrade[slot] !== 0,
            scheduledSale: escortSale[slot] !== 0,
            voiceMode: escortVoiceMode[slot],
        });
    }
    const fighters: PilotFighter[] = [];
    for (let slot = 0; slot < 64; slot++) {
        const value = fighterClass[slot];
        if (value === -1) {
            continue;
        }
        fighters.push({ slot, shipClass: value });
    }

    return {
        lastStellar, shipClass, cargo, unusedShield, fuel,
        date: { year, month, day },
        exploration, outfitCount, legalStatus, weaponCount, ammo, cash,
        missions, missionBits, dominated, escorts, fighters, rating,
    };
}

/** Parses a decrypted AltPlayerFileDataStruct (NpïL 129 / second .plt blob). */
export function parseGlobalsData(data: DataView, plt: boolean): PilotGlobalsData {
    if (data.byteLength !== GLOBALS_DATA_SIZE) {
        throw new Error(`Pilot globals data must be ${GLOBALS_DATA_SIZE} `
            + `bytes; got ${data.byteLength}`);
    }
    const r = new Reader(data, { littleEndian: plt });
    const versionInfo = r.int16();                             // 0x0000
    const strictPlay = r.int16() !== 0;                        // 0x0002
    const gender = r.int16();                                  // 0x0004
    const stellarShipCount = r.array(2048, () => r.int16());   // 0x0006
    const personAlive = r.array(1024, () => r.int16() !== 0);  // 0x1006
    const personGrudge = r.array(1024, () => r.int16() !== 0); // 0x1806
    const rawUnused0x2006 = r.array(64, () => r.int16());      // 0x2006
    const stellarAnnoyance = r.array(2048, () => r.int16());   // 0x2086
    const seenIntroScreen = r.uint8() !== 0;                   // 0x3086
    const unknown0x3087 = r.uint8();                           // 0x3087
    const disasterTime = r.array(256, () => r.int16());        // 0x3088
    const disasterStellar = r.array(256, () => r.int16(-1));   // 0x3288
    const junkQty = r.array(128, () => r.int16());             // 0x3488
    const priceFlux = r.array(4, () => r.int16());             // 0x3588
    const cronDurations = r.array(512, () => r.int16());       // 0x3590
    const cronHoldoffs = r.array(512, () => r.int16());        // 0x3990
    const reinforcements = r.array(2048, () => r.int16());     // 0x3d90
    const stellarDestroyed = r.array(2048, () => r.int16(-1)); // 0x4d90
    const escortOrders = r.array(4, () => r.int16());          // 0x5d90
    const nickname = fixedPString(r, 63);                      // 0x5d98
    const red = r.uint16();                                    // 0x5dd8
    const green = r.uint16();
    const blue = r.uint16();
    const rankActive = r.array(128, () => r.int16());          // 0x5dde
    const datePrefix = r.string(16);                           // 0x5ede
    const dateSuffix = r.string(16);                           // 0x5eee
    const rawUnknownTail = r.array(1024, () => r.int16());     // 0x5efe
    if (r.remaining !== 0) {
        throw new Error(
            `Pilot globals data parse consumed the wrong number of bytes `
            + `(${r.remaining} left over)`);
    }
    return {
        versionInfo, strictPlay, gender, stellarShipCount, personAlive,
        personGrudge, rawUnused0x2006, stellarAnnoyance, seenIntroScreen,
        unknown0x3087, disasterTime, disasterStellar, junkQty, priceFlux,
        cronDurations, cronHoldoffs, reinforcements, stellarDestroyed,
        escortOrders, nickname, shipColor: { red, green, blue }, rankActive,
        datePrefix, dateSuffix, rawUnknownTail,
    };
}

function toDataView(data: Uint8Array): DataView {
    return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * Parses a pilot from a resource map containing the two encrypted 'NpïL'
 * resources (the Mac pilot file format).
 */
export function parsePilotResources(map: ResourceMap): PilotData {
    for (const classicType of ["MpïL", "OpïL"]) {
        if (map[classicType]) {
            throw new Error(
                `File is an EV ${classicType === "MpïL" ? 'Classic'
                    : 'Override'} pilot, not an EV Nova pilot`);
        }
    }
    const pilotResources = map[NOVA_PILOT_RESOURCE_TYPE];
    const player = pilotResources?.[128];
    const globals = pilotResources?.[129];
    if (!player || !globals) {
        throw new Error(`Not a Nova pilot file: missing `
            + `'${NOVA_PILOT_RESOURCE_TYPE}' resources 128 and 129`);
    }
    const playerDecrypted = simpleCrypt(new Uint8Array(
        player.data.buffer, player.data.byteOffset, player.data.byteLength));
    const globalsDecrypted = simpleCrypt(new Uint8Array(
        globals.data.buffer, globals.data.byteOffset, globals.data.byteLength));
    return {
        format: 'mac',
        // The name of resource 129 is the name of the player's ship.
        shipName: globals.name,
        player: parsePlayerData(toDataView(playerDecrypted), false),
        globals: parseGlobalsData(toDataView(globalsDecrypted), false),
    };
}

/**
 * Whether `data` (a file's data fork) looks like a Windows-format .plt
 * pilot: [uint32le size][blob][uint32le size][blob][ship name NUL].
 */
export function isPltPilot(data: Uint8Array): boolean {
    if (data.length < 8) {
        return false;
    }
    const dv = toDataView(data);
    const size1 = dv.getUint32(0, true);
    if (size1 !== PLT_PLAYER_DATA_SIZE || data.length < 8 + size1 + 4) {
        return false;
    }
    return dv.getUint32(4 + size1, true) === GLOBALS_DATA_SIZE;
}

/** Parses a Windows-format .plt pilot file. */
export function parsePltPilot(data: Uint8Array): PilotData {
    if (!isPltPilot(data)) {
        throw new Error('Not a Windows .plt pilot file');
    }
    const dv = toDataView(data);
    const size1 = dv.getUint32(0, true);
    const size2 = dv.getUint32(4 + size1, true);
    const playerDecrypted =
        simpleCrypt(data.subarray(4, 4 + size1));
    const globalsDecrypted =
        simpleCrypt(data.subarray(8 + size1, 8 + size1 + size2));
    // The trailing ship name is *not* encrypted.
    const nameBytes: number[] = [];
    for (let i = 8 + size1 + size2; i < data.length && data[i] !== 0; i++) {
        nameBytes.push(data[i]);
    }
    return {
        format: 'plt',
        shipName: decode_macroman(nameBytes),
        player: parsePlayerData(toDataView(playerDecrypted), true),
        globals: parseGlobalsData(toDataView(globalsDecrypted), true),
    };
}

/**
 * Parses a pilot from a file's BYTES, auto-detecting the container:
 * - a flat Windows-style .plt file, or
 * - resource-fork-format data holding 'NpïL' 128/129 (a Mac pilot whose
 *   resource fork was extracted to a plain file, e.g. `cp file/..namedfork/
 *   rsrc out.rsrc`, or a .rez container).
 *
 * This is the browser entry point: a browser only ever sees a file's data
 * fork, so a Mac pilot picked directly (whose data fork is empty) cannot
 * be read this way — see the error message. Disk reads with resource-fork
 * access live in pilot_read.ts (node only).
 */
export function parsePilotBytes(data: Uint8Array): PilotData {
    if (isPltPilot(data)) {
        return parsePltPilot(data);
    }
    if (data.length === 0) {
        throw new Error('The file is empty. A Mac pilot keeps its data in '
            + 'the resource fork, which a browser cannot read; copy the fork '
            + 'out first (e.g. `cp "Pilot/..namedfork/rsrc" Pilot.rsrc`) and '
            + 'import that, or use a Windows .plt pilot.');
    }
    let map: ResourceMap;
    try {
        // A copy of the bytes: the fork parser addresses the whole buffer.
        const copy = new Uint8Array(data.length);
        copy.set(data);
        map = parseResourceFork(copy.buffer);
    } catch {
        throw new Error('Not an EV Nova pilot file (neither a Windows .plt '
            + 'nor resource-fork data).');
    }
    return parsePilotResources(map);
}
