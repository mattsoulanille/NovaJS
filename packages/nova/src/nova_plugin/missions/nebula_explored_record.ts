import * as t from 'io-ts';
import { World } from 'nova_ecs/world';
import { runNCBSet } from '../ncb/index.js';
import { findControlledEntity } from '../player/index.js';
import { applyInFlightSetString } from './mission_accept.js';

/**
 * ============================================================================
 * A nëbu's OnExplore (the `nebulaExplored` input record)
 * ============================================================================
 *
 * The EVN Bible: "OnExplore: Control bit set expression that is evaluated
 * whenever the nebula is tested for visibility and found to be visible.
 * Note that this field is handled a little differently from other control
 * bit set expressions in Nova, because the explored state of the nebulae
 * isn't saved from game to game; rather, it is recalculated every time
 * based on the systems the player has explored. As a result, this
 * expression may get evaluated multiple times, so you shouldn't use the
 * random operator or any operators which do anything but set or clear
 * control bits here."
 *
 * Whether a nebula is visible is a question about the player's DISCOVERY
 * record, which is per-client state the simulation never holds
 * (player/discovery_store.ts). So the shape is the other client-resolved
 * set strings' (an in-flight abort, a stellar's OnDominate): the owning
 * client finds the nebula visible, runs OnExplore against its mirror of
 * the pilot's bits ({@link resolveNebulaOnExplore}), and — only when that
 * changes a bit — sends the deltas on this record, which every peer
 * applies to the sender's ship at the same tick.
 *
 * NO IDEMPOTENCE KEY, by the Bible's own terms: the string "may get
 * evaluated multiple times". Setting and clearing bits are idempotent, so
 * a duplicate (the map tested twice before the first record landed) sets
 * what is already set.
 *
 * No stock or installed-plug-in nebula has an OnExplore (the stock four
 * are all blank, as is ARPIA's McGrawly Nebula); the synthetic data
 * set's Kestrel Haze (`b117`) is what exercises this.
 */
export const NebulaExploredType = t.intersection([t.type({
    /** The nëbu global id whose OnExplore ran, for the record. */
    nebulaId: t.string,
}), t.partial({
    bitsSet: t.array(t.number),
    bitsCleared: t.array(t.number),
})]);
export type NebulaExplored = t.TypeOf<typeof NebulaExploredType>;

/** Unparseable OnExplores already warned about, so a map open cannot spam. */
const warnedBadStrings = new Set<string>();

/**
 * Runs `onExplore` against a copy of `bits` and answers the record that
 * carries what it changed, or undefined when it changes nothing (a blank
 * string, or one whose bits are already as it would leave them).
 *
 * Only the bit operators run (`bxxx`, `!bxxx`, `^bxxx`), as the Bible
 * asks; anything else in the string is ignored (ncb.ts warns once per
 * operator), and an unparseable string changes nothing.
 * `R(...)` picks its first choice: the string runs on one client and
 * travels as deltas, so peers agree whatever it picks, and a constant
 * choice keeps repeated evaluations from wandering.
 */
export function resolveNebulaOnExplore(nebulaId: string, onExplore: string,
    bits: ReadonlySet<number>): NebulaExplored | undefined {
    if (!onExplore.trim()) {
        return undefined;
    }
    const working = new Set(bits);
    try {
        runNCBSet(onExplore, {
            setBit: bit => working.add(bit),
            clearBit: bit => working.delete(bit),
            toggleBit: bit => working.has(bit)
                ? working.delete(bit) : working.add(bit),
        }, () => 0);
    } catch (e) {
        const key = `${nebulaId}:${onExplore}`;
        if (!warnedBadStrings.has(key)) {
            warnedBadStrings.add(key);
            console.warn(`Bad OnExplore for nëbu ${nebulaId}: ${e}`);
        }
        return undefined;
    }
    const bitsSet = [...working].filter(bit => !bits.has(bit))
        .sort((a, b) => a - b);
    const bitsCleared = [...bits].filter(bit => !working.has(bit))
        .sort((a, b) => a - b);
    if (bitsSet.length === 0 && bitsCleared.length === 0) {
        return undefined;
    }
    return {
        nebulaId,
        ...(bitsSet.length > 0 ? { bitsSet } : {}),
        ...(bitsCleared.length > 0 ? { bitsCleared } : {}),
    };
}

/**
 * Applies a `nebulaExplored` record on every peer at the same tick: the
 * actor from `peerId` (never the record), then the bit deltas on that
 * pilot's ship. Only the bit fields of the effects exist on this record,
 * so nothing else about the pilot can move.
 *
 * Synchronous and free of randomness and wall-clock reads (the rollback
 * driver replays it).
 */
export function applyNebulaExplored(world: World, peerId: string | undefined,
    record: NebulaExplored): void {
    const controlled = findControlledEntity(world, peerId);
    if (!controlled) {
        return;
    }
    applyInFlightSetString(world, controlled.uuid, controlled.entity, {
        bitsSet: record.bitsSet, bitsCleared: record.bitsCleared,
    }, `the OnExplore of ${record.nebulaId}`);
}
