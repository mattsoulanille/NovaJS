import "jasmine";
import { Resource, ResourceMap } from "resource_fork";
import {
    isPltPilot,
    parsePilotResources,
    parsePltPilot,
    PLT_PLAYER_DATA_SIZE,
} from "../../src/pilot/pilot_parse.js";
import { PilotData } from "../../src/pilot/pilot_data.js";
import {
    buildMacPilotBlobs,
    buildPltPilotFile,
    SYNTHETIC,
} from "../../src/pilot/synthetic_pilot.js";

/**
 * The synthetic fixtures write plaintext at the absolute offsets documented
 * in the community format doc and then encrypt with the real SimpleCrypt, so
 * these tests check the sequential parser (and the decryption) against the
 * documented layout rather than against itself.
 */
function expectSyntheticValues(pilot: PilotData) {
    const s = SYNTHETIC;
    const p = pilot.player;
    expect(p.lastStellar).toBe(s.lastStellar);
    expect(p.shipClass).toBe(s.shipClass);
    expect(p.cargo).toEqual(s.cargo);
    expect(p.fuel).toBe(s.fuel);
    expect(p.date).toEqual({ year: s.year, month: s.month, day: s.day });
    expect(p.exploration.length).toBe(2048);
    expect(p.exploration[s.exploredSystem]).toBe(2);
    expect(p.exploration.filter(e => e > 0).length).toBe(1);
    expect(p.outfitCount.length).toBe(512);
    expect(p.outfitCount[s.outfitIndex]).toBe(3);
    expect(p.legalStatus.length).toBe(2048);
    expect(p.legalStatus[s.legalSystem]).toBe(-20);
    expect(p.weaponCount.length).toBe(256);
    expect(p.weaponCount[s.weaponIndex]).toBe(1);
    expect(p.ammo[s.weaponIndex]).toBe(40);
    expect(p.cash).toBe(s.cash);
    expect(p.missions.length).toBe(16);
    expect(p.missions[0].objectives.active).toBeTrue();
    expect(p.missions[1].objectives.active).toBeFalse();
    expect(p.missionBits.length).toBe(10000);
    expect(p.missionBits[s.missionBit]).toBeTrue();
    expect(p.missionBits.filter(b => b).length).toBe(1);
    expect(p.dominated.length).toBe(2048);
    expect(p.dominated[s.dominatedStellar]).toBeTrue();
    expect(p.escorts).toEqual([{
        slot: s.escortSlot,
        shipClass: s.escortClass,
        hired: true,
        scheduledUpgrade: false,
        scheduledSale: true,
        voiceMode: 1,
    }]);
    expect(p.fighters).toEqual([
        { slot: s.fighterSlot, shipClass: s.fighterClass }]);
    expect(p.rating).toBe(s.rating);

    const g = pilot.globals;
    expect(g.versionInfo).toBe(s.versionInfo);
    expect(g.strictPlay).toBeFalse();
    expect(g.gender).toBe(s.gender);
    expect(g.seenIntroScreen).toBeTrue();
    expect(g.escortOrders).toEqual(s.escortOrders);
    expect(g.nickname).toBe(s.nickname);
    expect(g.shipColor).toEqual(s.shipColor);
    expect(g.rankActive[s.rankIndex]).toBe(1);
    expect(g.dateSuffix).toBe(s.dateSuffix);
    expect(g.rawUnknownTail.length).toBe(1024);
    expect(g.rawUnknownTail.every(v => v === 0)).toBeTrue();
}

function toDataView(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

describe("parsePilotResources (Mac format)", () => {
    function makeMap(): ResourceMap {
        const { player, globals } = buildMacPilotBlobs();
        return {
            "NpïL": {
                128: new Resource("NpïL", 128, "Pilot Data",
                    toDataView(player)),
                129: new Resource("NpïL", 129, "Ring of Glory",
                    toDataView(globals)),
            },
        };
    }

    it("decrypts and parses a synthetic Mac pilot", () => {
        const pilot = parsePilotResources(makeMap());
        expect(pilot.format).toBe('mac');
        // The name of resource 129 is the ship's name.
        expect(pilot.shipName).toBe("Ring of Glory");
        expectSyntheticValues(pilot);
    });

    it("parses the Mac-only mission fields", () => {
        const mission = parsePilotResources(makeMap()).player.missions[0];
        expect(mission.objectives.travelObjComplete).toBeTrue();
        expect(mission.objectives.deadline).toEqual(
            { year: SYNTHETIC.year, month: SYNTHETIC.month, day: SYNTHETIC.day });
        expect(mission.data.missionId).toBe(SYNTHETIC.missionId);
        expect(mission.data.missionName).toBe(SYNTHETIC.missionName);
        expect(mission.data.onAccept).toBe(SYNTHETIC.onAccept);
        expect(mission.data.travelStellar).toBe(12);
        expect(mission.data.returnStellar).toBe(34);
        expect(mission.data.pay).toBe(15000);
        expect(mission.data.canAbort).toBeTrue();
        expect(mission.data.timeLeft).toBe(27);
    });

    it("rejects files without the NpïL resources", () => {
        expect(() => parsePilotResources({})).toThrowError(/NpïL/);
    });

    it("rejects EV Classic pilots with a specific error", () => {
        const map: ResourceMap = {
            "MpïL": {
                128: new Resource("MpïL", 128, "", new DataView(
                    new ArrayBuffer(4))),
            },
        };
        expect(() => parsePilotResources(map)).toThrowError(/Classic/);
    });
});

describe("parsePltPilot (Windows format)", () => {
    it("decrypts and parses a synthetic .plt pilot", () => {
        const file = buildPltPilotFile("Ring of Glory");
        expect(isPltPilot(file)).toBeTrue();
        const pilot = parsePltPilot(file);
        expect(pilot.format).toBe('plt');
        // The .plt ship name is the unencrypted trailing string.
        expect(pilot.shipName).toBe("Ring of Glory");
        expectSyntheticValues(pilot);
    });

    it("does not misdetect other data as .plt", () => {
        expect(isPltPilot(new Uint8Array(0))).toBeFalse();
        expect(isPltPilot(new Uint8Array(16))).toBeFalse();
        // Right size prefix but truncated body.
        const truncated = new Uint8Array(12);
        new DataView(truncated.buffer).setUint32(
            0, PLT_PLAYER_DATA_SIZE, true);
        expect(isPltPilot(truncated)).toBeFalse();
        expect(() => parsePltPilot(truncated)).toThrowError(/plt/);
    });
});
