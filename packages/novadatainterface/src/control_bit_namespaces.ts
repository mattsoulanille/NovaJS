/**
 * Per-plug-in namespacing of Nova control bits (NCBs), as seen by the game.
 *
 * EV Nova gives mission scripting ONE global set of 10,000 control bits
 * (b0 - b9999). Plug-ins are written independently of one another and
 * routinely claim the same bit numbers for unrelated purposes, so NovaParse
 * resolves every bit reference in every NCB expression to a PHYSICAL bit
 * number in the namespace of the plug-in that WROTE the resource
 * (novaparse/src/ncb_namespace.ts), and rewrites the expression strings it
 * hands out so that everything downstream — the evaluator, availability
 * tests, set strings, dësc conditionals, sÿst visibility, cröns — keeps
 * working unchanged over physical numbers:
 *
 *  - The BASE SET is every bit that the stock "Nova Files" set or test
 *    anywhere. Base-set bits keep their stock number no matter who
 *    references them, so a plug-in can read and write stock story state
 *    (and a plug-in that overrides a stock mission cannot fork the
 *    mission's own bits).
 *  - Every other (namespace, bit) pair is PRIVATE to the writing plug-in
 *    and gets a physical number >= FIRST_PRIVATE_PHYSICAL_CONTROL_BIT,
 *    allocated deterministically in plug-in load order.
 *
 * This module is the part of that scheme the game itself needs: the
 * numeric ranges, and the serializable description of the mapping that the
 * server hands to the client (GameDataInterface.controlBitNamespaces) so
 * that saved games can persist bits as (namespace, bit) pairs instead of
 * physical numbers, which are only meaningful under one plug-in set.
 */

/** Stock bits are numbered b0 - b9999. */
export const MAX_CONTROL_BIT = 9999;

/**
 * The first physical bit handed out to plug-in-private control bits.
 * Chosen well clear of the whole stock range so that a physical number
 * says on its face which side of the line it is on: `< 10000` is a stock
 * (base-namespace) bit with its original number, `>= 20000` is a plug-in
 * private bit. Numbers in between never occur.
 */
export const FIRST_PRIVATE_PHYSICAL_CONTROL_BIT = 20000;

/** The namespace of the stock "Nova Files" data. */
export const BASE_CONTROL_BIT_NAMESPACE = "nova";

/**
 * Whether a bit number can appear in a physical (post-namespacing)
 * expression: a stock-range bit or a private-range one. NCB expressions
 * are validated against this on the game side; the raw stock-only range
 * check happens once, in the parser.
 */
export function isPhysicalControlBit(bit: number): boolean {
    return (bit >= 0 && bit <= MAX_CONTROL_BIT)
        || bit >= FIRST_PRIVATE_PHYSICAL_CONTROL_BIT;
}

/** A plug-in namespace's private bits: `[rawBit, physicalBit]` pairs. */
export interface ControlBitNamespaceEntry {
    namespace: string;
    /** Sorted by raw bit ascending; physical bits are ascending too. */
    bits: Array<[number, number]>;
}

/**
 * The whole mapping, in a JSON-safe shape. Base-set bits are implicit
 * (physical == raw), so only the private allocations are listed.
 */
export interface ControlBitNamespaces {
    /** The stock base set, ascending. */
    baseSet: number[];
    /**
     * Plug-in namespaces in allocation (= load) order. Namespaces that
     * reference no private bit are omitted.
     */
    namespaces: ControlBitNamespaceEntry[];
    /**
     * Every loaded plug-in prefix in load order, whether or not it uses
     * private control bits. This is the "plugins manifest" a save records.
     */
    pluginOrder: string[];
}

/** No plug-ins, nothing known about the base set. */
export function getDefaultControlBitNamespaces(): ControlBitNamespaces {
    return { baseSet: [], namespaces: [], pluginOrder: [] };
}
