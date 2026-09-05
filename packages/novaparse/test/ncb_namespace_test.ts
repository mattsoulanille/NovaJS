import "jasmine";
import {
    applyControlBitNamespaces, BASE_CONTROL_BIT_NAMESPACE,
    buildControlBitNamespaceMapFrom, collectControlBitRefs, ControlBitNamespaceMap,
    ControlBitRef, describeControlBitNamespaceReport, findControlBits,
    FIRST_PRIVATE_PHYSICAL_CONTROL_BIT, NCB_FIELDS, rewriteControlBits,
    scanBaseControlBitSet,
} from "../src/ncb_namespace.js";
import {
    getEmptyNovaResources, NovaResources,
} from "../src/resource_parsers/resource_holder_base.js";

const NOVA = BASE_CONTROL_BIT_NAMESPACE;
const P0 = FIRST_PRIVATE_PHYSICAL_CONTROL_BIT;

function bitsOf(expression: string, kind: "test" | "set" | "desc"): number[] {
    return findControlBits(expression, kind).map(s => s.bit);
}

describe("findControlBits", () => {
    it("reads Bxxx and bare numbers in test expressions, and nothing else", () => {
        expect(bitsOf("b13 & (B15 | !b72)", "test")).toEqual([13, 15, 72]);
        // The bare-number compatibility rule (stock mïsn 428).
        expect(bitsOf("!(b511 | b515) & !((b50 | 467) | b6666)", "test"))
            .toEqual([511, 515, 50, 467, 6666]);
        // Leading zeros (More Blasters CHEAT oütf 536).
        expect(bitsOf("0525", "test")).toEqual([525]);
        // O/E/P terms are ids and counts, G is gender: not bits.
        expect(bitsOf("o142 & e130 & p30 & g & b1", "test")).toEqual([1]);
        expect(bitsOf("", "test")).toEqual([]);
    });

    it("reads only [!^]b<n> in set expressions", () => {
        expect(bitsOf("b1 !b2 ^b3 G142 R(b4 !b5) S200 A201 K147 L148", "set"))
            .toEqual([1, 2, 3, 4, 5]);
        // Stray & separators (Extra Outfits oütf 471) don't matter.
        expect(bitsOf("!b9002 & !b9003 & b9001 G472 D468", "set"))
            .toEqual([9002, 9003, 9001]);
        // A bare number in a set expression is not a bit (the evaluator
        // rejects it).
        expect(bitsOf("b1 42", "set")).toEqual([1]);
    });

    it("reads the b-term of dësc conditionals only", () => {
        expect(bitsOf('You {b212 "did" "did not"} help. {!b7 "x"} {G "he" "she"} '
            + '{P30 "." "!"} b99 {b1 nope}', "desc")).toEqual([212, 7]);
        expect(bitsOf('{ !B44 "y"}', "desc")).toEqual([44]);
    });

    it("skips characters neither language accepts and carries on", () => {
        expect(bitsOf("b1 & z & b2", "test")).toEqual([1, 2]);
        expect(bitsOf("b1 ) b2", "set")).toEqual([1, 2]);
    });

    // The Bible's counted sets: `( [b1 b2 b3] = 2 )`. The set's elements
    // are bits; the constant after `=`, `<` or `>` is a count and must not
    // be read as (and allocated) a bit.
    it("reads the elements of a counted set but not the comparison constant", () => {
        expect(bitsOf("( [b1 b2 b3] = 2 )", "test")).toEqual([1, 2, 3]);
        expect(bitsOf("[b1 b2 b3]<2 & [b4 5] > 1", "test")).toEqual([1, 2, 3, 4, 5]);
        expect(bitsOf("[b7 !b8 (b9 | 10)]", "test")).toEqual([7, 8, 9, 10]);
        // A b-prefixed number after the operator is a bit (the evaluator
        // rejects it, but it is still not a count).
        expect(bitsOf("[b1] = b2", "test")).toEqual([1, 2]);
        // Whitespace between the operator and the count does not matter.
        expect(bitsOf("[b1 b2]=   2", "test")).toEqual([1, 2]);
    });
});

describe("rewriteControlBits", () => {
    const map = (bit: number) => bit === 22 ? P0 : bit === 45 ? P0 + 1 : bit;

    it("changes only the digits of remapped bits, byte-identical otherwise", () => {
        expect(rewriteControlBits("B22 & (b45 | !b3)  ", "test", map))
            .toBe(`B${P0} & (b${P0 + 1} | !b3)  `);
        expect(rewriteControlBits("!b22 & G22 R(^b45 b1)", "set", map))
            .toBe(`!b${P0} & G22 R(^b${P0 + 1} b1)`);
        expect(rewriteControlBits('a {b22 "y" "n"} {b3 "z"}', "desc", map))
            .toBe(`a {b${P0} "y" "n"} {b3 "z"}`);
        // A bare number stays bare.
        expect(rewriteControlBits("22 | 3", "test", map)).toBe(`${P0} | 3`);
        // In a counted set the elements are renamed; the count is not,
        // even when it happens to equal a renamed bit number.
        expect(rewriteControlBits("( [b22 b45 3] = 22 )", "test", map))
            .toBe(`( [b${P0} b${P0 + 1} 3] = 22 )`);
    });

    it("returns the very same string when nothing changes", () => {
        const s = "b1 & b3 & 0525";
        expect(rewriteControlBits(s, "test", map)).toBe(s);
        expect(rewriteControlBits("", "set", map)).toBe("");
    });

    it("leaves the sÿst ids of Exxx and Xxxx alone, like Sxxx and Gxxx",
        () => {
            // `Exxx` ("has the player explored system xxx") and `Xxxx`
            // ("make system xxx be explored") name sÿst RESOURCE IDS, not
            // control bits: the game resolves them under the ordinary
            // id-space rule (stock first, then the writing plug-in), so
            // this module must not touch their digits — exactly as it does
            // not touch Sxxx's mïsn id or Gxxx's oütf id.
            //
            // The trap is that the numbers collide with real bit numbers:
            // 22 and 45 are private bits of this namespace, and rewriting
            // E22 to E<physical> would point the operator at some other
            // plug-in's system, or at no system at all.
            const identity = (bit: number) => bit;
            expect(bitsOf("E22 & b22 & !e45", "test")).toEqual([22]);
            expect(rewriteControlBits("E22 & b22 & !e45", "test", map))
                .toBe(`E22 & b${P0} & !e45`);
            expect(bitsOf("X22 b22 x45", "set")).toEqual([22]);
            expect(rewriteControlBits("X22 b22 x45", "set", map))
                .toBe(`X22 b${P0} x45`);
            // ...and an expression made only of them is byte-identical.
            const stock = "b8339 X130";
            expect(rewriteControlBits(stock, "set", identity)).toBe(stock);
            expect(rewriteControlBits("X128", "set", map)).toBe("X128");
            expect(rewriteControlBits("E130 & !E162", "test", map))
                .toBe("E130 & !E162");
        });
});

/** A hand-made raw resource holding the given NCB fields. */
function raw(globalID: string, writerPrefix: string,
    fields: Record<string, string>): any {
    return { globalID, writerPrefixIfSet: writerPrefix, ...fields };
}

describe("collectControlBitRefs / scanBaseControlBitSet", () => {
    it("scans every NCB field of every resource type", () => {
        const resources: NovaResources = getEmptyNovaResources();
        (resources.mïsn as any)["nova:128"] = raw("nova:128", NOVA,
            { availBits: "b1 & !b2", onAccept: "b3", onSuccess: "b4 G100" });
        (resources.crön as any)["nova:129"] = raw("nova:129", NOVA,
            { enableOn: "b5", onStart: "b6", onEnd: "!b7" });
        (resources.dësc as any)["nova:130"] = raw("nova:130", NOVA,
            { text: 'Hi {b8 "a" "b"} O9' });
        (resources.sÿst as any)["nova:131"] = raw("nova:131", NOVA,
            { visibility: "b9" });
        (resources.oütf as any)["nova:132"] = raw("nova:132", NOVA,
            { availability: "", onPurchase: "b10", onSell: "b10000" });
        (resources.shïp as any)["nova:133"] = raw("nova:133", NOVA,
            { availabilityNCB: "b11", appearOn: "b12", onPurchase: "b13",
              onCapture: "b14", onRetire: "b15" });
        (resources.spöb as any)["nova:134"] = raw("nova:134", NOVA,
            { onDominate: "b16", onRelease: "b17", onDestroy: "b18", onRegen: "b19" });
        (resources.përs as any)["nova:135"] = raw("nova:135", NOVA, { activeOn: "b20" });
        (resources.nëbu as any)["nova:136"] = raw("nova:136", NOVA,
            { activeOn: "b21", onExplore: "b22" });
        (resources.flët as any)["nova:137"] = raw("nova:137", NOVA, { appearOn: "b23" });
        (resources.öops as any)["nova:138"] = raw("nova:138", NOVA, { activateOn: "b24" });
        (resources.jünk as any)["nova:139"] = raw("nova:139", NOVA,
            { buyOn: "b25", sellOn: "b26" });
        (resources.chär as any)["nova:140"] = raw("nova:140", NOVA, { onStart: "b27" });
        // A wëap has no NCB fields; a resource with no writer is skipped.
        (resources.wëap as any)["nova:128"] = raw("nova:128", NOVA, { onStart: "b99" });
        (resources.mïsn as any)["nova:141"] = raw("nova:141", null as any,
            { availBits: "b98" });

        const refs = collectControlBitRefs(resources);
        expect(refs.length).toBe(27);
        // Only nonempty fields with a bit in them are refs.
        expect(refs.find(r => r.field === "availability")).toBeUndefined();
        expect([...scanBaseControlBitSet(resources)].sort((a, b) => a - b))
            .toEqual([...Array(27).keys()].map(i => i + 1));
        // b10000 is out of range and never part of the base set.
    });

    it("lists exactly the TMPL's NCB fields", () => {
        // 31 NCB Test/Set fields across 12 types (docs/tmpl/tmpl_offsets.txt),
        // plus dësc text.
        const count = Object.values(NCB_FIELDS).reduce((n, f) => n + f.length, 0);
        expect(count).toBe(32);
        expect(Object.keys(NCB_FIELDS).sort()).toEqual([
            "chär", "crön", "dësc", "flët", "jünk", "mïsn", "nëbu", "öops",
            "oütf", "përs", "shïp", "spöb", "sÿst",
        ].sort());
    });
});

function ref(type: string, globalID: string, namespace: string, field: string,
    kind: "test" | "set" | "desc", bits: number[]): ControlBitRef {
    return { type, globalID, namespace, field, kind, bits };
}

describe("buildControlBitNamespaceMapFrom", () => {
    // Stock: mission 128 tests b100 and sets b101; the base set is {100, 101}.
    const baseRefs = [
        ref("mïsn", "nova:128", NOVA, "availBits", "test", [100]),
        ref("mïsn", "nova:128", NOVA, "onSuccess", "set", [101]),
    ];
    const baseSet = new Set([100, 101]);
    // Two plug-ins that both use b9001 privately; arpia also drives stock
    // b101, tests b2050 which it sets, and tests b2051 which nothing sets.
    const pluginRefs = [
        ref("oütf", "extra-outfits:471", "extra-outfits", "availability", "test", [9001, 9002]),
        ref("oütf", "extra-outfits:471", "extra-outfits", "onPurchase", "set", [9001]),
        ref("mïsn", "arpia:200", "arpia", "availBits", "test", [9001, 2050, 100]),
        ref("mïsn", "arpia:200", "arpia", "onSuccess", "set", [2050, 101]),
        ref("dësc", "arpia:300", "arpia", "text", "desc", [2051]),
        // A stock mission overridden by arpia: its stock bits stay stock.
        ref("mïsn", "nova:428", "arpia", "onFailure", "set", [101, 2050]),
        // Out of range: left alone.
        ref("crön", "arpia:400", "arpia", "onStart", "set", [12000]),
    ];
    const order = ["extra-outfits", "arpia"];

    let map: ControlBitNamespaceMap;
    beforeEach(() => {
        map = buildControlBitNamespaceMapFrom([...baseRefs, ...pluginRefs], baseSet, order);
    });

    it("keeps base-set bits at their stock numbers for everyone", () => {
        expect(map.physicalBit(NOVA, 100)).toBe(100);
        expect(map.physicalBit("arpia", 100)).toBe(100);
        expect(map.physicalBit("arpia", 101)).toBe(101);
        expect(map.physicalBit("extra-outfits", 101)).toBe(101);
    });

    it("gives each plug-in's private bits distinct physical bits in the "
        + "private range, in load order then bit order", () => {
            expect(map.physicalBit("extra-outfits", 9001)).toBe(P0);
            expect(map.physicalBit("extra-outfits", 9002)).toBe(P0 + 1);
            expect(map.physicalBit("arpia", 2050)).toBe(P0 + 2);
            expect(map.physicalBit("arpia", 2051)).toBe(P0 + 3);
            expect(map.physicalBit("arpia", 9001)).toBe(P0 + 4);
            expect(map.namespaceOrder).toEqual([NOVA, "extra-outfits", "arpia"]);
        });

    it("leaves out-of-range bits and the base namespace alone", () => {
        expect(map.physicalBit("arpia", 12000)).toBe(12000);
        expect(map.physicalBit(NOVA, 5)).toBe(5);
    });

    it("rewrites expressions in the writer's namespace", () => {
        expect(map.rewrite("arpia", "test", "b9001 & b2050 & b100"))
            .toBe(`b${P0 + 4} & b${P0 + 2} & b100`);
        expect(map.rewrite("extra-outfits", "set", "!b9001 G472"))
            .toBe(`!b${P0} G472`);
        expect(map.rewrite("arpia", "desc", '{b2051 "a"} {b100 "b"}'))
            .toBe(`{b${P0 + 3} "a"} {b100 "b"}`);
        expect(map.rewrite(NOVA, "test", "b100 & 467")).toBe("b100 & 467");
    });

    it("throws for a (namespace, bit) that no loaded resource referenced", () => {
        expect(() => map.physicalBit("arpia", 50)).toThrowError(/never allocated/);
        expect(() => map.physicalBit("unknown", 9001)).toThrowError(/never allocated/);
    });

    it("reports separated collisions and tested-never-set bits", () => {
        expect(map.report.baseSet).toEqual([100, 101]);
        expect(map.report.collisions).toEqual([
            { bit: 9001, namespaces: ["extra-outfits", "arpia"] },
        ]);
        expect(map.report.testedNeverSet).toEqual([
            {
                namespace: "extra-outfits", bit: 9002, physicalBit: P0 + 1,
                testedBy: ["oütf extra-outfits:471.availability"],
            },
            {
                namespace: "arpia", bit: 2051, physicalBit: P0 + 3,
                testedBy: ["dësc arpia:300.text"],
            },
            {
                namespace: "arpia", bit: 9001, physicalBit: P0 + 4,
                testedBy: ["mïsn arpia:200.availBits"],
            },
        ]);
        const lines = describeControlBitNamespaceReport(map.report);
        expect(lines.length).toBe(4);
        expect(lines[0]).toContain("b9001");
        expect(lines[0]).toContain("'extra-outfits', 'arpia'");
        expect(lines[1]).toContain("b9002");
        expect(describeControlBitNamespaceReport(
            { baseSet: [], namespaces: [], collisions: [], testedNeverSet: [] }))
            .toEqual([]);
    });

    it("exports the JSON-safe mapping with the full plug-in order", () => {
        expect(map.data).toEqual({
            baseSet: [100, 101],
            namespaces: [
                { namespace: "extra-outfits", bits: [[9001, P0], [9002, P0 + 1]] },
                { namespace: "arpia", bits: [[2050, P0 + 2], [2051, P0 + 3], [9001, P0 + 4]] },
            ],
            pluginOrder: ["extra-outfits", "arpia"],
        });
        // The plug-in order lists plug-ins without private bits too.
        const more = buildControlBitNamespaceMapFrom(
            [...baseRefs, ...pluginRefs], baseSet, ["Nuke", ...order]);
        expect(more.data.pluginOrder).toEqual(["Nuke", "extra-outfits", "arpia"]);
        expect(more.data.namespaces.map(n => n.namespace))
            .toEqual(["extra-outfits", "arpia"]);
    });

    it("is a pure function of the data: resource order does not matter, "
        + "namespace order does", () => {
            const shuffled = [...pluginRefs].reverse().concat(baseRefs);
            const again = buildControlBitNamespaceMapFrom(shuffled, baseSet, order);
            expect(again.report).toEqual(map.report);
            expect(again.data).toEqual(map.data);

            const other = buildControlBitNamespaceMapFrom(
                [...baseRefs, ...pluginRefs], baseSet, ["arpia", "extra-outfits"]);
            expect(other.physicalBit("arpia", 2050)).toBe(P0);
            expect(other.physicalBit("extra-outfits", 9001)).toBe(P0 + 3);
        });

    it("orders namespaces missing from the load order after it, by name", () => {
        const partial = buildControlBitNamespaceMapFrom(
            [...baseRefs, ...pluginRefs, ref("mïsn", "zed:1", "zed", "availBits", "test", [1])],
            baseSet, ["arpia"]);
        expect(partial.namespaceOrder).toEqual([NOVA, "arpia", "extra-outfits", "zed"]);
    });
});

describe("applyControlBitNamespaces", () => {
    it("rewrites plug-in resources in place and leaves stock ones untouched", () => {
        const resources: NovaResources = getEmptyNovaResources();
        const stock = raw("nova:128", NOVA, { availBits: "b100 & 467", onAccept: "b101" });
        const plug = raw("arpia:200", "arpia",
            { availBits: "b9001 & b100", onAccept: "b9001 !b101", onRefuse: "" });
        const desc = raw("arpia:300", "arpia", { text: 'x {b9001 "y" "n"}' });
        (resources.mïsn as any)["nova:128"] = stock;
        (resources.mïsn as any)["arpia:200"] = plug;
        (resources.dësc as any)["arpia:300"] = desc;
        const map = buildControlBitNamespaceMapFrom(
            collectControlBitRefs(resources), new Set([100, 101, 467]), ["arpia"]);
        applyControlBitNamespaces(resources, map);
        expect(stock.availBits).toBe("b100 & 467");
        expect(stock.onAccept).toBe("b101");
        expect(plug.availBits).toBe(`b${P0} & b100`);
        expect(plug.onAccept).toBe(`b${P0} !b101`);
        expect(plug.onRefuse).toBe("");
        expect(desc.text).toBe(`x {b${P0} "y" "n"}`);
    });
});
