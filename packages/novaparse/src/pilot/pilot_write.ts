/**
 * Writes EV Nova Mac pilot files: edits a decrypted pilot (normally one the
 * game itself created, so every field we don't touch is a value the
 * original wrote) and re-encrypts it into a resource fork laid out the way
 * the game writes it (NpïL 128 "Pilot Data", NpïL 129 named after the
 * ship, data at offset 256).
 *
 * Used by scripts/novaref (pilot-make) to put a pilot into an exact state
 * for experiments on the original game. Offsets are the absolute ones from
 * the community format doc (see pilot_parse.ts, whose comments carry the
 * same numbers); the spec round-trips every edit through parsePilotResources.
 *
 * Ids in PilotEdits are RESOURCE ids (shïp 128, spöb 128, gövt 128, ...);
 * the file stores indexes (id - 128) and this module does the conversion.
 */
import { buildResourceFork } from "resource_fork/write";
import { ResourceMap } from "resource_fork/parse";
import {
    GLOBALS_DATA_SIZE, MAC_PLAYER_DATA_SIZE, NOVA_PILOT_RESOURCE_TYPE,
} from "./pilot_parse.js";
import { simpleCrypt } from "./simple_crypt.js";

/** The decrypted contents of a Mac pilot. */
export interface DecryptedMacPilot {
    /** NpïL 128, PlayerFileDataStruct (59826 bytes). */
    player: Uint8Array;
    /** NpïL 129, AltPlayerFileDataStruct (26366 bytes). */
    globals: Uint8Array;
    /** The name of NpïL 129: the player's ship name. */
    shipName: string;
}

export interface PilotEscortEdit {
    /** shïp resource id. */
    ship: number;
    /** Hired (stored as 1000 + index) rather than captured. */
    hired?: boolean;
}

export interface PilotEdits {
    /** shïp resource id of the player's ship. */
    ship?: number;
    /** spöb resource id the player is landed on when the pilot loads. */
    stellar?: number;
    credits?: number;
    fuel?: number;
    date?: { year: number, month: number, day: number };
    /** The six standard commodities, tons. */
    cargo?: number[];
    /** oütf resource id -> count. */
    outfits?: { [id: string]: number };
    /** wëap resource id -> count (and optionally ammo). */
    weapons?: { [id: string]: number | { count: number, ammo?: number } };
    /**
     * sÿst resource id -> legal record. EV Nova keeps the record PER SYSTEM
     * (legalStatus[2048]); crimes against a govt change the records of its
     * systems. (NovaJS simplifies to per-govt records.)
     */
    legal?: { [id: string]: number };
    /** Zero every system's legal record first (before `legal` is applied). */
    clearLegal?: boolean;
    /** sÿst resource id -> exploration value (0 unexplored, 1 seen, 2 visited). */
    explored?: { [id: string]: number };
    /** Mark every system visited. */
    exploreAll?: boolean;
    /** Mission bit number -> value. */
    missionBits?: { [bit: string]: boolean };
    /** Clear every mission bit first (before missionBits is applied). */
    clearMissionBits?: boolean;
    /** Deactivate all 16 mission slots. */
    clearMissions?: boolean;
    /** Replaces all escorts. */
    escorts?: PilotEscortEdit[];
    /** Replaces all carried fighters (shïp ids). */
    fighters?: number[];
    rating?: number;
    nickname?: string;
    shipName?: string;
    strictPlay?: boolean;
    /** spöb resource id -> dominated. */
    dominated?: { [id: string]: boolean };
    /** AltPlayerFileDataStruct priceFlux (4 shorts at 0x3588; meaning unknown, see #321). */
    priceFlux?: number[];
    /**
     * spöb resource id -> defence ships remaining (AltPlayerFileDataStruct
     * stellarShipCount, 2048 shorts at 0x0006). The original fills it from
     * each spöb's DefCount when a pilot is CREATED, so a stellar added by a
     * plug-in later reads 0 there ("no fleet left") until it is set
     * (reference "Tribute (R18), wave 39").
     */
    stellarShipCount?: { [id: string]: number };
}

/** Absolute offsets in the decrypted Mac PlayerFileDataStruct. */
export const PLAYER_OFFSETS = {
    lastStellar: 0x0000, shipClass: 0x0002, cargo: 0x0004, fuel: 0x0012,
    month: 0x0014, day: 0x0016, year: 0x0018, exploration: 0x001a,
    outfitCount: 0x101a, legalStatus: 0x141a, weaponCount: 0x241a,
    ammo: 0x261a, cash: 0x281a, objectives: 0x281e, missionBits: 0xb81e,
    dominated: 0xdf2e, escortClass: 0xe72e, fighterClass: 0xe7ae,
    escortUpgrade: 0xe82e, escortSale: 0xe8ae, escortVoiceMode: 0xe92e,
    rating: 0xe9ae,
} as const;

/** Absolute offsets in the decrypted AltPlayerFileDataStruct. */
export const GLOBALS_OFFSETS = { strictPlay: 0x0002, stellarShipCount: 0x0006, priceFlux: 0x3588, nickname: 0x5d98 } as const;

const MISSION_OBJECTIVES_SIZE = 20;

function index(id: string | number, what: string, count: number): number {
    const i = Number(id) - 128;
    if (!Number.isInteger(i) || i < 0 || i >= count) {
        throw new Error(`${what} id ${id} is out of range (128-${127 + count})`);
    }
    return i;
}

function writePString(bytes: Uint8Array, at: number, text: string, capacity: number) {
    if (text.length > capacity) {
        throw new Error(`"${text}" is longer than ${capacity} characters`);
    }
    bytes.fill(0, at, at + 1 + capacity);
    bytes[at] = text.length;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c > 0x7e) throw new Error(`only ASCII is supported in "${text}"`);
        bytes[at + 1 + i] = c;
    }
}

/** Decrypts the two NpïL resources of a parsed Mac pilot resource map. */
export function decryptMacPilot(map: ResourceMap): DecryptedMacPilot {
    const res = map[NOVA_PILOT_RESOURCE_TYPE];
    const player = res?.[128];
    const globals = res?.[129];
    if (!player || !globals) {
        throw new Error(`Not a Nova pilot: missing '${NOVA_PILOT_RESOURCE_TYPE}' 128/129`);
    }
    const bytes = (r: typeof player) => simpleCrypt(
        new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength));
    const out = { player: bytes(player), globals: bytes(globals), shipName: globals.name };
    if (out.player.length !== MAC_PLAYER_DATA_SIZE || out.globals.length !== GLOBALS_DATA_SIZE) {
        throw new Error("Pilot resources have the wrong size for a Mac Nova pilot");
    }
    return out;
}

/** Applies `edits` to a copy of `pilot` and returns the copy. */
export function editMacPilot(pilot: DecryptedMacPilot, edits: PilotEdits): DecryptedMacPilot {
    const player = new Uint8Array(pilot.player);
    const globals = new Uint8Array(pilot.globals);
    const p = new DataView(player.buffer);
    const g = new DataView(globals.buffer);
    const O = PLAYER_OFFSETS;
    const e = edits;

    if (e.ship !== undefined) p.setInt16(O.shipClass, index(e.ship, "shïp", 768));
    if (e.stellar !== undefined) p.setInt16(O.lastStellar, index(e.stellar, "spöb", 2048));
    if (e.credits !== undefined) p.setInt32(O.cash, e.credits);
    if (e.fuel !== undefined) p.setInt16(O.fuel, e.fuel);
    if (e.date) {
        p.setInt16(O.year, e.date.year);
        p.setInt16(O.month, e.date.month);
        p.setInt16(O.day, e.date.day);
    }
    if (e.cargo) {
        if (e.cargo.length !== 6) throw new Error("cargo needs 6 values");
        e.cargo.forEach((v, i) => p.setInt16(O.cargo + 2 * i, v));
    }
    for (const [id, count] of Object.entries(e.outfits ?? {})) {
        p.setInt16(O.outfitCount + 2 * index(id, "oütf", 512), count);
    }
    for (const [id, w] of Object.entries(e.weapons ?? {})) {
        const i = index(id, "wëap", 256);
        const { count, ammo } = typeof w === "number" ? { count: w, ammo: undefined } : w;
        p.setInt16(O.weaponCount + 2 * i, count);
        if (ammo !== undefined) p.setInt16(O.ammo + 2 * i, ammo);
    }
    if (e.clearLegal) player.fill(0, O.legalStatus, O.legalStatus + 2 * 2048);
    for (const [id, rec] of Object.entries(e.legal ?? {})) {
        p.setInt16(O.legalStatus + 2 * index(id, "sÿst", 2048), rec);
    }
    if (e.exploreAll) {
        for (let i = 0; i < 2048; i++) p.setInt16(O.exploration + 2 * i, 2);
    }
    for (const [id, v] of Object.entries(e.explored ?? {})) {
        p.setInt16(O.exploration + 2 * index(id, "sÿst", 2048), v);
    }
    if (e.clearMissionBits) player.fill(0, O.missionBits, O.missionBits + 10000);
    for (const [bit, on] of Object.entries(e.missionBits ?? {})) {
        const b = Number(bit);
        if (!Number.isInteger(b) || b < 0 || b >= 10000) throw new Error(`mission bit ${bit} out of range`);
        player[O.missionBits + b] = on ? 1 : 0;
    }
    if (e.clearMissions) {
        for (let slot = 0; slot < 16; slot++) {
            player[O.objectives + MISSION_OBJECTIVES_SIZE * slot] = 0; // active
        }
    }
    if (e.escorts) {
        if (e.escorts.length > 64) throw new Error("at most 64 escorts");
        for (let slot = 0; slot < 64; slot++) {
            const esc = e.escorts[slot];
            const cls = esc ? index(esc.ship, "shïp", 768) + (esc.hired ? 1000 : 0) : -1;
            p.setInt16(O.escortClass + 2 * slot, cls);
            p.setInt16(O.escortUpgrade + 2 * slot, 0);
            p.setInt16(O.escortSale + 2 * slot, 0);
            p.setInt16(O.escortVoiceMode + 2 * slot, esc ? 0 : -1);
        }
    }
    if (e.fighters) {
        if (e.fighters.length > 64) throw new Error("at most 64 fighters");
        for (let slot = 0; slot < 64; slot++) {
            const f = e.fighters[slot];
            p.setInt16(O.fighterClass + 2 * slot, f === undefined ? -1 : index(f, "shïp", 768));
        }
    }
    for (const [id, on] of Object.entries(e.dominated ?? {})) {
        player[O.dominated + index(id, "spöb", 2048)] = on ? 1 : 0;
    }
    if (e.rating !== undefined) p.setInt32(O.rating, e.rating);
    if (e.nickname !== undefined) writePString(globals, GLOBALS_OFFSETS.nickname, e.nickname, 63);
    if (e.strictPlay !== undefined) g.setInt16(GLOBALS_OFFSETS.strictPlay, e.strictPlay ? 1 : 0);
    for (const [id, n] of Object.entries(e.stellarShipCount ?? {})) {
        g.setInt16(GLOBALS_OFFSETS.stellarShipCount + 2 * index(id, "spöb", 2048), n);
    }
    if (e.priceFlux) {
        if (e.priceFlux.length !== 4) throw new Error("priceFlux needs 4 values");
        e.priceFlux.forEach((v, i) => g.setInt16(GLOBALS_OFFSETS.priceFlux + 2 * i, v));
    }

    const shipName = e.shipName ?? pilot.shipName;
    if (shipName.length > 63) throw new Error("ship name is longer than 63 characters");
    return { player, globals, shipName };
}

/**
 * Encrypts a pilot into resource-fork bytes laid out like the game's own
 * files: NpïL 128 "Pilot Data" then NpïL 129 named after the ship, with the
 * Resource Manager's 256-byte data offset.
 */
export function buildMacPilotFork(pilot: DecryptedMacPilot): Uint8Array {
    return new Uint8Array(buildResourceFork([
        { type: NOVA_PILOT_RESOURCE_TYPE, id: 128, name: "Pilot Data", data: simpleCrypt(pilot.player) },
        { type: NOVA_PILOT_RESOURCE_TYPE, id: 129, name: pilot.shipName, data: simpleCrypt(pilot.globals) },
    ], { dataOffset: 256 }));
}

/**
 * FinderInfo (32 bytes, hex) EV Nova gives its pilot files: type 'NpïL',
 * creator 'Nvä' (MacRoman), the rest zero.
 */
export const PILOT_FINDER_INFO_HEX = "4E70954C4E9A768A" + "00".repeat(24);
