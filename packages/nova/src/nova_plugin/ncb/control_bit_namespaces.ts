/**
 * Translating the player's control bits between the PHYSICAL numbers the
 * simulation runs on and the (namespace, raw bit) PAIRS a save persists.
 *
 * NovaParse namespaces every control-bit reference per plug-in and
 * rewrites the expressions it hands out (novaparse/src/ncb_namespace.ts),
 * so in the running game a bit is just a physical number: a stock bit
 * under its own number, or a plug-in-private bit renumbered to
 * >= FIRST_PRIVATE_PHYSICAL_CONTROL_BIT. Those private numbers are only
 * meaningful under ONE plug-in set — install another plug-in, or take the
 * pilot to a server with different plug-ins, and the allocation moves. So
 * a save stores each bit as the pair the number stands for:
 *
 *     ["nova", 212]      the stock bit b212
 *     ["arpia", 2050]    ARPIA's own b2050
 *
 * and this module maps pairs back to physical numbers under whatever
 * plug-in set is loaded NOW (ControlBitNamespaces, served by the game data
 * source). A pair whose namespace is not loaded, or whose bit that plug-in
 * no longer references, cannot be represented in the simulation and is
 * PARKED: kept verbatim beside the live bits and written back into the
 * next save unchanged, so re-installing the plug-in restores its progress.
 *
 * Saves written before namespacing hold bare physical numbers only. Those
 * were shared by everyone, so migration is best-effort: a number in the
 * stock base set (or in the stock range and claimed by no plug-in) is the
 * stock bit; a number that some loaded plug-in uses privately is given to
 * EVERY such plug-in, which preserves what each of them observed under
 * the old shared numbering (the one bit was set for all of them). The
 * ambiguity is inherent — the old save simply did not record who meant
 * the bit — and this errs on the side of not losing progress.
 */

import {
    BASE_CONTROL_BIT_NAMESPACE, ControlBitNamespaces,
    FIRST_PRIVATE_PHYSICAL_CONTROL_BIT, getDefaultControlBitNamespaces,
    isPhysicalControlBit,
} from 'novadatainterface/control_bit_namespaces';

/** A saved control bit: [namespace, raw bit]. */
export type ControlBitPair = [string, number];

/**
 * The pseudo-namespace a private-range PHYSICAL bit is written under when
 * the current mapping has no pair for it — the bits and the mapping came
 * from different plug-in sets, or the mapping never arrived (an old
 * server). Such a pair reads back as the same physical number, so no bit
 * is ever dropped from a save; it just cannot be re-homed until the
 * plug-in set that produced it is loaded again.
 */
export const UNMAPPED_PHYSICAL_NAMESPACE = 'physical';

/** Physical bits the current plug-in set can hold, plus the rest. */
export interface ResolvedControlBits {
    physical: Set<number>;
    /** Pairs no loaded namespace can represent, in the order given. */
    parked: ControlBitPair[];
}

function comparePairs(a: ControlBitPair, b: ControlBitPair): number {
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1];
}

/** Sorted, de-duplicated pairs: the canonical order a save writes. */
export function sortControlBitPairs(pairs: Iterable<ControlBitPair>): ControlBitPair[] {
    const seen = new Set<string>();
    const out: ControlBitPair[] = [];
    for (const pair of pairs) {
        const key = `${pair[0]}\u0000${pair[1]}`;
        if (!seen.has(key)) {
            seen.add(key);
            out.push([pair[0], pair[1]]);
        }
    }
    return out.sort(comparePairs);
}

export class ControlBitResolver {
    private readonly baseSet: Set<number>;
    /** namespace -> raw bit -> physical bit. */
    private readonly forward = new Map<string, Map<number, number>>();
    /** physical bit -> [namespace, raw bit]. */
    private readonly reverse = new Map<number, ControlBitPair>();
    /** raw bit -> namespaces that use it privately (allocation order). */
    private readonly privateUsers = new Map<number, string[]>();
    readonly pluginOrder: readonly string[];

    /**
     * `namespaces` is what the game data source serves; undefined means
     * "nothing known" (an old server, a mock): every stock-range number is
     * the stock bit and every plug-in pair parks.
     */
    constructor(namespaces: ControlBitNamespaces | undefined = undefined) {
        const data = namespaces ?? getDefaultControlBitNamespaces();
        this.baseSet = new Set(data.baseSet);
        this.pluginOrder = [...data.pluginOrder];
        for (const { namespace, bits } of data.namespaces) {
            const table = new Map<number, number>();
            for (const [raw, physical] of bits) {
                table.set(raw, physical);
                this.reverse.set(physical, [namespace, raw]);
                let users = this.privateUsers.get(raw);
                if (!users) {
                    users = [];
                    this.privateUsers.set(raw, users);
                }
                users.push(namespace);
            }
            this.forward.set(namespace, table);
        }
    }

    /** Whether `namespace` is loaded (has any private bit, or is stock). */
    hasNamespace(namespace: string): boolean {
        return namespace === BASE_CONTROL_BIT_NAMESPACE
            || this.forward.has(namespace)
            || this.pluginOrder.includes(namespace);
    }

    /**
     * The physical bit for a pair under the current plug-in set, or
     * undefined if it has none (namespace not loaded, or a private bit
     * that plug-in no longer references).
     */
    physicalBit([namespace, bit]: ControlBitPair): number | undefined {
        if (namespace === BASE_CONTROL_BIT_NAMESPACE
            || namespace === UNMAPPED_PHYSICAL_NAMESPACE) {
            // A stock bit is its own number, whether or not the base set
            // is known here (an old save's migration relies on this), and
            // an unmapped-physical pair reads back as the same physical
            // number. But only when the number is one the simulation can
            // hold at all: a number in the dead gap between the stock
            // range and the private range (isPhysicalControlBit rejects
            // it) is PARKED like any other unrepresentable pair rather
            // than installed as a physical bit no expression could ever
            // legally name.
            return isPhysicalControlBit(bit) ? bit : undefined;
        }
        if (this.baseSet.has(bit)) {
            // Base-set bits are shared: the same physical bit from every
            // namespace (a plug-in that wrote ["arpia", 212] meant b212).
            return bit;
        }
        return this.forward.get(namespace)?.get(bit);
    }

    /** The pair a physical bit stands for under the current plug-in set. */
    pair(physical: number): ControlBitPair {
        if (physical < FIRST_PRIVATE_PHYSICAL_CONTROL_BIT) {
            return [BASE_CONTROL_BIT_NAMESPACE, physical];
        }
        // A private physical bit not in the table: see
        // UNMAPPED_PHYSICAL_NAMESPACE. Kept, never dropped.
        return this.reverse.get(physical) ?? [UNMAPPED_PHYSICAL_NAMESPACE, physical];
    }

    /**
     * The pairs for a set of live physical bits, in canonical order. Every
     * bit gets a pair (see UNMAPPED_PHYSICAL_NAMESPACE); a warning names
     * the ones the mapping did not know.
     */
    toPairs(physical: Iterable<number>): ControlBitPair[] {
        const pairs = [...physical].map(bit => this.pair(bit));
        const unmapped = pairs.filter(([ns]) => ns === UNMAPPED_PHYSICAL_NAMESPACE);
        if (unmapped.length > 0) {
            console.warn('Control bits with no namespace under the current '
                + 'plug-in set are kept as bare physical numbers: '
                + unmapped.map(([, bit]) => `b${bit}`).join(', '));
        }
        return sortControlBitPairs(pairs);
    }

    /**
     * Physical bits for saved pairs under the current plug-in set; pairs
     * that cannot be represented are parked.
     */
    fromPairs(pairs: Iterable<ControlBitPair>): ResolvedControlBits {
        const physical = new Set<number>();
        const parked: ControlBitPair[] = [];
        for (const pair of pairs) {
            const bit = this.physicalBit(pair);
            if (bit === undefined) {
                parked.push([pair[0], pair[1]]);
            } else {
                physical.add(bit);
            }
        }
        return { physical, parked: sortControlBitPairs(parked) };
    }

    /**
     * Migrates a pre-namespacing save's bare bit numbers (see the module
     * comment for the attribution rules). Numbers already in the private
     * physical range — a save written by a namespacing build that somehow
     * lost its pairs — are read back through the current mapping. A number
     * in the dead gap between the stock and private ranges, which no build
     * ever wrote legitimately, is parked (physicalBit refuses it) rather
     * than installed as a physical bit no expression could name.
     */
    migrateLegacy(numbers: Iterable<number>, options: {
        /**
         * Whether a stock-range number that a loaded plug-in uses privately
         * may be attributed to that plug-in (the pre-namespacing shared
         * numbering). Pass FALSE when the save was written under a
         * DIFFERENT plug-in set: the number then meant whatever the writer's
         * base set said, and giving it to a local plug-in would switch on
         * unrelated plug-in state (review r12 H-2). It stays a stock bit
         * instead — inert if nothing stock references it.
         */
        attributeToPlugins?: boolean,
    } = {}): ResolvedControlBits {
        const attribute = options.attributeToPlugins ?? true;
        const pairs: ControlBitPair[] = [];
        for (const n of numbers) {
            if (n >= FIRST_PRIVATE_PHYSICAL_CONTROL_BIT) {
                pairs.push(this.pair(n));
                continue;
            }
            const users = this.baseSet.has(n) || !attribute
                ? undefined : this.privateUsers.get(n);
            if (!users || users.length === 0) {
                pairs.push([BASE_CONTROL_BIT_NAMESPACE, n]);
                continue;
            }
            for (const namespace of users) {
                pairs.push([namespace, n]);
            }
        }
        return this.fromPairs(pairs);
    }
}
