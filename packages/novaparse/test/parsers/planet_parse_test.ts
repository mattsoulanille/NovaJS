import "jasmine";
import { getDefaultPictData } from "novadatainterface/pict_data";
import { getEmptyNovaResources } from "../../src/resource_parsers/resource_holder_base.js";
import { SpobResource } from "../../src/resource_parsers/spob_resource.js";
import { decodeDefenseCount, PlanetParse } from "../../src/parsers/planet_parse.js";
import { ResourceBuilder } from "../resource_parsers/resource_builder.js";

/**
 * Builds a spöb resource with the given flags2 / hyperlinks / emergence angle
 * (CustSndID) / fee, leaving the other fields at recognizable defaults.
 */
function buildSpob(opts: {
    flags2: number,
    hyperlinks: number[],
    ambientSound: number,
    fee: number,
    type?: number,
    landingPictID?: number,
    animationDelay?: number,
    techLevel?: number,
    /** The eight SpecialTech slots (short lists are padded with -1). */
    specialTech?: number[],
    flags?: number,
    tribute?: number,
    defenseDude?: number,
    defenseCount?: number,
    onDominate?: string,
    onRelease?: string,
    gravity?: number,
    weapon?: number,
    strength?: number,
    deadType?: number,
    deadTime?: number,
    explosion?: number,
    onDestroy?: string,
    onRegen?: string,
}): ResourceBuilder {
    const links = [...opts.hyperlinks];
    while (links.length < 8) {
        links.push(-1);
    }
    const special = [...(opts.specialTech ?? [])];
    while (special.length < 8) {
        special.push(-1);
    }
    const b = new ResourceBuilder();
    b.int16(100).int16(200)                    // position
        .int16(opts.type ?? 30)                // graphic type
        .uint32(opts.flags ?? 0)               // flags
        .int16(opts.tribute ?? 0)              // tribute
        .int16(opts.techLevel ?? 0)            // techLevel
        .array(special.slice(0, 3), v => b.int16(v)) // specialTech (first 3)
        .int16(-1)                             // government
        .int16(0)                              // minStatus
        .int16(opts.landingPictID ?? 0)        // landingPictID (CustPicID)
        .int16(opts.ambientSound)              // ambientSound / emergence angle
        .int16(opts.defenseDude ?? -1)         // defenseDude
        .int16(opts.defenseCount ?? 0)         // defenseCount
        .uint16(opts.flags2)                   // flags2
        .int16(opts.animationDelay ?? 0)       // animationDelay
        .int16(0)                              // frame0Bias
        .array(links, v => b.int16(v))         // hyperlinks
        .string(opts.onDominate ?? "", 0xff)   // onDominate
        .string(opts.onRelease ?? "", 0xff)    // onRelease
        .int32(opts.fee)                       // landingFee
        .int16(opts.gravity ?? 0)              // gravity
        .int16(opts.weapon ?? -1)              // weapon
        .int32(opts.strength ?? 0)             // strength
        .int16(opts.deadType ?? -1)            // deadType
        .int16(opts.deadTime ?? -1)            // deadTime
        .int16(opts.explosion ?? -1)           // explosion
        .string(opts.onDestroy ?? "", 0xff)    // onDestroy
        .string(opts.onRegen ?? "", 0xff)      // onRegen
        .array(special.slice(3), v => b.int16(v)); // specialTech (last 5)
    return b;
}

/**
 * Registers a spöb in the id space with a known global id so hyperlink
 * resolution (spöb local id -> global id) can find it.
 */
function registerSpob(idSpace: ReturnType<typeof getEmptyNovaResources>,
    localId: number, globalID: string) {
    const spob = new SpobResource(
        buildSpob({ flags2: 0, hyperlinks: [], ambientSound: -1, fee: 0 })
            .resource("spöb", localId), idSpace);
    spob.globalID = globalID;
    spob.prefix = "nova";
    idSpace.spöb[localId] = spob;
}

function parse(spob: SpobResource) {
    spob.globalID = "nova:200";
    spob.prefix = "nova";
    return PlanetParse(spob, () => { });
}

describe("PlanetParse gate projection", () => {
    let idSpace: ReturnType<typeof getEmptyNovaResources>;

    beforeEach(() => {
        idSpace = getEmptyNovaResources();
        registerSpob(idSpace, 1401, "nova:1401");
        registerSpob(idSpace, 1411, "nova:1411");
    });

    it("leaves gate null for an ordinary stellar", async () => {
        const spob = new SpobResource(
            buildSpob({ flags2: 0, hyperlinks: [], ambientSound: -1, fee: 0 })
                .resource("spöb", 200), idSpace);
        const planet = await parse(spob);
        expect(planet.gate).toBeNull();
        expect(planet.landingFee).toBe(0);
    });

    it("projects a hypergate with resolved destination global ids", async () => {
        const spob = new SpobResource(
            buildSpob({ flags2: 0x1000, hyperlinks: [1401, 1411], ambientSound: 90, fee: 500 })
                .resource("spöb", 200), idSpace);
        const planet = await parse(spob);
        expect(planet.gate).not.toBeNull();
        expect(planet.gate!.kind).toBe("hypergate");
        expect(planet.gate!.destinations).toEqual(["nova:1401", "nova:1411"]);
        expect(planet.gate!.emergenceAngle).toBe(90);
        expect(planet.landingFee).toBe(500);
    });

    it("projects a wormhole with defined links", async () => {
        const spob = new SpobResource(
            buildSpob({ flags2: 0x2000, hyperlinks: [1401], ambientSound: 0, fee: 0 })
                .resource("spöb", 200), idSpace);
        const planet = await parse(spob);
        expect(planet.gate!.kind).toBe("wormhole");
        expect(planet.gate!.destinations).toEqual(["nova:1401"]);
        expect(planet.gate!.emergenceAngle).toBe(0);
    });

    it("marks a link-less wormhole with an empty destination list (random)", async () => {
        const spob = new SpobResource(
            buildSpob({ flags2: 0x2000, hyperlinks: [], ambientSound: -1, fee: 0 })
                .resource("spöb", 200), idSpace);
        const planet = await parse(spob);
        expect(planet.gate!.kind).toBe("wormhole");
        expect(planet.gate!.destinations).toEqual([]);
        // Any CustSndID outside 0-359 (here -1) => random emergence direction.
        expect(planet.gate!.emergenceAngle).toBeNull();
    });
});

describe("PlanetParse stellar graphic (spïn -> rlëD resolution)", () => {
    let idSpace: ReturnType<typeof getEmptyNovaResources>;
    // The parser reads spïn.spriteID and rlëD.globalID; stub just those.
    const spin = (spriteID: number) => ({ spriteID }) as never;
    const rled = (globalID: string) => ({ globalID }) as never;

    beforeEach(() => {
        idSpace = getEmptyNovaResources();
    });

    function graphicOf(type: number): Promise<string> {
        const spob = new SpobResource(
            buildSpob({
                flags2: type === 59 ? 0x2000 : 0,
                hyperlinks: [], ambientSound: -1, fee: 0, type,
            }).resource("spöb", 200), idSpace);
        return parse(spob).then(p => p.animation.images.baseImage.id);
    }

    it("resolves Type through spïn (1000 + Type), not a linear 2000 + Type",
        async () => {
            // Wormhole: Type 59 -> spïn 1059 -> rlëD 2300 (NOT the linear
            // 2058 the spöb resource approximates). This is the long-standing
            // wormhole-graphic bug.
            idSpace.spïn[1059] = spin(2300);
            idSpace.rlëD[2300] = rled("nova:2300");
            expect(await graphicOf(59)).toBe("nova:2300");
        });

    it("resolves an ordinary planet through spïn (Earth: Type 0 -> rlëD 2000)",
        async () => {
            idSpace.spïn[1000] = spin(2000);
            idSpace.rlëD[2000] = rled("nova:2000");
            expect(await graphicOf(0)).toBe("nova:2000");
        });

    it("honors a spïn that remaps to a shared sprite (Type 33 -> rlëD 2000)",
        async () => {
            // Ring World II reuses rlëD 2000; the linear guess (2033) is a
            // missing sprite. The spïn lookup gets it right.
            idSpace.spïn[1033] = spin(2000);
            idSpace.rlëD[2000] = rled("nova:2000");
            expect(await graphicOf(33)).toBe("nova:2000");
        });

    it("falls back to the linear graphic approximation when no spïn exists",
        async () => {
            // No spïn 1030 registered; falls back to spob.graphic (2030).
            idSpace.rlëD[2030] = rled("nova:2030");
            expect(await graphicOf(30)).toBe("nova:2030");
        });

    it("carries the spöb AnimDelay through to PlanetData.animationDelay",
        async () => {
            const spob = new SpobResource(
                buildSpob({
                    flags2: 0, hyperlinks: [], ambientSound: -1, fee: 0,
                    animationDelay: 7,
                }).resource("spöb", 200), idSpace);
            const planet = await parse(spob);
            expect(planet.animationDelay).toBe(7);
        });
});

describe("PlanetParse spaceport ambient sound (CustSndID)", () => {
    let idSpace: ReturnType<typeof getEmptyNovaResources>;
    const snd = (globalID: string) => ({ globalID }) as never;

    beforeEach(() => {
        idSpace = getEmptyNovaResources();
    });

    it("resolves CustSndID to the ambient snd global id for a normal stellar",
        async () => {
            // Port Kane (spöb nova:137) carries CustSndID 10032 in the stock
            // data; the ambient is the snd resource of that id.
            idSpace["snd "][10032] = snd("nova:10032");
            const spob = new SpobResource(
                buildSpob({
                    flags2: 0, hyperlinks: [], ambientSound: 10032, fee: 0,
                }).resource("spöb", 200), idSpace);
            const planet = await parse(spob);
            expect(planet.spaceportSound).toBe("nova:10032");
        });

    it("leaves spaceportSound null when CustSndID is -1 (no ambient)",
        async () => {
            const spob = new SpobResource(
                buildSpob({ flags2: 0, hyperlinks: [], ambientSound: -1, fee: 0 })
                    .resource("spöb", 200), idSpace);
            const planet = await parse(spob);
            expect(planet.spaceportSound).toBeNull();
        });

    it("never sets spaceportSound for a gate/wormhole (CustSndID is the" +
        " emergence angle there)", async () => {
            // flags2 0x2000 = wormhole; CustSndID 200 is an emergence angle,
            // not a snd id, so it must not become an ambient sound.
            idSpace["snd "][200] = snd("nova:200");
            const spob = new SpobResource(
                buildSpob({ flags2: 0x2000, hyperlinks: [], ambientSound: 200, fee: 0 })
                    .resource("spöb", 200), idSpace);
            const planet = await parse(spob);
            expect(planet.gate).not.toBeNull();
            expect(planet.spaceportSound).toBeNull();
        });
});

describe("PlanetParse landing picture", () => {
    let idSpace: ReturnType<typeof getEmptyNovaResources>;
    const stub = (globalID: string) => ({ globalID }) as never;

    beforeEach(() => {
        idSpace = getEmptyNovaResources();
    });

    it("uses the custom landscape PICT when CustPicID >= 128", async () => {
        idSpace.PICT[11000] = stub("nova:11000");
        idSpace.PICT[10034] = stub("nova:10034");
        const spob = new SpobResource(
            buildSpob({
                flags2: 0, hyperlinks: [], ambientSound: -1, fee: 0,
                type: 34, landingPictID: 11000,
            }).resource("spöb", 200), idSpace);
        const planet = await parse(spob);
        expect(planet.landingPict).toBe("nova:11000");
    });

    it("falls back to the standard landscape PICT (10000 + Type) when" +
        " CustPicID is -1 (regression: New England/Port Kane showed the" +
        " placeholder)", async () => {
        // Port Kane: Type 34, CustPicID -1 => PICT 10034, verified
        // pixel-identical to the original-hardware reference screenshot.
        idSpace.PICT[10034] = stub("nova:10034");
        const spob = new SpobResource(
            buildSpob({
                flags2: 0, hyperlinks: [], ambientSound: -1, fee: 0,
                type: 34, landingPictID: -1,
            }).resource("spöb", 200), idSpace);
        const planet = await parse(spob);
        expect(planet.landingPict).toBe("nova:10034");
    });

    it("warns when an in-range CustPicID does not resolve, then falls back" +
        " to the standard landscape", async () => {
        // CustPicID 11000 IS set (>= 128) but no such PICT exists: a data
        // error. It must be reported, not silently swallowed by the
        // standard-landscape fallback, which still supplies the render.
        const notFound: string[] = [];
        idSpace.PICT[10034] = stub("nova:10034");
        const spob = new SpobResource(
            buildSpob({
                flags2: 0, hyperlinks: [], ambientSound: -1, fee: 0,
                type: 34, landingPictID: 11000,
            }).resource("spöb", 200), idSpace);
        spob.globalID = "nova:200";
        spob.prefix = "nova";
        const planet = await PlanetParse(spob, m => notFound.push(m));
        expect(planet.landingPict).toBe("nova:10034");
        expect(notFound.some(m => m.includes("custom landing PICT")
            && m.includes("11000"))).toBeTrue();
    });

    it("does not warn about a custom landscape when CustPicID is omitted",
        async () => {
            // -1 (reads 65535 through the uint16 field) and any id below 128
            // both mean "no custom landscape" — an expected, silent path.
            for (const landingPictID of [-1, 0, 127]) {
                const notFound: string[] = [];
                idSpace.PICT[10034] = stub("nova:10034");
                const spob = new SpobResource(
                    buildSpob({
                        flags2: 0, hyperlinks: [], ambientSound: -1, fee: 0,
                        type: 34, landingPictID,
                    }).resource("spöb", 200), idSpace);
                spob.globalID = "nova:200";
                spob.prefix = "nova";
                const planet = await PlanetParse(spob, m => notFound.push(m));
                expect(planet.landingPict).toBe("nova:10034");
                expect(notFound.some(m => m.includes("PICT"))).toBeFalse();
            }
        });

    it("keeps the default placeholder when neither a custom nor a standard" +
        " landscape PICT exists (hypergates, unlandable stellars)", async () => {
        const notFound: string[] = [];
        const spob = new SpobResource(
            buildSpob({
                flags2: 0, hyperlinks: [], ambientSound: -1, fee: 0,
                type: 64, landingPictID: -1,
            }).resource("spöb", 200), idSpace);
        spob.globalID = "nova:200";
        spob.prefix = "nova";
        const planet = await PlanetParse(spob, m => notFound.push(m));
        expect(planet.landingPict).toBe(getDefaultPictData().id);
        expect(notFound.some(m => m.includes("PICT"))).toBeTrue();
    });
});

describe("PlanetParse outfitter stock fields", () => {
    let idSpace: ReturnType<typeof getEmptyNovaResources>;

    beforeEach(() => {
        idSpace = getEmptyNovaResources();
    });

    function parseWith(opts: {
        techLevel?: number, specialTech?: number[], flags?: number,
        flags2?: number,
    }) {
        const spob = new SpobResource(
            buildSpob({
                flags2: opts.flags2 ?? 0, hyperlinks: [], ambientSound: -1,
                fee: 0, techLevel: opts.techLevel, specialTech: opts.specialTech,
                flags: opts.flags,
            }).resource("sp\u00f6b", 200), idSpace);
        return parse(spob);
    }

    it("carries the base tech level through", async () => {
        const planet = await parseWith({ techLevel: 6 });
        expect(planet.techLevel).toEqual(6);
    });

    it("reads all eight SpecialTech slots, both storage runs", async () => {
        // Three slots live inline early in the resource and the other five
        // near its end; a parser that only read one run would drop half.
        const planet = await parseWith({
            techLevel: 1,
            specialTech: [101, 102, 103, 201, 202, 203, 204, 205],
        });
        expect(planet.specialTech.sort((a, b) => a - b))
            .toEqual([101, 102, 103, 201, 202, 203, 204, 205]);
    });

    it("drops unset SpecialTech slots", async () => {
        const planet = await parseWith({
            techLevel: 1, specialTech: [-1, 15000, -1, 0, -1, -1, -1, -1],
        });
        expect(planet.specialTech).toEqual([15000]);
    });

    it("leaves specialTech empty for a stellar that uses none", async () => {
        const planet = await parseWith({ techLevel: 3 });
        expect(planet.specialTech).toEqual([]);
    });

    it("decodes the Flags2 0x0400 buys-anything bit", async () => {
        // NOTE: this is a Flags2 bit, not a Flags bit (EVN Bible ~:2862).
        const planet = await parseWith({ flags2: 0x0400 });
        expect(planet.flags.buysAnyOutfit).toBe(true);
    });

    it("leaves buysAnyOutfit false when the bit is clear", async () => {
        const planet = await parseWith({ flags2: 0 });
        expect(planet.flags.buysAnyOutfit).toBe(false);
    });

    it("does not confuse Flags 0x0400 with the Flags2 bit", async () => {
        // 0x0400 in the FIRST flags field is an unrelated (unused-by-us)
        // bit; only the Flags2 one may set buysAnyOutfit.
        const planet = await parseWith({ flags: 0x0400, flags2: 0 });
        expect(planet.flags.buysAnyOutfit).toBe(false);
    });

    it("keeps buysAnyOutfit independent of the gate bits in Flags2",
        async () => {
            const planet = await parseWith({ flags2: 0x0400 | 0x1000 });
            expect(planet.flags.buysAnyOutfit).toBe(true);
            expect(planet.gate!.kind).toBe("hypergate");
        });
});

describe("decodeDefenseCount (spöb DefCount wave encoding)", () => {
    it("reads a DefCount below 1000 as that many ships, all at once", () => {
        expect(decodeDefenseCount(1)).toEqual({ count: 1, waveSize: null });
        expect(decodeDefenseCount(12)).toEqual({ count: 12, waveSize: null });
        expect(decodeDefenseCount(999)).toEqual({ count: 999, waveSize: null });
    });

    it("decodes the Bible's two wave examples", () => {
        // "a value of 1082 would be four waves of two ships for a total of
        // eight. A value of 2005 would create waves of five ships each,
        // with 100 ships total".
        expect(decodeDefenseCount(1082)).toEqual({ count: 8, waveSize: 2 });
        expect(decodeDefenseCount(2005)).toEqual({ count: 100, waveSize: 5 });
    });

    it("decodes the stock DefCounts", () => {
        expect(decodeDefenseCount(2206)).toEqual({ count: 120, waveSize: 6 });
        expect(decodeDefenseCount(3406)).toEqual({ count: 240, waveSize: 6 });
        expect(decodeDefenseCount(7006)).toEqual({ count: 600, waveSize: 6 });
    });

    it("subtracts 1 from the FIRST digit of a five-digit DefCount", () => {
        // 32767 -> "3276" less one leading unit -> 2276 ships, waves of 7:
        // exactly ResForge's documented "max 2276".
        expect(decodeDefenseCount(32767)).toEqual({ count: 2276, waveSize: 7 });
        expect(decodeDefenseCount(12345)).toEqual({ count: 234, waveSize: 5 });
    });

    it("launches a wave-encoded fleet at once when the wave digit is 0", () => {
        expect(decodeDefenseCount(1080)).toEqual({ count: 8, waveSize: null });
    });

    it("decodes no ships for zero, negative and zero-total DefCounts", () => {
        expect(decodeDefenseCount(0)).toBeNull();
        expect(decodeDefenseCount(-1)).toBeNull();
        expect(decodeDefenseCount(1003)).toBeNull();
        expect(decodeDefenseCount(10004)).toBeNull();
    });
});

describe("PlanetParse defence, weapon, domination and destruction (#306)", () => {
    let idSpace: ReturnType<typeof getEmptyNovaResources>;
    const stub = (globalID: string) => ({ globalID }) as never;

    beforeEach(() => {
        idSpace = getEmptyNovaResources();
        idSpace.düde[130] = stub("nova:130");
        idSpace.wëap[196] = stub("nova:196");
        idSpace.bööm[128] = stub("nova:128");
        idSpace.bööm[131] = stub("nova:131");
        idSpace.spïn[1040] = ({ spriteID: 2077 }) as never;
        idSpace.rlëD[2077] = stub("nova:2077");
        idSpace.rlëD[2049] = stub("nova:2049");
        idSpace.rlëD[2099] = stub("nova:2099");
    });

    function parseWith(opts: Partial<Parameters<typeof buildSpob>[0]>) {
        const spob = new SpobResource(
            buildSpob({
                flags2: 0, hyperlinks: [], ambientSound: -1, fee: 0, ...opts,
            }).resource("spöb", 200), idSpace);
        return parse(spob);
    }

    it("projects a wave-launched defence fleet (Earth: düde 130, 7006)",
        async () => {
            const planet = await parseWith({
                defenseDude: 130, defenseCount: 7006,
            });
            expect(planet.defense).toEqual(
                { dude: "nova:130", count: 600, waveSize: 6 });
        });

    it("projects an all-at-once defence fleet", async () => {
        const planet = await parseWith({ defenseDude: 130, defenseCount: 4 });
        expect(planet.defense).toEqual(
            { dude: "nova:130", count: 4, waveSize: null });
    });

    it("has no defence fleet for DefenseDude -1, a no-ship DefCount, or an" +
        " unresolvable düde", async () => {
        expect((await parseWith({ defenseDude: -1, defenseCount: 2206 }))
            .defense).toBeNull();
        expect((await parseWith({ defenseDude: 130, defenseCount: 0 }))
            .defense).toBeNull();
        expect((await parseWith({ defenseDude: 130, defenseCount: -1 }))
            .defense).toBeNull();
        spyOn(console, "warn");
        expect((await parseWith({ defenseDude: 999, defenseCount: 2206 }))
            .defense).toBeNull();
        expect(console.warn).toHaveBeenCalled();
    });

    it("resolves the weapon and its fires-only-when-provoked bit", async () => {
        expect((await parseWith({ weapon: 196 })).weapon)
            .toEqual({ id: "nova:196", firesOnlyWhenProvoked: false });
        expect((await parseWith({ weapon: 196, flags2: 0x0200 })).weapon)
            .toEqual({ id: "nova:196", firesOnlyWhenProvoked: true });
    });

    it("is unarmed for Weapon 0 and -1", async () => {
        expect((await parseWith({ weapon: 0 })).weapon).toBeNull();
        expect((await parseWith({ weapon: -1, flags2: 0x0200 })).weapon)
            .toBeNull();
    });

    it("pays an explicit Tribute as stored", async () => {
        const planet = await parseWith({ tribute: 6000, techLevel: 4 });
        expect(planet.domination.tribute).toBe(6000);
    });

    it("pays the default 1000 x TechLevel for Tribute 0 or -1", async () => {
        expect((await parseWith({ tribute: 0, techLevel: 3 }))
            .domination.tribute).toBe(3000);
        expect((await parseWith({ tribute: -1, techLevel: 5 }))
            .domination.tribute).toBe(5000);
    });

    it("carries the domination flag and NCB hooks", async () => {
        const planet = await parseWith({
            flags2: 0x0020, onDominate: "b6100", onRelease: "!b6100",
        });
        expect(planet.domination).toEqual({
            tribute: 0, alwaysDominated: true,
            onDominate: "b6100", onRelease: "!b6100",
        });
        expect((await parseWith({})).domination.alwaysDominated).toBeFalse();
    });

    it("decodes Strength, with 0 and -1 invincible", async () => {
        expect((await parseWith({ strength: 2500 })).destruction.strength)
            .toBe(2500);
        expect((await parseWith({ strength: 0 })).destruction.strength)
            .toBeNull();
        expect((await parseWith({ strength: -1 })).destruction.strength)
            .toBeNull();
    });

    it("decodes DeadTime: 0 daily, N days, -1 never", async () => {
        expect((await parseWith({ deadTime: 0 }))
            .destruction.regenerationDays).toBe(0);
        expect((await parseWith({ deadTime: 7 }))
            .destruction.regenerationDays).toBe(7);
        expect((await parseWith({ deadTime: -1 }))
            .destruction.regenerationDays).toBeNull();
    });

    it("resolves DeadType through spïn like the live graphic", async () => {
        // spïn 1040 -> rlëD 2077, not the linear 2040.
        expect((await parseWith({ deadType: 40 })).destruction.deadGraphic)
            .toBe("nova:2077");
        // No spïn 1049: the linear approximation (2049).
        expect((await parseWith({ deadType: 49 })).destruction.deadGraphic)
            .toBe("nova:2049");
        // Above the rlëD 2056 gap: Type 100 -> 2099.
        expect((await parseWith({ deadType: 100 })).destruction.deadGraphic)
            .toBe("nova:2099");
        expect((await parseWith({ deadType: -1 })).destruction.deadGraphic)
            .toBeNull();
    });

    it("resolves ExplodType, with and without the +1000 sparks", async () => {
        const plain = (await parseWith({ explosion: 3 })).destruction;
        expect(plain.explosion).toBe("nova:131");
        expect(plain.explosionSparks).toBeNull();
        const sparks = (await parseWith({ explosion: 1003 })).destruction;
        expect(sparks.explosion).toBe("nova:131");
        expect(sparks.explosionSparks).toBe("nova:128");
        const none = (await parseWith({ explosion: -1 })).destruction;
        expect(none.explosion).toBeNull();
        expect(none.explosionSparks).toBeNull();
    });

    it("decodes the destruction Flags2 bits and NCB hooks", async () => {
        const d = (await parseWith({
            flags2: 0x0040 | 0x0080, onDestroy: "b6200", onRegen: "!b6200",
        })).destruction;
        expect(d.startsDestroyed).toBeTrue();
        expect(d.animateOnlyWhenDestroyed).toBeTrue();
        expect(d.onDestroy).toBe("b6200");
        expect(d.onRegen).toBe("!b6200");
        const plain = (await parseWith({})).destruction;
        expect(plain.startsDestroyed).toBeFalse();
        expect(plain.animateOnlyWhenDestroyed).toBeFalse();
    });

    it("decodes the deadly bit and the signed gravity", async () => {
        expect((await parseWith({ flags2: 0x0100 })).deadly).toBeTrue();
        expect((await parseWith({ flags2: 0x0200 })).deadly).toBeFalse();
        expect((await parseWith({ gravity: 25 })).gravity).toBe(25);
        expect((await parseWith({ gravity: -40 })).gravity).toBe(-40);
    });

    it("keeps each Flags2 bit to its own field", async () => {
        // Hypergate + provoked + deadly together must not bleed into the
        // domination or destruction bits.
        const planet = await parseWith({
            flags2: 0x1000 | 0x0200 | 0x0100, weapon: 196,
        });
        expect(planet.gate!.kind).toBe("hypergate");
        expect(planet.weapon!.firesOnlyWhenProvoked).toBeTrue();
        expect(planet.deadly).toBeTrue();
        expect(planet.domination.alwaysDominated).toBeFalse();
        expect(planet.destruction.startsDestroyed).toBeFalse();
        expect(planet.destruction.animateOnlyWhenDestroyed).toBeFalse();
    });

    it("stays JSON-serializable", async () => {
        const planet = await parseWith({
            defenseDude: 130, defenseCount: 2206, weapon: 196,
            explosion: 1003, deadType: 40,
        });
        expect(JSON.parse(JSON.stringify(planet))).toEqual(planet);
    });
});
