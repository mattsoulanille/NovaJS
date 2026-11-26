import "jasmine";
import { buildResourceFork } from "resource_fork/write";
import { parseResourceFork } from "resource_fork/parse";
import { parsePilotResources } from "../../src/pilot/pilot_parse.js";
import {
    buildMacPilotFork, decryptMacPilot, editMacPilot,
} from "../../src/pilot/pilot_write.js";
import { buildMacPilotBlobs, SYNTHETIC } from "../../src/pilot/synthetic_pilot.js";

/** The synthetic Mac pilot (documented absolute offsets) as a fork. */
function syntheticFork(): ArrayBuffer {
    const { player, globals } = buildMacPilotBlobs();
    return buildResourceFork([
        { type: "NpïL", id: 128, name: "Pilot Data", data: player },
        { type: "NpïL", id: 129, name: "Synthetic Ship", data: globals },
    ]);
}

function reparse(fork: Uint8Array) {
    return parsePilotResources(parseResourceFork(fork.slice().buffer));
}

describe("pilot_write", () => {
    it("round-trips an unedited pilot byte for byte", () => {
        const pilot = decryptMacPilot(parseResourceFork(syntheticFork()));
        const again = decryptMacPilot(parseResourceFork(buildMacPilotFork(pilot).slice().buffer));
        expect(again.player).toEqual(pilot.player);
        expect(again.globals).toEqual(pilot.globals);
        expect(again.shipName).toBe("Synthetic Ship");
    });

    it("lays the fork out like the game: data at 256, NpïL 128 named Pilot Data", () => {
        const pilot = decryptMacPilot(parseResourceFork(syntheticFork()));
        const fork = buildMacPilotFork(pilot);
        expect(new DataView(fork.buffer).getUint32(0)).toBe(256);
        const map = parseResourceFork(fork.slice().buffer);
        expect(map["NpïL"][128].name).toBe("Pilot Data");
        expect(map["NpïL"][128].data.byteLength).toBe(59826);
        expect(map["NpïL"][129].data.byteLength).toBe(26366);
    });

    it("writes every edit where the parser reads it", () => {
        const base = decryptMacPilot(parseResourceFork(syntheticFork()));
        const edited = editMacPilot(base, {
            ship: 800, stellar: 2000, credits: 1234567, fuel: 900,
            date: { year: 1180, month: 3, day: 9 },
            cargo: [1, 0, 0, 0, 0, 7],
            outfits: { 600: 2, 128: 0 },
            weapons: { 300: { count: 2, ammo: 15 }, 129: 1 },
            clearLegal: true,
            legal: { 150: -500, 2000: 250 },
            explored: { 2000: 2 },
            clearMissionBits: true,
            missionBits: { 9999: true, 7: true },
            clearMissions: true,
            escorts: [{ ship: 800, hired: true }, { ship: 130 }],
            fighters: [801],
            rating: 6400,
            nickname: "Probe",
            shipName: "Test Hull",
            strictPlay: true,
            dominated: { 2000: true },
            priceFlux: [3, -2, 1, 0],
            stellarShipCount: { 2000: 6, 128: 600 },
        });
        const parsed = reparse(buildMacPilotFork(edited));
        const p = parsed.player;
        expect(parsed.shipName).toBe("Test Hull");
        expect(p.shipClass).toBe(800 - 128);
        expect(p.lastStellar).toBe(2000 - 128);
        expect(p.cash).toBe(1234567);
        expect(p.fuel).toBe(900);
        expect(p.date).toEqual({ year: 1180, month: 3, day: 9 });
        expect(p.cargo).toEqual([1, 0, 0, 0, 0, 7]);
        expect(p.outfitCount[600 - 128]).toBe(2);
        expect(p.weaponCount[300 - 128]).toBe(2);
        expect(p.ammo[300 - 128]).toBe(15);
        expect(p.weaponCount[1]).toBe(1);
        expect(p.legalStatus[150 - 128]).toBe(-500);
        expect(p.legalStatus[2000 - 128]).toBe(250);
        expect(p.legalStatus.filter(v => v !== 0).length).toBe(2);
        expect(p.exploration[2000 - 128]).toBe(2);
        expect(p.missionBits.filter(b => b).length).toBe(2);
        expect(p.missionBits[9999]).toBeTrue();
        expect(p.missionBits[SYNTHETIC.missionBit]).toBeFalse();
        expect(p.missions.every(m => !m.objectives.active)).toBeTrue();
        expect(p.escorts.map(e => [e.slot, e.shipClass, e.hired])).toEqual(
            [[0, 800 - 128, true], [1, 130 - 128, false]]);
        expect(p.fighters).toEqual([{ slot: 0, shipClass: 801 - 128 }]);
        expect(p.dominated[2000 - 128]).toBeTrue();
        expect(p.rating).toBe(6400);
        expect(parsed.globals.nickname).toBe("Probe");
        expect(parsed.globals.strictPlay).toBeTrue();
        expect(parsed.globals.priceFlux).toEqual([3, -2, 1, 0]);
        expect(parsed.globals.stellarShipCount[2000 - 128]).toBe(6);
        expect(parsed.globals.stellarShipCount[0]).toBe(600);
        // Untouched fields keep the base's values.
        expect(parsed.globals.shipColor).toEqual(SYNTHETIC.shipColor);
    });

    it("leaves the input pilot unchanged", () => {
        const base = decryptMacPilot(parseResourceFork(syntheticFork()));
        const before = base.player.slice();
        editMacPilot(base, { credits: 1 });
        expect(base.player).toEqual(before);
    });

    it("rejects ids outside the pilot's arrays", () => {
        const base = decryptMacPilot(parseResourceFork(syntheticFork()));
        expect(() => editMacPilot(base, { ship: 127 })).toThrowError(/out of range/);
        expect(() => editMacPilot(base, { outfits: { 640: 1 } })).toThrowError(/out of range/);
        expect(() => editMacPilot(base, { missionBits: { 10000: true } })).toThrowError(/out of range/);
    });
});
