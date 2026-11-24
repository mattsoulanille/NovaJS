import "jasmine";
import { CharResource } from "../../src/resource_parsers/char_resource.js";
import { DescResource } from "../../src/resource_parsers/desc_resource.js";
import { CharParse } from "../../src/parsers/char_parse.js";
import { getEmptyNovaResources, NovaResources } from "../../src/resource_parsers/resource_holder_base.js";
import { ResourceBuilder } from "../resource_parsers/resource_builder.js";

/** Inserts a stub resource that only carries its globalID. */
function stub(idSpace: NovaResources,
    type: "shïp" | "sÿst" | "gövt", id: number) {
    // CharParse only reads globalID from these referenced resources.
    idSpace[type][id] =
        { globalID: `nova:${id}` } as unknown as never;
}

function makeDesc(idSpace: NovaResources, id: number, text: string) {
    const b = new ResourceBuilder();
    for (const ch of text) {
        b.uint8(ch.charCodeAt(0));
    }
    b.uint8(0);
    idSpace.dësc[id] = new DescResource(
        b.resource("dësc", id, `desc ${id}`), idSpace);
}

/** A chär resource with every field set to a distinct value. */
function buildChar(): ResourceBuilder {
    const b = new ResourceBuilder();
    b.int32(50000)                              // startingCredits
        .int16(164)                             // startingShip
        .array([200, 201, -1, -1], v => b.int16(v))   // startingSystems
        .array([128, 129, -1, -1], v => b.int16(v))   // govts
        .array([50, -30, 0, 0], v => b.int16(v))      // statuses
        .int16(42)                              // combatRating
        .array([-1, -1, -1, -1], v => b.int16(v))     // introPicts
        .array([0, 0, 0, 0], v => b.int16(v))         // delays
        .int16(3000)                            // introText
        .string("b13 b14", 0x100)               // onStart
        .uint16(0x0001)                         // flags (default char)
        .int16(15)                              // startingDay
        .int16(6)                               // startingMonth
        .int16(1177)                            // startingYear
        .string("Stardate ", 0x10)              // datePrefix
        .string(" NC", 0x10)                    // dateSuffix
        .skip(0x10);                            // unused
    return b;
}

function parseChar(withCargoNames = false) {
    const idSpace = getEmptyNovaResources();
    stub(idSpace, "shïp", 164);
    stub(idSpace, "sÿst", 200);
    stub(idSpace, "sÿst", 201);
    stub(idSpace, "gövt", 128);
    stub(idSpace, "gövt", 129);
    makeDesc(idSpace, 3000, "Welcome to the galaxy.");
    if (withCargoNames) {
        // STR# 4000: the standard-cargo display names.
        idSpace["STR#"][4000] = {
            strings: ["Food", "Industrial", "Medical Supplies"],
        } as unknown as never;
        // STR# 4001: their lowercase variants.
        idSpace["STR#"][4001] = {
            strings: ["food", "industrial goods", "medical supplies"],
        } as unknown as never;
    }

    const resource = new CharResource(
        buildChar().resource("chär", 128, "Trader"), idSpace);
    resource.globalID = "nova:128";
    resource.prefix = "nova";
    return CharParse(resource, () => { });
}

describe("CharParse", () => {
    it("carries the BaseData fields", async () => {
        const start = await parseChar();
        expect(start.id).toBe("nova:128");
        expect(start.name).toBe("Trader");
    });

    it("projects credits, rating, and the default flag", async () => {
        const start = await parseChar();
        expect(start.credits).toBe(50000);
        expect(start.combatRating).toBe(42);
        expect(start.isDefault).toBe(true);
    });

    it("resolves the starting ship and systems to global ids", async () => {
        const start = await parseChar();
        expect(start.ship).toBe("nova:164");
        expect(start.systems).toEqual(["nova:200", "nova:201"]);
    });

    it("resolves govt statuses to global ids", async () => {
        const start = await parseChar();
        expect(start.govtStatuses).toEqual([
            { govt: "nova:128", status: 50 },
            { govt: "nova:129", status: -30 },
        ]);
    });

    it("projects the starting date and its formatting", async () => {
        const start = await parseChar();
        expect(start.date).toEqual({ day: 15, month: 6, year: 1177 });
        expect(start.datePrefix).toBe("Stardate ");
        expect(start.dateSuffix).toBe(" NC");
    });

    it("resolves the intro text and carries onStart verbatim", async () => {
        const start = await parseChar();
        expect(start.introText).toBe("Welcome to the galaxy.");
        expect(start.onStart).toBe("b13 b14");
    });

    it("resolves the standard cargo names from STR# 4000", async () => {
        const start = await parseChar(true);
        expect(start.cargoNames).toEqual(
            ["Food", "Industrial", "Medical Supplies"]);
    });

    it("resolves the lowercase cargo names from STR# 4001", async () => {
        const start = await parseChar(true);
        expect(start.cargoNamesLower).toEqual(
            ["food", "industrial goods", "medical supplies"]);
    });

    it("leaves cargo names empty when STR# 4000/4001 are absent", async () => {
        const start = await parseChar(false);
        expect(start.cargoNames).toEqual([]);
        expect(start.cargoNamesLower).toEqual([]);
    });
});
