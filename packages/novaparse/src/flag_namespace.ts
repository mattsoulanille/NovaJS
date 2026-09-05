/**
 * Per-plug-in namespacing of the Require/Contribute flag space.
 *
 * The EVN Bible gives shïps, oütfs, cröns, mïsns and gövts ONE global
 * 64-bit Contribute/Require flag set: a thing can be bought (a mission
 * offered, a cron run, a government's planet landed on) only when every bit
 * in its Require is present in the OR of the player's hull Contribute,
 * owned-outfit Contributes (and active crons).
 * Plug-ins are written independently of one another, so two plug-ins
 * routinely claim the same bit for unrelated purposes — the Nuke plug-in's
 * missile launcher (Contribute bit 22) unlocked every crew outfit in Extra
 * Outfits (Require bit 22, meant to be gated by its Crew Quarters).
 *
 * NovaParse therefore resolves every flag reference to a PHYSICAL bit in a
 * bigint that may exceed 64 bits, in the namespace of the plug-in that
 * WROTE the resource (BaseResource.writerPrefix — a plug-in that overrides
 * a stock resource still writes it, and so sees its own bits):
 *
 *  - The BASE SET is every bit that any stock ("Nova Files") shïp, oütf,
 *    crön or mïsn contributes or requires, snapshotted before any plug-in
 *    loads. Base-set bits keep their stock positions (0..63) no matter who
 *    references them, so a plug-in can deliberately depend on (or supply)
 *    a stock contribution, and a plug-in owning a stock resource cannot
 *    accidentally fork a stock flag.
 *  - Every other (namespace, bit) pair is PRIVATE to the writing plug-in
 *    and gets a fresh physical bit >= 64, allocated in a fixed order:
 *    namespaces in plug-in load order (see IDSpaceHandler — a sorted,
 *    filesystem-independent order), then raw bit ascending. Same data and
 *    load order give the same mapping on every peer, which the networked
 *    simulation relies on.
 *
 * Downstream, `(require & contribute) === require` over the remapped
 * values is unchanged: a plug-in's Require now matches only same-plug-in
 * and stock contributions. Nothing in the plug-in data is touched, and
 * saved games (which store outfit ids and counts, not flag values) are
 * unaffected.
 *
 * Everything here is pure and synchronous so it can be unit tested and so
 * that the mapping is a function of the loaded data alone.
 */

import { BaseResource } from "./resource_parsers/nova_resource_base.js";
import { NovaResources } from "./resource_parsers/resource_holder_base.js";

/** The stock namespace: base "Nova Files" resources. */
export const BASE_NAMESPACE = "nova";

/** First physical bit handed out to plug-in-private flags. */
export const FIRST_PRIVATE_PHYSICAL_BIT = 64;

/**
 * A resource that takes part in the flag space. Contribute is optional
 * because mïsns only have Require, and Require is optional because ränks
 * only have Contribute.
 */
export interface FlagResource {
    globalID: string;
    writerPrefix: string;
    contribute?: bigint;
    require?: bigint;
}

/** One participating resource with the type it was found under. */
export interface FlagResourceRef {
    type: string;
    resource: FlagResource;
}

/**
 * The resource types that share the flag space, in the order they are
 * scanned (this order does not affect the mapping — only namespace order
 * and bit number do — but it keeps reports stable).
 *
 * gövt belongs here too: its Require ("useful for making travel permits"
 * — EVN Bible, gövt) is tested against the SAME player Contribute set as
 * a shïp's or oütf's, so it must be resolved in the same namespace. Left
 * raw, a plug-in gövt requiring one of its own private bits could never
 * be satisfied by the plug-in's own permit outfit (arpia's Gas Giant
 * gövts 202/203 require bit 7, which its Keycard oütf 493 contributes).
 */
export const FLAG_RESOURCE_TYPES =
    ["shïp", "oütf", "crön", "mïsn", "ränk", "gövt"] as const;

/** Positions of the 1-bits of `value`, ascending. */
export function flagBits(value: bigint): number[] {
    const bits: number[] = [];
    let v = value;
    for (let i = 0; v > 0n; i++, v >>= 1n) {
        if (v & 1n) {
            bits.push(i);
        }
    }
    return bits;
}

/**
 * Every shïp/oütf/crön/mïsn/ränk/gövt currently in `resources`, as flag
 * resources.
 * A resource whose writerPrefix was never set (only possible for hand-made
 * resources in tests) is skipped rather than blowing up the whole map.
 */
export function collectFlagResources(resources: NovaResources): FlagResourceRef[] {
    const refs: FlagResourceRef[] = [];
    for (const type of FLAG_RESOURCE_TYPES) {
        const list = resources[type] ?? {};
        for (const id of Object.keys(list)) {
            const resource = list[id] as BaseResource & Partial<FlagResource>;
            // A ränk contributes without requiring; everything else
            // requires (possibly 0) and may contribute.
            if (typeof resource.require !== "bigint"
                && typeof resource.contribute !== "bigint") {
                continue;
            }
            refs.push({ type, resource: resource as FlagResource });
        }
    }
    return refs;
}

/**
 * The base set: every bit any resource in `resources` contributes or
 * requires. Call it on the id space right after the base "Nova Files" have
 * loaded and before any plug-in does — the stock data, and only the stock
 * data, define which bits are shared.
 */
export function scanBaseFlagSet(resources: NovaResources): Set<number> {
    const bits = new Set<number>();
    for (const { resource } of collectFlagResources(resources)) {
        for (const bit of flagBits(
            (resource.contribute ?? 0n) | (resource.require ?? 0n))) {
            bits.add(bit);
        }
    }
    return bits;
}

/** A private (namespace, raw bit) pair and the physical bit it was given. */
export interface PrivateFlagBit {
    bit: number;
    physicalBit: number;
}

export interface FlagNamespaceEntry {
    namespace: string;
    privateBits: PrivateFlagBit[];
}

/** A raw bit number that two or more plug-ins each use privately. */
export interface FlagCollision {
    bit: number;
    namespaces: string[];
}

/**
 * A plug-in Require bit that neither the base set nor anything in the
 * plug-in's own namespace ever contributes — it can never be satisfied.
 * Almost always an authoring bug, or a cross-plug-in dependency that needs
 * the plug-ins to share a namespace (a Plug-ins subdirectory).
 */
export interface UnsatisfiableRequire {
    namespace: string;
    bit: number;
    physicalBit: number;
    /** "type globalID" of each resource requiring it. */
    requiredBy: string[];
}

export interface FlagNamespaceReport {
    baseSet: number[];
    namespaces: FlagNamespaceEntry[];
    collisions: FlagCollision[];
    unsatisfiable: UnsatisfiableRequire[];
}

/**
 * The resolved mapping. `resolve` is what the parsers use; the rest is
 * for diagnostics and tests.
 */
export interface FlagNamespaceMap {
    readonly baseSet: ReadonlySet<number>;
    /** Namespaces in allocation order, base first. */
    readonly namespaceOrder: readonly string[];
    /** Physical bit of a raw bit as referenced from `namespace`. */
    physicalBit(namespace: string, bit: number): number;
    /** Remaps a raw 64-bit flag set referenced from `namespace`. */
    resolve(namespace: string, raw: bigint): bigint;
    readonly report: FlagNamespaceReport;
}

/**
 * Builds the mapping for everything currently loaded.
 *
 * `namespaceOrder` is the plug-in load order (prefixes, first appearance);
 * namespaces that appear in the data but not in that list are placed after
 * it sorted by name, so the result is still a pure function of the data.
 * The base namespace never has private bits, whatever the order says.
 */
export function buildFlagNamespaceMap(
    resources: NovaResources,
    baseSet: ReadonlySet<number>,
    namespaceOrder: readonly string[]): FlagNamespaceMap {
    return buildFlagNamespaceMapFrom(
        collectFlagResources(resources), baseSet, namespaceOrder);
}

export function buildFlagNamespaceMapFrom(
    refs: readonly FlagResourceRef[],
    baseSet: ReadonlySet<number>,
    namespaceOrder: readonly string[]): FlagNamespaceMap {

    // Private bit usage per namespace, split by role for the diagnostics.
    const contributed = new Map<string, Set<number>>();
    const required = new Map<string, Map<number, string[]>>();
    const used = new Map<string, Set<number>>();
    const use = (namespace: string, bit: number) => {
        let bits = used.get(namespace);
        if (!bits) {
            bits = new Set();
            used.set(namespace, bits);
        }
        bits.add(bit);
    };

    for (const { type, resource } of refs) {
        const namespace = resource.writerPrefix;
        if (namespace === BASE_NAMESPACE) {
            // Everything the base data references is, by construction, in
            // the base set (it was snapshotted from exactly this data).
            continue;
        }
        for (const bit of flagBits(resource.contribute ?? 0n)) {
            if (baseSet.has(bit)) {
                continue;
            }
            use(namespace, bit);
            let bits = contributed.get(namespace);
            if (!bits) {
                bits = new Set();
                contributed.set(namespace, bits);
            }
            bits.add(bit);
        }
        for (const bit of flagBits(resource.require ?? 0n)) {
            if (baseSet.has(bit)) {
                continue;
            }
            use(namespace, bit);
            let bits = required.get(namespace);
            if (!bits) {
                bits = new Map();
                required.set(namespace, bits);
            }
            let by = bits.get(bit);
            if (!by) {
                by = [];
                bits.set(bit, by);
            }
            by.push(type + " " + resource.globalID);
        }
    }

    // Allocation order: the given load order (minus the base namespace and
    // duplicates), then any stragglers sorted by name.
    const ordered: string[] = [];
    const seen = new Set<string>([BASE_NAMESPACE]);
    for (const namespace of namespaceOrder) {
        if (!seen.has(namespace)) {
            seen.add(namespace);
            ordered.push(namespace);
        }
    }
    const stragglers = [...used.keys()].filter(n => !seen.has(n)).sort();
    ordered.push(...stragglers);

    const physical = new Map<string, Map<number, number>>();
    const namespaces: FlagNamespaceEntry[] = [];
    let next = FIRST_PRIVATE_PHYSICAL_BIT;
    for (const namespace of ordered) {
        const bits = used.get(namespace);
        if (!bits || bits.size === 0) {
            continue;
        }
        const table = new Map<number, number>();
        const privateBits: PrivateFlagBit[] = [];
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
    const collisions: FlagCollision[] = [...byBit.entries()]
        .filter(([, list]) => list.length > 1)
        .sort(([a], [b]) => a - b)
        .map(([bit, list]) => ({ bit, namespaces: list }));

    const unsatisfiable: UnsatisfiableRequire[] = [];
    for (const { namespace, privateBits } of namespaces) {
        const contributes = contributed.get(namespace) ?? new Set<number>();
        const requires = required.get(namespace);
        if (!requires) {
            continue;
        }
        for (const { bit, physicalBit } of privateBits) {
            const requiredBy = requires.get(bit);
            if (requiredBy && !contributes.has(bit)) {
                unsatisfiable.push({ namespace, bit, physicalBit, requiredBy });
            }
        }
    }

    const report: FlagNamespaceReport = {
        baseSet: [...baseSet].sort((a, b) => a - b),
        namespaces,
        collisions,
        unsatisfiable,
    };

    const physicalBit = (namespace: string, bit: number): number => {
        if (baseSet.has(bit)) {
            return bit;
        }
        const found = physical.get(namespace)?.get(bit);
        if (found === undefined) {
            // Every (namespace, bit) that any loaded resource references
            // was allocated above; reaching here means a resource that was
            // not part of the scan (or a namespace mix-up), which would be
            // a nondeterministic-mapping bug if allocated lazily. Fail
            // loudly instead.
            throw new Error("Flag bit " + bit + " referenced from namespace '"
                + namespace + "' was never allocated");
        }
        return found;
    };

    return {
        baseSet,
        namespaceOrder: [BASE_NAMESPACE, ...namespaces.map(n => n.namespace)],
        physicalBit,
        resolve: (namespace: string, raw: bigint): bigint => {
            let out = 0n;
            for (const bit of flagBits(raw)) {
                out |= 1n << BigInt(physicalBit(namespace, bit));
            }
            return out;
        },
        report,
    };
}

/**
 * Remaps a resource's raw flag set through `map` in the namespace of the
 * plug-in that wrote the resource. A null map means "no namespacing" —
 * the parsers' default when used standalone (unit tests, hand-built
 * resources), which passes the raw bits through untouched.
 */
export function resolveResourceFlags(map: FlagNamespaceMap | null,
    resource: { writerPrefix: string }, raw: bigint): bigint {
    if (map === null) {
        return raw;
    }
    return map.resolve(resource.writerPrefix, raw);
}

/**
 * The human-readable diagnostics for a report, one line per finding, or
 * an empty array when there is nothing to say. Logged once at load by
 * NovaParse so plug-in authors can see which of their bits collided with
 * another plug-in (harmless now, but worth knowing) and which of their
 * Requires nothing can ever satisfy.
 */
export function describeFlagNamespaceReport(report: FlagNamespaceReport): string[] {
    const lines: string[] = [];
    for (const { bit, namespaces } of report.collisions) {
        lines.push("Require/Contribute bit " + bit + " is used privately by "
            + "plug-ins " + namespaces.map(n => "'" + n + "'").join(", ")
            + "; each now has its own bit.");
    }
    for (const { namespace, bit, requiredBy } of report.unsatisfiable) {
        lines.push("Plug-in '" + namespace + "' requires flag bit " + bit
            + " which nothing stock or in '" + namespace + "' contributes"
            + " (unsatisfiable): " + requiredBy.join(", "));
    }
    return lines;
}
