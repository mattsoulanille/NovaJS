/**
 * Builders for tiny synthetic pilot files.
 *
 * These write a handful of recognizable values at the *absolute offsets*
 * documented in the community pilot format doc
 * (https://andrews05.github.io/evstuff/guides/pilotformat.txt) and then
 * encrypt with the real SimpleCrypt, giving fixtures that are independent of
 * the sequential parser under test: if the parser's field order drifts from
 * the documented layout, these tests fail.
 *
 * No real save games are committed to the repo; integration tests read
 * Matthew's local pilots from /Applications/EV Nova when present.
 *
 * Lives in src (not test) so packages/nova's import specs can build the
 * same fixtures through the package's exports.
 */
import {
    GLOBALS_DATA_SIZE,
    MAC_PLAYER_DATA_SIZE,
    PLT_PLAYER_DATA_SIZE,
} from "./pilot_parse.js";
import { simpleCrypt } from "./simple_crypt.js";

/** The values the builders below write, for tests to assert against. */
export const SYNTHETIC = {
    lastStellar: 10,
    shipClass: 204,
    cargo: [1, 2, 3, 4, 5, 6],
    fuel: 700,
    month: 2,
    day: 13,
    year: 1183,
    exploredSystem: 5,      // exploration[5] = 2
    outfitIndex: 36,        // outfitCount[36] = 3
    legalSystem: 7,         // legalStatus[7] = -20
    weaponIndex: 2,         // weaponCount[2] = 1, ammo[2] = 40
    cash: 91573244,
    missionBit: 42,         // missionBits[42] = true
    dominatedStellar: 5,    // dominated[5] = true
    escortSlot: 2,
    escortClass: 156,       // stored as 1156: hired
    fighterSlot: 0,
    fighterClass: 200,
    rating: 141087,
    // Mission slot 0 (mac builder only).
    missionId: 346,
    missionName: "Take Krane to Earth",
    onAccept: "b1 !b2",
    // Globals.
    versionInfo: 300,
    gender: 1,
    nickname: "Maverick",
    shipColor: { red: 31, green: 15, blue: 7 },
    dateSuffix: " NC",
    rankIndex: 3,           // rankActive[3] = 1
    escortOrders: [1, 0, 2, 0],
};

function makeView(size: number): [Uint8Array, DataView] {
    const bytes = new Uint8Array(size);
    return [bytes, new DataView(bytes.buffer)];
}

function writeAscii(bytes: Uint8Array, at: number, text: string) {
    for (let i = 0; i < text.length; i++) {
        bytes[at + i] = text.charCodeAt(i);
    }
}

/** Writes a pascal string: length byte followed by the characters. */
function writePString(bytes: Uint8Array, at: number, text: string) {
    bytes[at] = text.length;
    writeAscii(bytes, at + 1, text);
}

/**
 * The decrypted globals blob (AltPlayerFileDataStruct) is identical in both
 * formats except for field endianness.
 */
function buildGlobals(littleEndian: boolean): Uint8Array {
    const s = SYNTHETIC;
    const [bytes, dv] = makeView(GLOBALS_DATA_SIZE);
    dv.setInt16(0x0000, s.versionInfo, littleEndian);
    dv.setInt16(0x0002, 0, littleEndian);            // strictPlayFlag
    dv.setInt16(0x0004, s.gender, littleEndian);
    bytes[0x3086] = 1;                               // seenIntroScreen
    for (let i = 0; i < 4; i++) {                    // escortOrders at 0x5d90
        dv.setInt16(0x5d90 + 2 * i, s.escortOrders[i], littleEndian);
    }
    writePString(bytes, 0x5d98, s.nickname);
    dv.setUint16(0x5dd8, s.shipColor.red, littleEndian);
    dv.setUint16(0x5dda, s.shipColor.green, littleEndian);
    dv.setUint16(0x5ddc, s.shipColor.blue, littleEndian);
    dv.setInt16(0x5dde + 2 * s.rankIndex, 1, littleEndian);
    writeAscii(bytes, 0x5eee, s.dateSuffix);         // NUL-terminated by zeros
    return bytes;
}

/** Common (format-independent) head of PlayerFileDataStruct: 0x0 - 0x281e. */
function writePlayerHead(bytes: Uint8Array, dv: DataView, littleEndian: boolean) {
    const s = SYNTHETIC;
    dv.setInt16(0x0000, s.lastStellar, littleEndian);
    dv.setInt16(0x0002, s.shipClass, littleEndian);
    for (let i = 0; i < 6; i++) {
        dv.setInt16(0x0004 + 2 * i, s.cargo[i], littleEndian);
    }
    dv.setInt16(0x0012, s.fuel, littleEndian);
    dv.setInt16(0x0014, s.month, littleEndian);
    dv.setInt16(0x0016, s.day, littleEndian);
    dv.setInt16(0x0018, s.year, littleEndian);
    dv.setInt16(0x001a + 2 * s.exploredSystem, 2, littleEndian);
    dv.setInt16(0x101a + 2 * s.outfitIndex, 3, littleEndian);
    dv.setInt16(0x141a + 2 * s.legalSystem, -20, littleEndian);
    dv.setInt16(0x241a + 2 * s.weaponIndex, 1, littleEndian);
    dv.setInt16(0x261a + 2 * s.weaponIndex, 40, littleEndian);
    dv.setInt32(0x281a, s.cash, littleEndian);
}

/**
 * Builds the decrypted Mac PlayerFileDataStruct, using the absolute offsets
 * from the format doc (including the mission arrays).
 */
function buildMacPlayer(): Uint8Array {
    const s = SYNTHETIC;
    const [bytes, dv] = makeView(MAC_PLAYER_DATA_SIZE);
    writePlayerHead(bytes, dv, false);
    // Mission slot 0 objectives (0x281e) and data (0x295e): offsets are the
    // documented ones for the first mission.
    bytes[0x281e] = 1;                        // active
    bytes[0x281f] = 1;                        // travelObjComplete
    dv.setInt16(0x2824, s.year);              // deadline year
    dv.setInt16(0x2826, s.month);
    dv.setInt16(0x2828, s.day);
    dv.setInt16(0x295e, 12);                  // travelStellar
    dv.setInt16(0x2962, 34);                  // returnStellar
    dv.setInt32(0x2982, 15000);               // pay
    bytes[0x2992] = 1;                        // canAbort
    dv.setInt16(0x29a6, 27);                  // timeLeft
    dv.setInt16(0x29ae, s.missionId);         // missionID
    writeAscii(bytes, 0x2b4d, s.onAccept);    // onAccept (NUL-terminated)
    writePString(bytes, 0x3147, s.missionName);
    // Inactive slots keep zeroed data; fill every escort slot with -1
    // (empty) first, then populate one escort and one fighter.
    for (let slot = 0; slot < 64; slot++) {
        dv.setInt16(0xe72e + 2 * slot, -1);   // escortClass
        dv.setInt16(0xe7ae + 2 * slot, -1);   // fighterClass
        dv.setInt16(0xe92e + 2 * slot, -1);   // escortVoiceMode
    }
    dv.setInt16(0xe72e + 2 * s.escortSlot, 1000 + s.escortClass);
    dv.setInt16(0xe8ae + 2 * s.escortSlot, 1);  // scheduled for sale
    dv.setInt16(0xe92e + 2 * s.escortSlot, 1);  // voiceMode
    dv.setInt16(0xe7ae + 2 * s.fighterSlot, s.fighterClass);
    bytes[0xb81e + s.missionBit] = 1;
    bytes[0xdf2e + s.dominatedStellar] = 1;
    dv.setInt32(0xe9ae, s.rating);
    return bytes;
}

/**
 * Builds the decrypted .plt PlayerFileDataStruct. Each MissionData is 6
 * bytes smaller than on Mac (2278 instead of 2284), so everything after the
 * mission array sits 96 bytes earlier.
 */
function buildPltPlayer(): Uint8Array {
    const s = SYNTHETIC;
    const [bytes, dv] = makeView(PLT_PLAYER_DATA_SIZE);
    writePlayerHead(bytes, dv, true);
    bytes[0x281e] = 1;                        // mission 0 active
    // 0x295e + 16 * 2278 = 47038: start of missionBit[10000].
    const bits = 0x295e + 16 * 2278;
    const dominated = bits + 10000;
    const escortClass = dominated + 2048;
    const fighterClass = escortClass + 128;
    const escortUpgrade = fighterClass + 128;
    const escortSale = escortUpgrade + 128;
    const escortVoice = escortSale + 128;
    const rating = escortVoice + 128;
    bytes[bits + s.missionBit] = 1;
    bytes[dominated + s.dominatedStellar] = 1;
    for (let slot = 0; slot < 64; slot++) {
        dv.setInt16(escortClass + 2 * slot, -1, true);
        dv.setInt16(fighterClass + 2 * slot, -1, true);
        dv.setInt16(escortVoice + 2 * slot, -1, true);
    }
    dv.setInt16(escortClass + 2 * s.escortSlot, 1000 + s.escortClass, true);
    dv.setInt16(escortSale + 2 * s.escortSlot, 1, true);
    dv.setInt16(escortVoice + 2 * s.escortSlot, 1, true);
    dv.setInt16(fighterClass + 2 * s.fighterSlot, s.fighterClass, true);
    dv.setInt32(rating, s.rating, true);
    return bytes;
}

/** Encrypted NpïL 128 and 129 blobs for a synthetic Mac pilot. */
export function buildMacPilotBlobs(): { player: Uint8Array, globals: Uint8Array } {
    return {
        player: simpleCrypt(buildMacPlayer()),
        globals: simpleCrypt(buildGlobals(false)),
    };
}

/** A complete synthetic Windows-format .plt file. */
export function buildPltPilotFile(shipName: string): Uint8Array {
    const player = simpleCrypt(buildPltPlayer());
    const globals = simpleCrypt(buildGlobals(true));
    const out = new Uint8Array(4 + player.length + 4 + globals.length
        + shipName.length + 1);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, player.length, true);
    out.set(player, 4);
    dv.setUint32(4 + player.length, globals.length, true);
    out.set(globals, 8 + player.length);
    writeAscii(out, 8 + player.length + globals.length, shipName);
    return out;
}
