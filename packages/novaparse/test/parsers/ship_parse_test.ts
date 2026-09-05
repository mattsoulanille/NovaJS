import "jasmine";
import { interfaceGovtId, ShipParse } from "../../src/parsers/ship_parse.js";
import { ShipResource } from "../../src/resource_parsers/ship_resource.js";
import { NovaResources } from "../../src/resource_parsers/resource_holder_base.js";
import { FPS } from "../../src/parsers/constants.js";

/**
 * A hand-made shïp resource with every numeric field zeroed and every
 * reference blank, so a spec can set the one or two fields it is about.
 * Missing graphics/dësc/shän are reported to notFoundFunction (ignored
 * here) and defaulted, exactly as the real parser treats a bare plug-in.
 */
function fakeShip(fields: Partial<ShipResource>): ShipResource {
    return {
        globalID: "nova:128",
        name: "Test Ship",
        prefix: "nova",
        id: 128,
        pictID: 5000,
        descID: 13000,
        cargoSpace: 0, shield: 0, acceleration: 0, speed: 0, turnRate: 0,
        energy: 0, freeSpace: 0, armor: 0, shieldRecharge: 0,
        weapons: [], maxGuns: 0, maxTurrets: 0, techLevel: 0, cost: 0,
        deathDelay: 0, armorRecharge: 0,
        initialExplosion: null, finalExplosion: null,
        finalExplosionSparks: false,
        displayOrder: 0, mass: 0, length: 0, inherentAI: 0, crew: 0,
        strength: 0, inherentGovt: -1, flagsN: 0, podCount: 0, outfits: [],
        energyRecharge: 0, skillVariation: 0, flags2N: 0, contribute: 0n,
        availabilityNCB: "", appearOn: "", onPurchase: "", deionize: 0,
        ionization: 0, keyCarried: -1, require: 0n, buyRandom: 0,
        hireRandom: 0, onCapture: "", onRetire: "", shortName: "",
        commName: "", longName: "", movieFile: "", subtitle: "",
        flags3N: 0, escortUpgradeShip: -1, escortUpgradeCost: 0,
        escortSellValue: 0, escortType: -1,
        idSpace: {
            dësc: {}, bööm: {}, shän: {}, PICT: {}, oütf: {}, wëap: {},
            gövt: {}, shïp: {},
        },
        ...fields,
    } as unknown as ShipResource;
}

async function parse(fields: Partial<ShipResource>) {
    return ShipParse(fakeShip(fields), () => { },
        Promise.resolve({ "nova:128": "nova:5000" }),
        Promise.resolve({}), Promise.resolve({}),
        Promise.resolve({ oütf: {} } as unknown as NovaResources));
}

describe("ShipParse", () => {
    describe("Holds (EVN Bible ~:2346)", () => {
        it("keeps a positive hold as written and allows mass expansions",
            async () => {
                const ship = await parse({ cargoSpace: 100 });
                expect(ship.physics.freeCargo).toBe(100);
                expect(ship.noMassExpansions).toBe(false);
            });

        it("reads a NEGATIVE hold as that many tons with no mass expansions",
            async () => {
                // "a value of -100 would mean 100 tons of hold space but no
                // mass expansions allowed". The Sigma-expansion IDA Frigate
                // is -60; taken literally it could never scoop or trade.
                const ship = await parse({ cargoSpace: -60 });
                expect(ship.physics.freeCargo).toBe(60);
                expect(ship.noMassExpansions).toBe(true);
            });
    });

    describe("FuelRegen and Flags 0x0008 (EVN Bible ~:2517, ~:2554)", () => {
        it("converts FuelRegen for AI use whether or not the flag is set",
            async () => {
                const flagged = await parse({ energyRecharge: 25, flagsN: 0x0008 });
                expect(flagged.physics.energyRecharge).toBe(FPS / 25);
                expect(flagged.playerFuelRegen).toBe(true);

                // arpia:600 JTH Thunderforge: FuelRegen 25, flag clear. The
                // class still regenerates for its AI pilots; the player
                // gate is ship_plugin's job.
                const unflagged = await parse({ energyRecharge: 25, flagsN: 0 });
                expect(unflagged.physics.energyRecharge).toBe(FPS / 25);
                expect(unflagged.playerFuelRegen).toBe(false);
            });

        it("does not confuse 0x0008 with its neighbours", async () => {
            // 0x0004 is the 150% jump-speed bit, 0x0010 the 10%-armor
            // disable bit.
            const jump = await parse({ flagsN: 0x0004 });
            expect(jump.playerFuelRegen).toBe(false);
            expect(jump.physics.jumpSpeedMult).toBe(1.5);
            const disable = await parse({ flagsN: 0x0010 });
            expect(disable.playerFuelRegen).toBe(false);
            expect(disable.disableArmorFraction).toBe(0.10);
        });
    });

    describe("the four NCB strings beside Availability (~:2594-2639)", () => {
        it("carries AppearOn, OnPurchase, OnCapture and OnRetire through",
            async () => {
                const ship = await parse({
                    appearOn: "!b333", onPurchase: "b8888",
                    onCapture: "b1", onRetire: "!b4322",
                });
                expect(ship.appearOn).toBe("!b333");
                expect(ship.onPurchase).toBe("b8888");
                expect(ship.onCapture).toBe("b1");
                expect(ship.onRetire).toBe("!b4322");
            });
    });
});

/**
 * shïp InherentGovt, as the status bar reads it. The EVN Bible gives the
 * field four cases (shïp section):
 *
 *   -1          no inherent combat govt or attributes govt
 *   128-383     inherently of that govt for BOTH combat and attributes
 *   1128-1383   an attributes govt of (id - 1000), no combat govt
 *   2128-2383   a combat govt of (id - 2000), no attributes govt
 *
 * and the gövt Interface rule fires on EITHER association, so all three
 * populated ranges collapse to one government id for status-bar purposes.
 */
describe("interfaceGovtId", () => {
    it("passes through the both-associations range unchanged", () => {
        expect(interfaceGovtId(128)).toBe(128);
        expect(interfaceGovtId(147)).toBe(147);
        expect(interfaceGovtId(383)).toBe(383);
    });

    it("strips the 1000 offset of an attributes-only govt", () => {
        // The encoding most stock player-flyable ships use, e.g. the Fed
        // Viper's 1128 -> gövt 128 (Federation).
        expect(interfaceGovtId(1128)).toBe(128);
        expect(interfaceGovtId(1137)).toBe(137);
        expect(interfaceGovtId(1383)).toBe(383);
    });

    it("strips the 2000 offset of a combat-only govt", () => {
        expect(interfaceGovtId(2128)).toBe(128);
        expect(interfaceGovtId(2383)).toBe(383);
    });

    it("is null when the class has no inherent government", () => {
        expect(interfaceGovtId(-1)).toBeNull();
        expect(interfaceGovtId(0)).toBeNull();
        expect(interfaceGovtId(127)).toBeNull();
    });

    it("is null outside the documented ranges", () => {
        expect(interfaceGovtId(384)).toBeNull();
        expect(interfaceGovtId(1127)).toBeNull();
        expect(interfaceGovtId(3128)).toBeNull();
    });
});
