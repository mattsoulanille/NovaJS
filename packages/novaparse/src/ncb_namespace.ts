/**
 * Per-plug-in namespacing of Nova control bits (NCBs).
 *
 * The EVN Bible gives mission scripting ONE global set of 10,000 control
 * bits (b0 - b9999), read and written by little expression languages in
 * mïsns, cröns, oütfs, shïps, sÿsts, dëscs and friends ("A quick word
 * about control bits and scripting in EV Nova"). Plug-ins are written
 * independently of one another, so two plug-ins routinely claim the same
 * bit number for unrelated purposes — one plug-in's "the player has met
 * the smuggler" is another's "the hypergate pass was bought" — and one
 * plug-in's mission silently opens or closes the other's.
 *
 * NovaParse therefore resolves every bit reference in every NCB expression
 * to a PHYSICAL bit number, in the namespace of the plug-in that WROTE the
 * resource holding the expression (BaseResource.writerPrefix — a plug-in
 * that overrides a stock resource still writes it), and rewrites the
 * expression strings in place before any parser sees them, so that
 * everything downstream (the evaluator, availability tests, set strings,
 * dësc conditionals, sÿst visibility, cröns, ...) keeps working unchanged
 * over the physical numbers held in the player's ControlBitsComponent.
 * This is the same shape as flag_namespace.ts, which does it for the
 * Require/Contribute flags:
 *
 *  - The BASE SET is every bit that the stock ("Nova Files") data sets or
 *    tests ANYWHERE — every field in NCB_FIELDS, plus dësc conditionals —
 *    snapshotted before any plug-in loads. Base-set bits keep their stock
 *    number no matter who references them, so a plug-in can deliberately
 *    read or drive stock story state, and a plug-in that owns a stock
 *    mission cannot accidentally fork that mission's own bits.
 *  - Every other (namespace, bit) pair is PRIVATE to the writing plug-in
 *    and gets a fresh physical bit >= FIRST_PRIVATE_PHYSICAL_CONTROL_BIT,
 *    allocated in a fixed order: namespaces in plug-in load order (see
 *    IDSpaceHandler — a sorted, filesystem-independent order), then raw
 *    bit ascending. Same data and load order give the same mapping on
 *    every peer, which the networked simulation relies on.
 *  - Plug-ins that share a Plug-ins SUBDIRECTORY share an id prefix, and
 *    therefore a namespace: that is how two plug-ins that deliberately
 *    share bits are installed together.
 *
 * Only Bxxx terms are bits. The other letters in the two languages
 * (Oxxx outfits, Sxxx/Axxx/Fxxx missions, Gxxx/Dxxx outfits, Kxxx/Lxxx
 * ranks, Mxxx systems, ...) are RESOURCE IDS, resolved by the game under
 * the ordinary id-space rule, and are left untouched here.
 *
 * Saved games persist bits as (namespace, raw bit) pairs, so the mapping
 * is also exported in a JSON-safe shape (ControlBitNamespaces) for the
 * server to hand to the client. Everything here is pure and synchronous
 * so it can be unit tested and so that the mapping is a function of the
 * loaded data alone.
 */

import {
    BASE_CONTROL_BIT_NAMESPACE, ControlBitNamespaceEntry, ControlBitNamespaces,
    FIRST_PRIVATE_PHYSICAL_CONTROL_BIT, MAX_CONTROL_BIT,
} from "novadatainterface/control_bit_namespaces";
import { BaseResource } from "./resource_parsers/nova_resource_base.js";
import { NovaResources } from "./resource_parsers/resource_holder_base.js";

export { BASE_CONTROL_BIT_NAMESPACE, FIRST_PRIVATE_PHYSICAL_CONTROL_BIT, MAX_CONTROL_BIT };

/**
 * The three places a bit reference can be spelled:
 *  - 'test': a boolean test expression (`b1 & (b2 | !b3)`), where a bare
 *    number is a bit too (see nova's ncb.ts parseNCBTest);
 *  - 'set': a set expression (`b1 !b2 ^b3 G142 R(b4 !b5)`), where only
 *    `[!^]?b<digits>` is a bit and every other letter+digits is an id;
 *  - 'desc': dësc text, where a bit appears only as the test of a
 *    `{bXXX "yes" "no"}` conditional block.
 */
export type NCBExpressionKind = "test" | "set" | "desc";

export interface NCBField {
    field: string;
    kind: NCBExpressionKind;
}

/**
 * Every field of every raw resource type that holds an NCB expression, by
 * resource-holder key. This is the exhaustive list of where control bits
 * live in the data (ResForge TMPLs, docs/tmpl/tmpl_offsets.txt: every
 * "(NCB Test)" / "(NCB Set)" field), plus dësc text. The base set is
 * scanned from, and the rewrite applied to, exactly these.
 */
export const NCB_FIELDS: Readonly<Record<string, readonly NCBField[]>> = {
    "chär": [{ field: "onStart", kind: "set" }],
    "crön": [
        { field: "enableOn", kind: "test" },
        { field: "onStart", kind: "set" },
        { field: "onEnd", kind: "set" },
    ],
    "dësc": [{ field: "text", kind: "desc" }],
    "flët": [{ field: "appearOn", kind: "test" }],
    "jünk": [
        { field: "buyOn", kind: "test" },
        { field: "sellOn", kind: "test" },
    ],
    "mïsn": [
        { field: "availBits", kind: "test" },
        { field: "onAccept", kind: "set" },
        { field: "onRefuse", kind: "set" },
        { field: "onSuccess", kind: "set" },
        { field: "onFailure", kind: "set" },
        { field: "onAbort", kind: "set" },
        { field: "onShipDone", kind: "set" },
    ],
    "nëbu": [
        { field: "activeOn", kind: "test" },
        { field: "onExplore", kind: "set" },
    ],
    "öops": [{ field: "activateOn", kind: "test" }],
    "oütf": [
        { field: "availability", kind: "test" },
        { field: "onPurchase", kind: "set" },
        { field: "onSell", kind: "set" },
    ],
    "përs": [{ field: "activeOn", kind: "test" }],
    "shïp": [
        { field: "availabilityNCB", kind: "test" },
        { field: "appearOn", kind: "test" },
        { field: "onPurchase", kind: "set" },
        { field: "onCapture", kind: "set" },
        { field: "onRetire", kind: "set" },
    ],
    "spöb": [
        { field: "onDominate", kind: "set" },
        { field: "onRelease", kind: "set" },
        { field: "onDestroy", kind: "set" },
        { field: "onRegen", kind: "set" },
    ],
    "sÿst": [{ field: "visibility", kind: "test" }],
};

/** One bit reference inside an expression: the digit span and its value. */
export interface ControlBitSpan {
    /** Index of the first digit. */
    start: number;
    /** Index just past the last digit. */
    end: number;
    bit: number;
}

// The token patterns below MIRROR nova's ncb.ts tokenizers (tokenizeTest
// and parseNCBSet) so that this module finds exactly the terms the
// evaluator will read as bits. Where the evaluator would throw (a
// character neither pattern accepts), this scanner skips the character
// and carries on: rewriting a malformed expression is harmless (the
// evaluator rejects it either way), and refusing to would leave a
// half-namespaced string behind if the evaluator ever became more
// tolerant. Case is irrelevant in both languages, per the Bible.
const TEST_TOKEN = /\s+|[()!&|]|([bope]?)(\d+)|g/giy;
const SET_TOKEN = /\s+|([!^]?)b(\d+)|([afsgdmncehklpyuqtx])(\d+)|r\(|\)|[&|]/giy;
// A dësc conditional opens with "{", optional whitespace, an optional "!",
// then the term; only a b-term followed by the first quoted string is a
// bit test (nova's desc_text.ts tryParseConditional).
const DESC_BIT = /\{\s*!?[bB](\d+)(?=\s*")/g;

/** Every bit reference in `expression`, in order of appearance. */
export function findControlBits(expression: string,
    kind: NCBExpressionKind): ControlBitSpan[] {
    const spans: ControlBitSpan[] = [];
    if (kind === "desc") {
        for (const match of expression.matchAll(DESC_BIT)) {
            const digits = match[1];
            const start = match.index! + match[0].length - digits.length;
            spans.push({ start, end: start + digits.length, bit: parseInt(digits, 10) });
        }
        return spans;
    }
    const pattern = kind === "test" ? TEST_TOKEN : SET_TOKEN;
    let index = 0;
    while (index < expression.length) {
        pattern.lastIndex = index;
        const match = pattern.exec(expression);
        if (!match) {
            index++;
            continue;
        }
        index = pattern.lastIndex;
        let digits: string | undefined;
        if (kind === "test") {
            // A bare number is a bit (compatibility rule); so is b<n>.
            const [, letter, number] = match;
            if (number !== undefined && (letter === "" || letter.toLowerCase() === "b")) {
                digits = number;
            }
        } else {
            const [, , number] = match;
            if (number !== undefined) {
                digits = number;
            }
        }
        if (digits !== undefined) {
            const end = index;
            spans.push({ start: end - digits.length, end, bit: parseInt(digits, 10) });
        }
    }
    return spans;
}

/**
 * Rewrites every bit reference in `expression` through `physical`. Only
 * the digits change (and only where the number does), so an expression
 * that maps to itself comes back byte-identical, letter case and all.
 */
export function rewriteControlBits(expression: string, kind: NCBExpressionKind,
    physical: (bit: number) => number): string {
    const spans = findControlBits(expression, kind);
    if (spans.length === 0) {
        return expression;
    }
    let out = "";
    let last = 0;
    for (const { start, end, bit } of spans) {
        const mapped = physical(bit);
        if (mapped === bit) {
            continue;
        }
        out += expression.slice(last, start) + String(mapped);
        last = end;
    }
    return last === 0 ? expression : out + expression.slice(last);
}

/** A resource field holding an NCB expression, and the bits it names. */
export interface ControlBitRef {
    type: string;
    globalID: string;
    namespace: string;
    field: string;
    kind: NCBExpressionKind;
    /** Distinct raw bits referenced, in order of first appearance. */
    bits: number[];
}

/**
 * Every NCB expression field of every resource in `resources` that names
 * at least one bit. A resource whose writerPrefix was never set (only
 * possible for hand-made resources in tests) is skipped.
 */
export function collectControlBitRefs(resources: NovaResources): ControlBitRef[] {
    const refs: ControlBitRef[] = [];
    for (const type of Object.keys(NCB_FIELDS)) {
        const list = (resources as unknown as Record<string, Record<string, BaseResource>>)[type] ?? {};
        for (const id of Object.keys(list)) {
            const resource = list[id];
            const namespace = resource.writerPrefixIfSet;
            if (namespace === null) {
                continue;
            }
            for (const { field, kind } of NCB_FIELDS[type]) {
                const expression = (resource as unknown as Record<string, unknown>)[field];
                if (typeof expression !== "string" || expression.length === 0) {
                    continue;
                }
                const bits: number[] = [];
                for (const { bit } of findControlBits(expression, kind)) {
                    if (!bits.includes(bit)) {
                        bits.push(bit);
                    }
                }
                if (bits.length > 0) {
                    refs.push({ type, globalID: resource.globalID, namespace, field, kind, bits });
                }
            }
        }
    }
    return refs;
}

/**
 * The base set: every in-range bit any resource in `resources` sets or
 * tests. Call it right after the base "Nova Files" have loaded and before
 * any plug-in does — the stock data, and only the stock data, define
 * which bits are shared.
 */
export function scanBaseControlBitSet(resources: NovaResources): Set<number> {
    const bits = new Set<number>();
    for (const ref of collectControlBitRefs(resources)) {
        for (const bit of ref.bits) {
            if (bit <= MAX_CONTROL_BIT) {
                bits.add(bit);
            }
        }
    }
    return bits;
}

/** A private (namespace, raw bit) pair and the physical bit it was given. */
export interface PrivateControlBit {
    bit: number;
    physicalBit: number;
}

export interface ControlBitNamespaceReportEntry {
    namespace: string;
    privateBits: PrivateControlBit[];
}

/** A raw bit number that two or more plug-ins each use privately. */
export interface ControlBitCollision {
    bit: number;
    namespaces: string[];
}

/**
 * A plug-in-private bit that the plug-in tests (in a test expression or a
 * dësc conditional) but never sets, clears or toggles anywhere. Nothing
 * stock can set it either (it is not in the base set), so the test can
 * only ever see it clear. Almost always an authoring bug, or a
 * cross-plug-in dependency that needs the plug-ins to share a namespace
 * (a Plug-ins subdirectory).
 */
export interface TestedNeverSetControlBit {
    namespace: string;
    bit: number;
    physicalBit: number;
    /** "type globalID.field" of each expression testing it. */
    testedBy: string[];
}

export interface ControlBitNamespaceReport {
    baseSet: number[];
    namespaces: ControlBitNamespaceReportEntry[];
    collisions: ControlBitCollision[];
    testedNeverSet: TestedNeverSetControlBit[];
}

/**
 * The resolved mapping. `rewrite` is what the id space handler applies to
 * the raw resources; `data` is the JSON-safe form handed to the client;
 * the rest is for diagnostics and tests.
 */
export interface ControlBitNamespaceMap {
    readonly baseSet: ReadonlySet<number>;
    /** Namespaces with private bits in allocation order, base first. */
    readonly namespaceOrder: readonly string[];
    /** Physical bit of a raw bit as referenced from `namespace`. */
    physicalBit(namespace: string, bit: number): number;
    /** Rewrites an expression referenced from `namespace`. */
    rewrite(namespace: string, kind: NCBExpressionKind, expression: string): string;
    readonly report: ControlBitNamespaceReport;
    readonly data: ControlBitNamespaces;
}

/**
 * Builds the mapping for everything currently loaded.
 *
 * `pluginOrder` is the plug-in load order (prefixes, first appearance);
 * namespaces that appear in the data but not in that list are placed
 * after it sorted by name, so the result is still a pure function of the
 * data. The base namespace never has private bits, whatever the order
 * says.
 */
export function buildControlBitNamespaceMap(
    resources: NovaResources,
    baseSet: ReadonlySet<number>,
    pluginOrder: readonly string[]): ControlBitNamespaceMap {
    return buildControlBitNamespaceMapFrom(
        collectControlBitRefs(resources), baseSet, pluginOrder);
}

export function buildControlBitNamespaceMapFrom(
    refs: readonly ControlBitRef[],
    baseSet: ReadonlySet<number>,
    pluginOrder: readonly string[]): ControlBitNamespaceMap {

    // Private bit usage per namespace, split by role for the diagnostics.
    const used = new Map<string, Set<number>>();
    const setBy = new Map<string, Set<number>>();
    const testedBy = new Map<string, Map<number, string[]>>();
    const getSet = (map: Map<string, Set<number>>, namespace: string) => {
        let bits = map.get(namespace);
        if (!bits) {
            bits = new Set();
            map.set(namespace, bits);
        }
        return bits;
    };

    for (const ref of refs) {
        const { namespace } = ref;
        if (namespace === BASE_CONTROL_BIT_NAMESPACE) {
            // Everything the base data references is, by construction, in
            // the base set (it was snapshotted from exactly this data).
            continue;
        }
        for (const bit of ref.bits) {
            if (baseSet.has(bit) || bit > MAX_CONTROL_BIT) {
                // Base bits are shared; out-of-range bits are left alone
                // for the evaluator to reject as it always has.
                continue;
            }
            getSet(used, namespace).add(bit);
            if (ref.kind === "set") {
                getSet(setBy, namespace).add(bit);
            } else {
                let tests = testedBy.get(namespace);
                if (!tests) {
                    tests = new Map();
                    testedBy.set(namespace, tests);
                }
                let by = tests.get(bit);
                if (!by) {
                    by = [];
                    tests.set(bit, by);
                }
                by.push(ref.type + " " + ref.globalID + "." + ref.field);
            }
        }
    }

    // Allocation order: the given load order (minus the base namespace and
    // duplicates), then any stragglers sorted by name.
    const ordered: string[] = [];
    const seen = new Set<string>([BASE_CONTROL_BIT_NAMESPACE]);
    for (const namespace of pluginOrder) {
        if (!seen.has(namespace)) {
            seen.add(namespace);
            ordered.push(namespace);
        }
    }
    ordered.push(...[...used.keys()].filter(n => !seen.has(n)).sort());

    const physical = new Map<string, Map<number, number>>();
    const namespaces: ControlBitNamespaceReportEntry[] = [];
    let next = FIRST_PRIVATE_PHYSICAL_CONTROL_BIT;
    for (const namespace of ordered) {
        const bits = used.get(namespace);
        if (!bits || bits.size === 0) {
            continue;
        }
        const table = new Map<number, number>();
        const privateBits: PrivateControlBit[] = [];
        for (const bit of [...bits].sort((a, b) => a - b)) {
            table.set(bit, next);
            privateBits.push({ bit, physicalBit: next });
            next++;
        }
        physical.set(namespace, table);
        namespaces.push({ namespace, privateBits });
    }

    // Diagnostics.
    const byBit = new Map<number, string[]>();
    for (const { namespace, privateBits } of namespaces) {
        for (const { bit } of privateBits) {
            let list = byBit.get(bit);
            if (!list) {
                list = [];
                byBit.set(bit, list);
            }
            list.push(namespace);
        }
    }
    const collisions: ControlBitCollision[] = [...byBit.entries()]
        .filter(([, list]) => list.length > 1)
        .sort(([a], [b]) => a - b)
        .map(([bit, list]) => ({ bit, namespaces: list }));

    const testedNeverSet: TestedNeverSetControlBit[] = [];
    for (const { namespace, privateBits } of namespaces) {
        const sets = setBy.get(namespace) ?? new Set<number>();
        const tests = testedBy.get(namespace);
        if (!tests) {
            continue;
        }
        for (const { bit, physicalBit } of privateBits) {
            const by = tests.get(bit);
            if (by && !sets.has(bit)) {
                testedNeverSet.push({ namespace, bit, physicalBit, testedBy: by });
            }
        }
    }

    const sortedBase = [...baseSet].sort((a, b) => a - b);
    const report: ControlBitNamespaceReport = {
        baseSet: sortedBase,
        namespaces,
        collisions,
        testedNeverSet,
    };

    const physicalBit = (namespace: string, bit: number): number => {
        if (baseSet.has(bit) || bit > MAX_CONTROL_BIT
            || namespace === BASE_CONTROL_BIT_NAMESPACE) {
            return bit;
        }
        const found = physical.get(namespace)?.get(bit);
        if (found === undefined) {
            // Every (namespace, bit) that any loaded resource references
            // was allocated above; reaching here means a resource that was
            // not part of the scan (or a namespace mix-up), which would be
            // a nondeterministic-mapping bug if allocated lazily. Fail
            // loudly instead.
            throw new Error("Control bit " + bit + " referenced from namespace '"
                + namespace + "' was never allocated");
        }
        return found;
    };

    const data: ControlBitNamespaces = {
        baseSet: sortedBase,
        namespaces: namespaces.map(({ namespace, privateBits }): ControlBitNamespaceEntry => ({
            namespace,
            bits: privateBits.map(({ bit, physicalBit }) => [bit, physicalBit]),
        })),
        pluginOrder: [...pluginOrder],
    };

    return {
        baseSet,
        namespaceOrder: [BASE_CONTROL_BIT_NAMESPACE, ...namespaces.map(n => n.namespace)],
        physicalBit,
        rewrite: (namespace, kind, expression) =>
            rewriteControlBits(expression, kind, bit => physicalBit(namespace, bit)),
        report,
        data,
    };
}

/**
 * Rewrites, IN PLACE, every NCB expression field of every resource in
 * `resources` (see NCB_FIELDS) into physical bit numbers under `map`.
 * Done once by IDSpaceHandler after the whole data set has loaded and
 * before any parser runs, so parsers and the game only ever see physical
 * numbers. Base-namespace resources map to themselves and are left
 * byte-identical.
 */
export function applyControlBitNamespaces(resources: NovaResources,
    map: ControlBitNamespaceMap): void {
    for (const type of Object.keys(NCB_FIELDS)) {
        const list = (resources as unknown as Record<string, Record<string, BaseResource>>)[type] ?? {};
        for (const id of Object.keys(list)) {
            const resource = list[id];
            const namespace = resource.writerPrefixIfSet;
            if (namespace === null || namespace === BASE_CONTROL_BIT_NAMESPACE) {
                continue;
            }
            const fields = resource as unknown as Record<string, unknown>;
            for (const { field, kind } of NCB_FIELDS[type]) {
                const expression = fields[field];
                if (typeof expression !== "string" || expression.length === 0) {
                    continue;
                }
                const rewritten = map.rewrite(namespace, kind, expression);
                if (rewritten !== expression) {
                    fields[field] = rewritten;
                }
            }
        }
    }
}

/**
 * The human-readable diagnostics for a report, one line per finding, or
 * an empty array when there is nothing to say. Logged once at load by
 * NovaParse so plug-in authors can see which of their bits collided with
 * another plug-in (harmless now, but worth knowing) and which of their
 * tests can never come true.
 */
export function describeControlBitNamespaceReport(
    report: ControlBitNamespaceReport): string[] {
    const lines: string[] = [];
    for (const { bit, namespaces } of report.collisions) {
        lines.push("Control bit b" + bit + " is used privately by plug-ins "
            + namespaces.map(n => "'" + n + "'").join(", ")
            + "; each now has its own bit.");
    }
    for (const { namespace, bit, testedBy } of report.testedNeverSet) {
        lines.push("Plug-in '" + namespace + "' tests control bit b" + bit
            + " which nothing stock or in '" + namespace + "' ever sets"
            + " (always false): " + testedBy.join(", "));
    }
    return lines;
}
