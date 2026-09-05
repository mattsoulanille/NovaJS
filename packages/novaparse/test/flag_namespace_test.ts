import "jasmine";
import {
    BASE_NAMESPACE, buildFlagNamespaceMapFrom, describeFlagNamespaceReport,
    FIRST_PRIVATE_PHYSICAL_BIT, flagBits, FlagNamespaceMap, FlagResourceRef,
    resolveResourceFlags, scanBaseFlagSet,
} from "../src/flag_namespace.js";
import { NovaResources } from "../src/resource_parsers/resource_holder_base.js";
import { getEmptyNovaResources } from "../src/resource_parsers/resource_holder_base.js";

/** Bits -> bigint. */
function mask(...bits: number[]): bigint {
    let v = 0n;
    for (const bit of bits) {
        v |= 1n << BigInt(bit);
    }
    return v;
}

function ref(type: string, globalID: string, writerPrefix: string,
    contribute: number[], require: number[]): FlagResourceRef {
    return {
        type,
        resource: {
            globalID, writerPrefix,
            contribute: mask(...contribute), require: mask(...require),
        },
    };
}

/** A mïsn-like ref: Require only. */
function misnRef(globalID: string, writerPrefix: string,
    require: number[]): FlagResourceRef {
    return {
        type: "mïsn",
        resource: { globalID, writerPrefix, require: mask(...require) },
    };
}

describe("flagBits", () => {
    it("lists the 1-bits ascending", () => {
        expect(flagBits(0n)).toEqual([]);
        expect(flagBits(1n)).toEqual([0]);
        expect(flagBits(mask(0, 22, 63))).toEqual([0, 22, 63]);
        // Not limited to 64 bits: remapped values live above 63.
        expect(flagBits(mask(64, 100))).toEqual([64, 100]);
    });
});

describe("scanBaseFlagSet", () => {
    it("takes every contribute and require bit of shïp/oütf/crön/mïsn", () => {
        const resources: NovaResources = getEmptyNovaResources();
        // Only the flag fields matter to the scan; the rest of the resource
        // shape is irrelevant to it, hence the casts.
        (resources.shïp as any)["nova:128"] = { globalID: "nova:128", writerPrefix: "nova", contribute: mask(0, 4), require: 0n };
        (resources.oütf as any)["nova:129"] = { globalID: "nova:129", writerPrefix: "nova", contribute: 0n, require: mask(0, 32) };
        (resources.crön as any)["nova:130"] = { globalID: "nova:130", writerPrefix: "nova", contribute: mask(40), require: mask(41) };
        (resources.mïsn as any)["nova:131"] = { globalID: "nova:131", writerPrefix: "nova", require: mask(5) };
        // A gövt Require (travel permit) is tested against the same player
        // Contribute set, so its bits are part of the base set too.
        (resources.gövt as any)["nova:132"] = { globalID: "nova:132", writerPrefix: "nova", require: mask(7) };
        // A wëap has no flag fields and must be ignored.
        (resources.wëap as any)["nova:128"] = { globalID: "nova:128", writerPrefix: "nova" };
        expect([...scanBaseFlagSet(resources)].sort((a, b) => a - b))
            .toEqual([0, 4, 5, 7, 32, 40, 41]);
    });
});

describe("buildFlagNamespaceMapFrom", () => {
    // Stock: hulls contribute bit 0; a license contributes 32; a blaster
    // requires 0+32. Base set = {0, 32}.
    const baseRefs = [
        ref("shïp", "nova:128", BASE_NAMESPACE, [0], []),
        ref("oütf", "nova:439", BASE_NAMESPACE, [32], []),
        ref("oütf", "nova:129", BASE_NAMESPACE, [], [0, 32]),
    ];
    const baseSet = new Set([0, 32]);

    // Two plug-ins that both use bit 22 privately, plus one that uses
    // stock bit 32 and a private bit 45 it never contributes.
    const pluginRefs = [
        ref("oütf", "Nuke:445", "Nuke", [22, 31], []),
        ref("oütf", "extra-outfits:525", "extra-outfits", [22], []),
        ref("oütf", "extra-outfits:527", "extra-outfits", [], [0, 22]),
        ref("oütf", "extra-outfits:548", "extra-outfits", [], [0, 45]),
        ref("shïp", "arpia:461", "arpia", [0, 32, 8], []),
        misnRef("arpia:200", "arpia", [8]),
    ];
    const order = ["Nuke", "extra-outfits", "arpia"];

    let map: FlagNamespaceMap;
    beforeEach(() => {
        map = buildFlagNamespaceMapFrom([...baseRefs, ...pluginRefs], baseSet, order);
    });

    it("keeps base-set bits at their stock positions for everyone", () => {
        expect(map.physicalBit(BASE_NAMESPACE, 0)).toBe(0);
        expect(map.physicalBit(BASE_NAMESPACE, 32)).toBe(32);
        expect(map.physicalBit("Nuke", 0)).toBe(0);
        expect(map.physicalBit("arpia", 32)).toBe(32);
        expect(map.resolve("extra-outfits", mask(0))).toBe(mask(0));
    });

    it("gives each plug-in's private bits distinct physical bits >= 64, "
        + "in load order then bit order", () => {
            // Nuke first: 22 -> 64, 31 -> 65. Then extra-outfits: 22 -> 66,
            // 45 -> 67. Then arpia: 8 -> 68.
            expect(map.physicalBit("Nuke", 22)).toBe(FIRST_PRIVATE_PHYSICAL_BIT);
            expect(map.physicalBit("Nuke", 31)).toBe(65);
            expect(map.physicalBit("extra-outfits", 22)).toBe(66);
            expect(map.physicalBit("extra-outfits", 45)).toBe(67);
            expect(map.physicalBit("arpia", 8)).toBe(68);
            expect(map.namespaceOrder).toEqual(
                [BASE_NAMESPACE, "Nuke", "extra-outfits", "arpia"]);
        });

    it("resolves whole flag sets so a plug-in Require matches only "
        + "same-plug-in and stock contributions", () => {
            const engineerRequire = map.resolve("extra-outfits", mask(0, 22));
            const nukeContribute = map.resolve("Nuke", mask(22, 31));
            const quartersContribute = map.resolve("extra-outfits", mask(22));
            const hull = map.resolve(BASE_NAMESPACE, mask(0));

            const met = (contribute: bigint) =>
                (engineerRequire & contribute) === engineerRequire;
            expect(met(hull | nukeContribute)).toBe(false);
            expect(met(hull | quartersContribute)).toBe(true);
            expect(met(quartersContribute)).toBe(false); // needs stock bit 0 too
        });

    it("throws for a (namespace, bit) that no loaded resource referenced", () => {
        // Allocating lazily here would make the mapping depend on parse
        // order, so it is a hard error instead.
        expect(() => map.physicalBit("Nuke", 50)).toThrowError(/never allocated/);
        expect(() => map.physicalBit("unknown-plugin", 22)).toThrowError(/never allocated/);
    });

    it("reports separated cross-plug-in collisions and unsatisfiable Requires", () => {
        expect(map.report.baseSet).toEqual([0, 32]);
        expect(map.report.collisions).toEqual([
            { bit: 22, namespaces: ["Nuke", "extra-outfits"] },
        ]);
        expect(map.report.unsatisfiable).toEqual([{
            namespace: "extra-outfits", bit: 45, physicalBit: 67,
            requiredBy: ["oütf extra-outfits:548"],
        }]);
        // arpia's bit 8 is required by its mission and contributed by its
        // ship, so it is satisfiable and not reported.
        const lines = describeFlagNamespaceReport(map.report);
        expect(lines.length).toBe(2);
        expect(lines[0]).toContain("bit 22");
        expect(lines[0]).toContain("'Nuke', 'extra-outfits'");
        expect(lines[1]).toContain("bit 45");
        expect(lines[1]).toContain("extra-outfits:548");
        expect(describeFlagNamespaceReport(
            { baseSet: [], namespaces: [], collisions: [], unsatisfiable: [] }))
            .toEqual([]);
    });

    it("is a pure function of the data: resource order does not matter, "
        + "namespace order does", () => {
            const shuffled = [...pluginRefs].reverse().concat(baseRefs);
            const again = buildFlagNamespaceMapFrom(shuffled, baseSet, order);
            expect(again.report).toEqual(map.report);
            for (const ns of ["Nuke", "extra-outfits", "arpia"]) {
                for (const bit of [0, 8, 22, 31, 32, 45]) {
                    let a: number | null = null, b: number | null = null;
                    try { a = map.physicalBit(ns, bit); } catch { }
                    try { b = again.physicalBit(ns, bit); } catch { }
                    expect(a).withContext(ns + ":" + bit).toBe(b);
                }
            }

            const other = buildFlagNamespaceMapFrom(
                [...baseRefs, ...pluginRefs], baseSet, ["arpia", "extra-outfits", "Nuke"]);
            expect(other.physicalBit("arpia", 8)).toBe(64);
            expect(other.physicalBit("extra-outfits", 22)).toBe(65);
            expect(other.physicalBit("Nuke", 22)).toBe(67);
        });

    it("orders namespaces missing from the load order after it, by name", () => {
        const partial = buildFlagNamespaceMapFrom(
            [...baseRefs, ...pluginRefs], baseSet, ["extra-outfits"]);
        expect(partial.namespaceOrder).toEqual(
            [BASE_NAMESPACE, "extra-outfits", "Nuke", "arpia"]);
    });

    it("never gives the base namespace private bits, whatever it references", () => {
        // A base resource referencing a bit outside the base set cannot
        // happen when the set was snapshotted from the base data, but the
        // builder must not allocate for it either way.
        const odd = buildFlagNamespaceMapFrom(
            [ref("oütf", "nova:500", BASE_NAMESPACE, [], [50])], new Set([0]), []);
        expect(odd.report.namespaces).toEqual([]);
    });
});

describe("resolveResourceFlags", () => {
    it("passes raw bits through when there is no map", () => {
        expect(resolveResourceFlags(null, { writerPrefix: "x" }, mask(0, 22)))
            .toBe(mask(0, 22));
    });

    it("resolves in the resource's writer namespace otherwise", () => {
        const map = buildFlagNamespaceMapFrom(
            [ref("oütf", "p:1", "p", [22], [])], new Set([0]), ["p"]);
        expect(resolveResourceFlags(map, { writerPrefix: "p" }, mask(0, 22)))
            .toBe(mask(0, 64));
    });

    // arpia's Gas Giant gövts 202/203 require bit 7 (not in the stock base
    // set); its Keycard oütf 493 contributes bit 7. The permit only works
    // if both resolve to the SAME physical bit, i.e. the gövt is part of
    // the flag space like everything else that reads the Contribute set.
    it("resolves a plug-in gövt Require to the same bit as the plug-in's "
        + "own Contribute", () => {
            const keycard = ref("oütf", "arpia:493", "arpia", [7], []);
            const gasGiant: FlagResourceRef = {
                type: "gövt",
                resource: { globalID: "arpia:202", writerPrefix: "arpia", require: mask(7) },
            };
            const map = buildFlagNamespaceMapFrom(
                [keycard, gasGiant], new Set([0, 4, 5, 6, 16]), ["arpia"]);
            const require = resolveResourceFlags(map, gasGiant.resource, mask(7));
            const contribute = resolveResourceFlags(map, keycard.resource, mask(7));
            expect(require).toBe(contribute);
            expect(require).toBe(mask(FIRST_PRIVATE_PHYSICAL_BIT));
            expect((require & contribute) === require).toBeTrue();
            // And the gövt's Require is not reported as unsatisfiable.
            expect(map.report.unsatisfiable).toEqual([]);
        });
});
