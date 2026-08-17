/**
 * Integration tests reading real EV Nova pilot files from a local
 * installation at /Applications/EV Nova. Those saves are not committed to
 * the repo, so every spec skips (jasmine `pending`) when the files are
 * absent; synthetic coverage lives in pilot_parse_test.ts.
 *
 * Cross-checks parsed pilots against the stock game data in
 * packages/nova/Nova_Data: the pilot's ship class, last stellar, and active
 * missions must resolve to real resources.
 */
import * as fs from "fs";
import "jasmine";
import * as path from "path";
import { fileURLToPath } from "url";
import { IDSpaceHandler } from "../../src/id_space_handler.js";
import { readPilot } from "../../src/pilot/pilot_read.js";
import { PilotData } from "../../src/pilot/pilot_data.js";
import { NovaResources } from "../../src/resource_parsers/resource_holder_base.js";

const EV_NOVA_DIR = "/Applications/EV Nova";
// A flat Windows-format .plt save and two Mac resource-fork scenario pilots.
const PLT_PILOT = path.join(EV_NOVA_DIR, "Pilots/test.plt");
const MAC_PILOT_FED = path.join(EV_NOVA_DIR, "Scenarios/Pilots/Fed");
const MAC_PILOT_AURORAN = path.join(EV_NOVA_DIR, "Scenarios/Pilots/Auroran");

const NOVA_DATA_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    // dist/test/pilot -> packages/nova/Nova_Data
    "../../../../nova/Nova_Data");

function macPilotPresent(p: string): boolean {
    // Mac pilots are empty data-fork files whose content lives in the
    // resource fork xattr.
    return fs.existsSync(path.join(p, "..namedfork/rsrc"));
}

function stockDataPresent(): boolean {
    return fs.existsSync(path.join(NOVA_DATA_PATH, "Nova Files"));
}

function isPrintableAscii(text: string): boolean {
    return /^[\x20-\x7e]+$/.test(text);
}

/** Truths that hold for any well-formed Nova pilot. */
function expectWellFormed(pilot: PilotData, idSpace: NovaResources) {
    const p = pilot.player;
    const systCount =
        Object.keys(idSpace.sÿst).filter(k => k.startsWith("nova:")).length;

    // The player's ship is a real stock resource. (The last-landed stellar
    // is only bounds-checked here: pilots saved under a scenario's plug-in
    // set can reference plugin-only stellars. Observed: the Auroran and
    // Pirate scenario pilots store lastStellar 1872 -> spöb 2000, which is
    // not in the stock data.)
    expect(idSpace.shïp[`nova:${p.shipClass + 128}`]).toBeDefined();
    expect(p.lastStellar).toBeGreaterThanOrEqual(0);
    expect(p.lastStellar).toBeLessThan(2048);

    // Fixed-capacity tables have their documented sizes.
    expect(p.exploration.length).toBe(2048);
    expect(p.legalStatus.length).toBe(2048);
    expect(p.outfitCount.length).toBe(512);
    expect(p.weaponCount.length).toBe(256);
    expect(p.ammo.length).toBe(256);
    expect(p.missionBits.length).toBe(10000);
    expect(p.dominated.length).toBe(2048);
    expect(p.missions.length).toBe(16);

    // The player can't have explored more systems than exist.
    const explored = p.exploration.filter(e => e > 0).length;
    expect(explored).toBeGreaterThan(0);
    expect(explored).toBeLessThanOrEqual(systCount);

    // Sane scalar ranges.
    expect(p.cash).toBeGreaterThanOrEqual(0);
    expect(p.cash).toBeLessThan(2e9);
    expect(p.fuel).toBeGreaterThanOrEqual(0);
    expect(p.fuel).toBeLessThanOrEqual(100_000);
    expect(p.date.year).toBeGreaterThanOrEqual(1177); // Nova starts in 1177.
    expect(p.date.year).toBeLessThan(1500);
    expect(p.date.month).toBeGreaterThanOrEqual(1);
    expect(p.date.month).toBeLessThanOrEqual(12);
    expect(p.date.day).toBeGreaterThanOrEqual(1);
    expect(p.date.day).toBeLessThanOrEqual(31);
    expect(p.rating).toBeGreaterThanOrEqual(0);

    // Every active mission resolves to a stock mïsn whose runtime name
    // matches the resource (the resource name has editor annotations after
    // a ';', e.g. "Take Krane to Earth;Fed43 LAST").
    for (const mission of p.missions) {
        if (!mission.objectives.active) {
            continue;
        }
        const misn = idSpace.mïsn[`nova:${mission.data.missionId + 128}`];
        expect(misn).toBeDefined();
        expect(misn.name.split(';')[0]).toBe(mission.data.missionName);
    }

    // Escorts and deployed fighters are real ships.
    for (const escort of pilot.player.escorts) {
        expect(idSpace.shïp[`nova:${escort.shipClass + 128}`]).toBeDefined();
    }
    for (const fighter of pilot.player.fighters) {
        expect(idSpace.shïp[`nova:${fighter.shipClass + 128}`]).toBeDefined();
    }

    // Strings decode as plain text.
    expect(isPrintableAscii(pilot.shipName)).toBeTrue();
    expect(isPrintableAscii(pilot.globals.nickname)).toBeTrue();
    expect(pilot.globals.versionInfo).toBe(300);
    expect(pilot.globals.dateSuffix).toContain("NC");
}

describe("readPilot on real EV Nova saves", () => {
    let idSpace: NovaResources | undefined;

    beforeAll(async () => {
        if (!stockDataPresent()) {
            return;
        }
        // Base "Nova Files" data ONLY (novaPlugins: null). Pilot parsing only
        // needs the stock idSpace, and on some machines Nova_Data is a symlink
        // to read-only canonical data with no Plug-ins directory — requiring
        // one here would hard-fail the beforeAll instead of letting the specs
        // pending() out when the pilot fixtures are absent. See
        // simulation_test_fixture.ts for the same opt-out.
        idSpace = await new IDSpaceHandler(NOVA_DATA_PATH,
            { novaFiles: "Nova Files", novaPlugins: null }).getIDSpace();
    });

    function requireFixtures(pilotPath: string, mac: boolean):
        NovaResources | undefined {
        const pilotPresent =
            mac ? macPilotPresent(pilotPath) : fs.existsSync(pilotPath);
        if (!pilotPresent || !idSpace) {
            pending(`requires ${pilotPath} and Nova_Data`);
            return undefined;
        }
        return idSpace;
    }

    it("parses a Windows-format .plt save", async () => {
        const space = requireFixtures(PLT_PILOT, false);
        if (!space) return;
        const pilot = await readPilot(PLT_PILOT);
        expect(pilot.format).toBe('plt');
        expectWellFormed(pilot, space);
        // This save was made against stock data, so its last-landed
        // stellar must also resolve.
        expect(space.spöb[`nova:${pilot.player.lastStellar + 128}`])
            .toBeDefined();
    });

    it("parses the stock Fed scenario pilot (Mac resource fork)", async () => {
        const space = requireFixtures(MAC_PILOT_FED, true);
        if (!space) return;
        const pilot = await readPilot(MAC_PILOT_FED);
        expect(pilot.format).toBe('mac');
        expectWellFormed(pilot, space);
        // Pinned truths about this particular save, cross-checked against
        // stock data: the pilot flies a Mod Starbridge (shïp 332).
        expect(pilot.player.shipClass).toBe(204);
        expect(pilot.shipName).toBe("Mod Starbridge 732");
        expect(space.shïp["nova:332"].name.split(';')[0])
            .toBe("Mod Starbridge");
        // Landed at New England (spöb 138).
        expect(pilot.player.lastStellar).toBe(10);
        expect(space.spöb["nova:138"].name).toBe("New England");
        expect(pilot.globals.nickname).toBe("Maverick");
        expect(pilot.player.date).toEqual({ year: 1183, month: 2, day: 13 });
    });

    it("parses the stock Auroran scenario pilot (Mac resource fork)", async () => {
        const space = requireFixtures(MAC_PILOT_AURORAN, true);
        if (!space) return;
        const pilot = await readPilot(MAC_PILOT_AURORAN);
        expect(pilot.format).toBe('mac');
        expectWellFormed(pilot, space);
        // An Aurora Carrier (shïp 295) with fighters deployed.
        expect(pilot.player.shipClass).toBe(167);
        expect(space.shïp["nova:295"].name.split(';')[0])
            .toBe("Aurora Carrier");
        expect(pilot.player.fighters.length).toBeGreaterThan(0);
    });
});
