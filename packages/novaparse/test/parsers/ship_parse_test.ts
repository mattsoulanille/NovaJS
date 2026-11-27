import "jasmine";
import { attributesGovtId, interfaceGovtId, ShipParse } from "../../src/parsers/ship_parse.js";
import { ShipResource } from "../../src/resource_parsers/ship_resource.js";
import { NovaResources } from "../../src/resource_parsers/resource_holder_base.js";
import { DEIONIZE_FRAME_RATE, FPS } from "../../src/parsers/constants.js";
import { NovaDataType } from "novadatainterface/nova_data_interface";
import { installedOutfitMass } from "novadatainterface/outfit_data";
import {
    getDefaultShipAIFlags, ShipAICloakFlags, ShipData,
} from "novadatainterface/ship_data";
import { NovaParse } from "../../src/nova_parse.js";
import { STOCK_DATA_MISSING, stockNovaParse } from "../stock_data.js";

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
    it("gives a ship with no dësc an empty description and warns",
        async () => {
            const notFound: string[] = [];
            const ship = await ShipParse(fakeShip({}),
                m => notFound.push(m),
                Promise.resolve({ "nova:128": "nova:5000" }),
                Promise.resolve({}), Promise.resolve({}),
                Promise.resolve({ oütf: {} } as unknown as NovaResources));
            expect(ship.desc).toEqual("");
            expect(notFound).toContain(
                "No matching dësc for shïp of id nova:128");
        });

    describe("Deionize", () => {
        it("reads 100 as one point of ion charge a 1/30 s game frame "
            + "(reference \"The ion charge read directly (E6, the hub's "
            + "item 2), wave 50\")", async () => {
            expect(DEIONIZE_FRAME_RATE).toBe(FPS);
            expect(DEIONIZE_FRAME_RATE).toBe(30);
            const ship = await parse({ deionize: 100 });
            expect(ship.physics.deionize).toBeCloseTo(30, 9);
            // Deionize 1: 0.30 a second, so one 30-point hit drains in
            // 100 s of game time (read 102.9 / 103.0 s on the reference
            // machine's 29.13 Hz tick: 0.2913 a second).
            const one = await parse({ deionize: 1 });
            expect(one.physics.deionize).toBeCloseTo(0.3, 9);
            expect(30 / one.physics.deionize).toBeCloseTo(100, 9);
            expect(30 / one.physics.deionize * 30 / 29.13)
                .toBeCloseTo(103, 0);
        });

        it("reads a ZERO Deionize as 130, not as no drain (reference "
            + "\"Ionization below a full charge (E6 leftover), wave 41\")",
            async () => {
                const zero = await parse({ deionize: 0 });
                expect(zero.physics.deionize).toBeCloseTo(1.3 * 30, 9);
                // A 20-point hit is gone in about half a second (15 of
                // the 30 fps recorded frames).
                expect(20 / zero.physics.deionize * FPS).toBeGreaterThan(12);
                expect(20 / zero.physics.deionize * FPS).toBeLessThan(18);
                const one = await parse({ deionize: 1 });
                expect(one.physics.deionize).toBeCloseTo(0.3, 9);
            });
    });

    it("reads Flags2 0x0004 as untargetable (A13 wave 41)", async () => {
        expect((await parse({ flags2N: 0x0004 })).untargetable).toBe(true);
        expect((await parse({ flags2N: 0x0008 })).untargetable).toBe(false);
    });

    it("reads Flags 0x0400 as hit by planet-type weapons alone (E4 wave 41)",
        async () => {
            expect((await parse({ flagsN: 0x0400 })).vulnerableTo)
                .toEqual(["planetType"]);
            expect((await parse({ flagsN: 0x0400, flags2N: 0x0008 }))
                .vulnerableTo).toEqual(["planetType"]);
            expect((await parse({})).vulnerableTo).toEqual(["normal"]);
        });

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

    describe("Shield (EVN Bible ~:2351)", () => {
        it("keeps a positive shield as written", async () => {
            const ship = await parse({ shield: 500 });
            expect(ship.physics.shield).toBe(500);
        });

        it("reads a NEGATIVE shield as 5 x its absolute value", async () => {
            // Reference "Negative shïp Shield (E1), wave 40": a Shield
            // -100 hull dropped exactly like a Shield 500 one.
            const ship = await parse({ shield: -100 });
            expect(ship.physics.shield).toBe(500);
        });
    });

    describe("Flags3 0x0010 \"Ship ignores gravity\" (EVN Bible ~:2651)", () => {
        it("sets ignoresGravity only with the bit", async () => {
            expect((await parse({ flags3N: 0x0010 })).physics.ignoresGravity)
                .toBeTrue();
            expect((await parse({ flags3N: 0x0020 })).physics.ignoresGravity)
                .toBeFalse();
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

/**
 * The hail traits a class INHERITS from its attributes govt. gövt Flags
 * 0x0400 ("Can't hail ships of this govt") and Flags2 0x0008 ("don't
 * respond with greetings when hailed") each add "if a ship type has an
 * inherent attributes govt which includes this flag, all ships of that type
 * will inherit this property" — and only the 128-383 and 1128-1383
 * InherentGovt ranges name an attributes govt.
 */
describe("attributesGovtId", () => {
    it("reads both-associations and attributes-only ids", () => {
        expect(attributesGovtId(140)).toBe(140);
        // Stock Wraith (Adult) nova:168 is InherentGovt 1138.
        expect(attributesGovtId(1138)).toBe(138);
    });

    it("gives a combat-only govt no attributes govt", () => {
        expect(attributesGovtId(2138)).toBeNull();
        expect(attributesGovtId(-1)).toBeNull();
        expect(attributesGovtId(1127)).toBeNull();
    });
});

describe("ShipParse: hail traits inherited from the attributes govt", () => {
    const silentGovt = { cantBeHailed: true, noDistressMessages: true };
    const chattyGovt = { cantBeHailed: false, noDistressMessages: false };

    async function parseWithGovt(inherentGovt: number,
        govt: { cantBeHailed: boolean, noDistressMessages: boolean }) {
        return parse({
            inherentGovt,
            idSpace: {
                dësc: {}, bööm: {}, shän: {}, PICT: {}, oütf: {}, wëap: {},
                gövt: { 138: { globalID: "nova:138", ...govt } }, shïp: {},
            } as unknown as ShipResource["idSpace"],
        });
    }

    it("inherits both bits through an attributes-only InherentGovt",
        async () => {
            const ship = await parseWithGovt(1138, silentGovt);
            expect(ship.inheritedCantBeHailed).toBe(true);
            expect(ship.inheritedNoGreetings).toBe(true);
        });

    it("inherits them through a both-associations InherentGovt", async () => {
        const ship = await parseWithGovt(138, silentGovt);
        expect(ship.inheritedCantBeHailed).toBe(true);
        expect(ship.inheritedNoGreetings).toBe(true);
    });

    it("inherits nothing through a COMBAT-only InherentGovt", async () => {
        const ship = await parseWithGovt(2138, silentGovt);
        expect(ship.inheritedCantBeHailed).toBe(false);
        expect(ship.inheritedNoGreetings).toBe(false);
    });

    it("inherits nothing from a govt without the bits, or no govt",
        async () => {
            const chatty = await parseWithGovt(1138, chattyGovt);
            expect(chatty.inheritedCantBeHailed).toBe(false);
            expect(chatty.inheritedNoGreetings).toBe(false);
            const none = await parse({ inherentGovt: -1 });
            expect(none.inheritedCantBeHailed).toBe(false);
            expect(none.inheritedNoGreetings).toBe(false);
        });
});

/**
 * gövt InhJam inherited through the hull's ATTRIBUTES govt: the Bible's shïp
 * InherentGovt says that govt is the one used "for inherent jamming ability",
 * and the original jammed 98% of V 100 missiles at a hull whose own
 * InherentGovt named an InhJam1 100 govt (reference_experiments.md, "J wave
 * 7").
 */
describe("ShipParse: jamming inherited from the attributes govt", () => {
    async function parseWithInhJam(inherentGovt: number, inhJam: number[]) {
        return parse({
            inherentGovt,
            idSpace: {
                dësc: {}, bööm: {}, shän: {}, PICT: {}, oütf: {}, wëap: {},
                gövt: { 236: { globalID: "nova:236", inhJam } }, shïp: {},
            } as unknown as ShipResource["idSpace"],
        });
    }

    it("bakes the govt's InhJam1-4 for a both-associations InherentGovt",
        async () => {
            const ship = await parseWithInhJam(236, [100, 20, 5, 0]);
            expect(ship.inheritedJamming).toEqual([100, 20, 5, 0]);
        });

    it("bakes it for an attributes-only InherentGovt (1128-1383)",
        async () => {
            const ship = await parseWithInhJam(1236, [50, 50, 35, 20]);
            expect(ship.inheritedJamming).toEqual([50, 50, 35, 20]);
        });

    it("gives a COMBAT-only InherentGovt (2128-2383) no inherent jamming",
        async () => {
            const ship = await parseWithInhJam(2236, [100, 100, 100, 100]);
            expect(ship.inheritedJamming).toEqual([0, 0, 0, 0]);
        });

    it("gives no govt, or a dangling one, no inherent jamming", async () => {
        expect((await parse({ inherentGovt: -1 })).inheritedJamming)
            .toEqual([0, 0, 0, 0]);
        expect((await parse({ inherentGovt: 300 })).inheritedJamming)
            .toEqual([0, 0, 0, 0]);
    });
});

describe("ShipParse AI hull flags (data only)", () => {
    it("decodes the Flags / Flags2 AI bits to named booleans", async () => {
        const ship = await parse({ flagsN: 0x0060, flags2N: 0x0083 });
        expect(ship.aiFlags.alwaysHasAfterburner).toBe(true);       // 0x0040
        expect(ship.aiFlags.afterburnerAtAdvancedRating).toBe(true); // 0x0020
        expect(ship.aiFlags.swarms).toBe(true);                     // 0x0001
        expect(ship.aiFlags.prefersStandoff).toBe(true);            // 0x0002
        expect(ship.aiFlags.runsAwayWhenOutOfAmmo).toBe(true);      // 0x0080
        expect(Object.values(ship.aiFlags.cloak).some(on => on)).toBe(false);
    });

    it("decodes each Flags2 cloak bit on its own", async () => {
        const bits: Array<[number, keyof ShipAICloakFlags]> = [
            [0x0100, "onBurstReload"],
            [0x0200, "whenRunningAway"],
            [0x0400, "whenHyperspacing"],
            [0x0800, "whenFlyingAround"],
            [0x1000, "untilCloseToTarget"],
            [0x2000, "whenDocking"],
            [0x4000, "whenPreemptivelyAttacked"],
        ];
        for (const [bit, name] of bits) {
            const cloak = (await parse({ flags2N: bit })).aiFlags.cloak;
            expect(Object.entries(cloak).filter(([, on]) => on)
                .map(([key]) => key)).withContext(name).toEqual([name]);
        }
    });

    it("leaves every AI flag off and PodCount 0 for a bare hull", async () => {
        const ship = await parse({});
        expect(ship.aiFlags).toEqual(getDefaultShipAIFlags());
        expect(ship.podCount).toBe(0);
    });

    it("carries PodCount", async () => {
        expect((await parse({ podCount: 10 })).podCount).toBe(10);
    });

    /** A ship whose DefaultItems are the given LOCAL oütf ids. */
    function withDefaultItems(flags3N: number,
        outfits: Array<{ id: number, functions: Array<[string, unknown]> }>) {
        const oütf: Record<number, unknown> = {};
        for (const { id, functions } of outfits) {
            oütf[id] = { globalID: `nova:${id}`, functions };
        }
        return parse({
            flags3N,
            outfits: outfits.map(({ id }) => ({ id, count: 1 })),
            idSpace: {
                dësc: {}, bööm: {}, shän: {}, PICT: {}, oütf, wëap: {},
                gövt: {}, shïp: {},
            } as unknown as ShipResource["idSpace"],
        });
    }

    it("reads Flags3 0x0001 as destroying asteroids", async () => {
        const ai = (await parse({ flags3N: 0x0101 })).aiFlags;
        expect(ai.destroysAsteroids).toBe(true);
        expect(ai.scoopsAsteroidDebris).toBe(false);
        expect(ai.shuttlesBetweenStellars).toBe(false);
    });

    it("makes Flags3 0x0002 with a default mining scoop a miner", async () => {
        const ai = (await withDefaultItems(0x0003, [
            { id: 200, functions: [["shield", 10]] },
            { id: 271, functions: [["mining scoop", true]] },
        ])).aiFlags;
        expect(ai.scoopsAsteroidDebris).toBe(true);
        expect(ai.shuttlesBetweenStellars).toBe(false);
    });

    it("makes Flags3 0x0002 WITHOUT a mining scoop an in-system shuttle",
        async () => {
            const ai = (await withDefaultItems(0x0002, [
                { id: 200, functions: [["shield", 10]] },
            ])).aiFlags;
            expect(ai.scoopsAsteroidDebris).toBe(true);
            expect(ai.shuttlesBetweenStellars).toBe(true);
        });

    it("does not make a scoop-carrying hull without Flags3 0x0002 a shuttle",
        async () => {
            const ai = (await withDefaultItems(0, [
                { id: 271, functions: [["mining scoop", true]] },
            ])).aiFlags;
            expect(ai.scoopsAsteroidDebris).toBe(false);
            expect(ai.shuttlesBetweenStellars).toBe(false);
        });

    describe("over the stock data", () => {
        let np: NovaParse | null;
        let ships: ShipData[];

        beforeAll(async () => {
            np = await stockNovaParse();
            if (!np) {
                return;
            }
            const shipData = np.data[NovaDataType.Ship];
            ships = [];
            for (const id of (await np.ids).Ship) {
                ships.push(await shipData.get(id));
            }
        });

        function idsWhere(test: (ship: ShipData) => boolean): string[] {
            return ships.filter(test).map(ship => ship.id).sort();
        }

        function countWhere(test: (ship: ShipData) => boolean): number {
            return ships.filter(test).length;
        }

        it("finds the miner, the Zephyrs and the shuttles", () => {
            if (!np) {
                pending(STOCK_DATA_MISSING);
                return;
            }
            expect(ships.length).toBe(288);
            expect(idsWhere(s => s.aiFlags.destroysAsteroids))
                .toEqual(["nova:375", "nova:376", "nova:379"]);
            expect(idsWhere(s => s.aiFlags.scoopsAsteroidDebris)).toEqual(
                ["nova:379", "nova:391", "nova:392", "nova:393", "nova:394"]);
            // The Asteroid Miner carries the Asteroid Scoop (oütf 271), so
            // only the four "economy at work" hulls shuttle.
            expect(idsWhere(s => s.aiFlags.shuttlesBetweenStellars)).toEqual(
                ["nova:391", "nova:392", "nova:393", "nova:394"]);
        });

        it("matches the stock counts docs/npc_behavior_gaps.md cites", () => {
            if (!np) {
                pending(STOCK_DATA_MISSING);
                return;
            }
            expect(countWhere(s => s.aiFlags.runsAwayWhenOutOfAmmo)).toBe(278);
            expect(countWhere(s => s.aiFlags.swarms)).toBe(155);
            expect(countWhere(s => s.aiFlags.prefersStandoff)).toBe(142);
            expect(countWhere(s => Object.values(s.aiFlags.cloak)
                .some(on => on))).toBe(45);
            expect(countWhere(s => s.aiFlags.alwaysHasAfterburner)).toBe(67);
            expect(countWhere(s => s.aiFlags.afterburnerAtAdvancedRating))
                .toBe(197);
        });

        it("reads the decorative escape pods", () => {
            if (!np) {
                pending(STOCK_DATA_MISSING);
                return;
            }
            // The Star Liner launches ten; the Viper none.
            expect(ships.find(s => s.id === "nova:134")!.podCount).toBe(10);
            expect(ships.find(s => s.id === "nova:128")!.podCount).toBe(0);
            expect(countWhere(s => s.podCount > 0)).toBe(83);
        });
    });
});

/**
 * shïp FreeMass is "in addition to the space taken up by the ship's stock
 * weapons" (EVN Bible ~:2367): a ship bought new has exactly FreeMass
 * free. physics.freeMass is the EMPTY hull, from which the sim and the
 * outfitter take every outfit aboard at installedOutfitMass, so the parser
 * must add each stock item back at that same tonnage.
 */
describe("ShipParse free mass", () => {
    // A hand-made oütf, as both id spaces hold it.
    function outf(id: number, mass: number, flags = 0) {
        return { globalID: `nova:${id}`, id, mass, flags, functions: [] };
    }
    const scaled = outf(300, 3, 0x0400); // the Pariah's Defense Phaser
    const launcher = outf(301, 40);
    const rounds = outf(302, 1);
    const supply = {
        globalID: "nova:130", guidance: "unguided", ammoType: 2,
        idSpace: { wëap: {} as Record<number, unknown> },
    };
    supply.idSpace.wëap[130] = supply;

    async function freeOnPurchase(mass: number, freeSpace: number) {
        const globalOutfits = {
            "nova:300": scaled, "nova:301": launcher, "nova:302": rounds,
        };
        const ship = await ShipParse(fakeShip({
            mass, freeSpace,
            outfits: [{ id: 300, count: 2 }],
            weapons: [{ id: 130, count: 3, ammo: 75 }],
            idSpace: {
                dësc: {}, bööm: {}, shän: {}, PICT: {}, gövt: {}, shïp: {},
                oütf: { 300: scaled, 301: launcher, 302: rounds },
                wëap: { 130: supply },
            },
        } as unknown as Partial<ShipResource>), () => { },
            Promise.resolve({ "nova:128": "nova:5000" }),
            Promise.resolve({ "nova:130": "nova:301" }),
            Promise.resolve({ "nova:130": "nova:302" }),
            Promise.resolve({ oütf: globalOutfits } as unknown as NovaResources));
        expect(ship.outfits).toEqual(
            { "nova:300": 2, "nova:301": 3, "nova:302": 75 });
        let free = ship.physics.freeMass;
        for (const [id, count] of Object.entries(ship.outfits)) {
            const o = globalOutfits[id as keyof typeof globalOutfits];
            free -= installedOutfitMass({
                physics: { freeMass: o.mass },
                massScalesWithShipMass: (o.flags & 0x0400) > 0,
            }, mass) * count;
        }
        return { empty: ship.physics.freeMass, free };
    }

    it("adds a 0x0400 stock item back at its HULL-SCALED mass", async () => {
        // The Singularity plug-in's Pariah: Mass 6000, FreeMass 180, two
        // Mass-3 Defense Phasers that weigh floor(6000 x 3 / 100) = 180 t
        // each aboard it. Adding back the written 3 t left it 354 t short:
        // -174 t free in a new ship.
        const { empty, free } = await freeOnPurchase(6000, 180);
        expect(empty).toBe(180 + 2 * 180 + 3 * 40 + 75 * 1);
        expect(free).toBe(180);
    });

    it("keeps a 0x0400 item's own Mass below hull Mass 100", async () => {
        // max(Mass, floor(hull x Mass / 100)): 3 t on a 50 t hull.
        const { empty, free } = await freeOnPurchase(50, 20);
        expect(empty).toBe(20 + 2 * 3 + 3 * 40 + 75 * 1);
        expect(free).toBe(20);
    });

    it("counts the stock AmmoLoad rounds into the hull too (GUESS)",
        async () => {
            // Unmeasured: whether the original's FreeMass leaves room for
            // the stock rounds. NovaJS reads the Bible's "stock weapons" as
            // the loaded weapons, so a ship bought new shows FreeMass and
            // selling its 75 one-ton rounds frees 75 t.
            const { empty } = await freeOnPurchase(98, 24);
            expect(empty - (2 * 3 + 3 * 40)).toBe(24 + 75);
        });

    describe("over the stock data", () => {
        it("gives every stock hull exactly its FreeMass free when new",
            async () => {
                const np = await stockNovaParse();
                if (!np) {
                    pending(STOCK_DATA_MISSING);
                    return;
                }
                const off: string[] = [];
                for (const id of (await np.ids).Ship) {
                    const ship = await np.data[NovaDataType.Ship].get(id);
                    let free = ship.physics.freeMass;
                    for (const [outfitId, count] of
                        Object.entries(ship.outfits)) {
                        const outfit =
                            await np.data[NovaDataType.Outfit].get(outfitId);
                        free -= installedOutfitMass(outfit,
                            ship.physics.mass) * count;
                    }
                    if (free !== ship.freeSpace) {
                        off.push(`${id} ${free} != ${ship.freeSpace}`);
                    }
                }
                // Before the fix nova:366 (Pegasus; Second-Hand -
                // upgraded, Mass 2000, three stock Carbon Fiber at 20 t
                // each) came out at -57 t instead of 0.
                expect(off).toEqual([]);
            });
    });
});
