/**
 * ============================================================================
 * The room's spawn bits: whose control bits gate what a system spawns
 * ============================================================================
 *
 * Three NCB tests decide what a system's NPC traffic can contain: flët
 * AppearOn (a fleet), shïp AppearOn (a düde's ship class) and përs
 * ActiveOn (a person). Control bits are per-PLAYER state, while the
 * traffic is shared room state every peer must simulate identically, so
 * one set of bits has to be chosen for the whole room. The maintainer's
 * ruling (#140): "let whoever entered an empty system first determine the
 * bits used for spawning stuff in the system."
 *
 * HOW THAT IS MADE DETERMINISTIC. A room's world is built from genesis
 * exactly when the room was empty: the server closes a room's relay and
 * archive the moment its last member leaves and starts both afresh for
 * the next arrival, and every client builds the system's world anew on
 * entry. So "the first player to enter while it was empty" is "the first
 * player ship THIS world ever contains", and the world can answer that
 * from its own synced state with no new message at all:
 *
 *  - The bits come from the entrant's player ship — the entity carrying
 *    ControlledByComponent — whose ControlBitsComponent (physical bit
 *    numbers, the very numbers NovaParse rewrote the tests to) rides its
 *    insertion record like every other component. No pilot is asked;
 *    no peer guesses.
 *  - NpcRespawnSystem latches them into the spawner (`spawnBits`) on the
 *    first tick a player ship is present, and never again: a later
 *    joiner's ship, with whatever bits, changes nothing. Ships arriving
 *    on the same tick resolve to the lowest uuid. A player ship with no
 *    ControlBitsComponent (the determinism harness's) is an entrant with
 *    no bits set.
 *  - Only the bits the system's own tests READ are kept (`spawnTableBits`),
 *    so the latched state is bounded by the scenario data, never by what
 *    a client put on its ship. (Trust model, rollback_protocol.ts: a
 *    client may lie about its own bits as it may about its own hull —
 *    anti-cheat is out of scope — but the value's SHAPE is the
 *    registry-typed ControlBits codec the relay already decodes the
 *    record with, its SIZE is bounded by the socket's frame cap, and
 *    junk bits are simply never read.)
 *  - The latch is spawner component state, so it is in every rollback
 *    snapshot, every wire snapshot a late joiner restores and every
 *    desync hash; it is set by a system stepping over input-applied
 *    state, so a rollback that moves the entrant's insertion moves the
 *    latch with it.
 *
 * A SYSTEM WHOSE TESTS READ NO BIT never latches anything: its tables
 * mean the same under every bit set, so its state, its PRNG draws and its
 * hashes are exactly what they were before the latch existed.
 *
 * GENESIS RUNS BEFORE ANYONE ENTERS, so the initial population cannot see
 * the entrant's bits. It is drawn exactly as before, against the EMPTY
 * set (the same table, the same draws, the same entity ids); the latch
 * then governs every later draw — each respawn's ship and fleet pick and
 * its përs roll. Ships already in the system when the entrant arrives
 * are left alone (removing or re-rolling them would churn ids and draws
 * for every system with a gated table, and a ship the bits exclude simply
 * jumps out in time). A system whose empty-set table is EMPTY (every
 * entry gated) has no genesis population at all, as before, and rolls
 * its population target at the latch tick instead, when the latched
 * table has something to spawn; it then fills by jump-ins.
 *
 * The other terms a test can use stay at the shared-spawn defaults the
 * tables always had: `Oxxx` (owns outfit) false, `Exxx` (explored) false
 * — map knowledge is per-client state (see ncb.ts's hasExplored) — and
 * G / Pxxx at their ncb.ts defaults. The ruling is about the bits.
 *
 * The spawn table therefore holds the CANDIDATES: every entry whose test
 * could pass under some bit set, gated ones marked with their test, all
 * of them staged at genesis so a latched table spawns synchronously from
 * the cache. `effectiveNpcSpawnEntries` / `effectivePersEntries` are the
 * table a given bit set sees; under the empty set that is, entry for
 * entry and weight for weight, the table the empty-set rule used to
 * build — which is what keeps every ungated draw where it was.
 *
 * NOT spawn gates, and so untouched: sÿst Visibility (which systems a
 * player's MAP shows — per-player, spaceport/starmap), mïsn AvailBits
 * (mission offers; mission ships are spawned by the accepting player's
 * own records), shïp/oütf Availability, jünk BuyOn/SellOn and öops
 * ActivateOn (the landed venues), nëbu ActiveOn (map art) and crön
 * EnableOn (news and events). düde itself has no NCB test.
 */
import {
    evaluateParsedNCBTest, NCBTestExpression, parseNCBTest,
    referencedControlBits,
} from '../ncb/index.js';
import type {
    NpcSpawnEntry, NpcSpawnerType, PersSpawnEntry,
} from './npc_spawn_plugin.js';

/** A spawn-gating NCB test, classified once. */
export type SpawnTest =
    /** Reads no control bit: the same answer under every bit set. */
    | { kind: 'constant', value: boolean }
    /** Reads these bits (sorted): its answer is the room's to decide. */
    | { kind: 'gated', expression: NCBTestExpression, bits: readonly number[] }
    /** Does not parse: false under every bit set (callers warn). */
    | { kind: 'invalid', error: unknown };

/**
 * Parses are pure, so they are memoized by expression text: the latched
 * tables are re-read on every respawn, and a system's handful of tests
 * would otherwise be re-parsed each time.
 */
const parsed = new Map<string, SpawnTest>();

/** The empty-set context every shared spawn test runs under, plus bits. */
function spawnContext(bits: ReadonlySet<number>) {
    return { getBit: (bit: number) => bits.has(bit) };
}

export function classifySpawnTest(expression: string): SpawnTest {
    let test = parsed.get(expression);
    if (!test) {
        try {
            const tree = parseNCBTest(expression);
            const bits = referencedControlBits(tree);
            test = bits.length === 0
                ? {
                    kind: 'constant',
                    value: evaluateParsedNCBTest(tree, spawnContext(new Set())),
                }
                : { kind: 'gated', expression: tree, bits };
        } catch (error) {
            test = { kind: 'invalid', error };
        }
        parsed.set(expression, test);
    }
    return test;
}

/** Whether a stored (gated) test passes under `bits`; absent passes. */
export function spawnTestPasses(expression: string | undefined,
    bits: ReadonlySet<number>): boolean {
    if (expression === undefined) {
        return true;
    }
    const test = classifySpawnTest(expression);
    switch (test.kind) {
        case 'constant':
            return test.value;
        case 'invalid':
            return false;
        case 'gated':
            return evaluateParsedNCBTest(test.expression, spawnContext(bits));
    }
}

/** The empty bit set: what every table is read under before a latch. */
export const NO_SPAWN_BITS: ReadonlySet<number> = new Set();

function npcTableIsGated(entries: readonly NpcSpawnEntry[]): boolean {
    return entries.some(entry => entry.appearOn !== undefined
        || entry.roamingShare === true
        || entry.dude?.ships.some(ship => ship.appearOn !== undefined));
}

function persTableIsGated(entries: readonly PersSpawnEntry[]): boolean {
    return entries.some(entry => entry.activeOn !== undefined
        || entry.evenShare === true);
}

/**
 * The NPC spawn table `bits` sees (see the module comment). Entries and
 * düde ship classes whose test fails are dropped, a düde left with no
 * class is dropped, and the roaming fleets that remain share
 * ROAMING_FLEET_WEIGHT evenly — the exact arithmetic the table builder
 * used, so the empty set reproduces the old table's weights bit for bit.
 * A table with no gated entry is returned as is.
 */
export function effectiveNpcSpawnEntries(entries: readonly NpcSpawnEntry[],
    bits: ReadonlySet<number>): NpcSpawnEntry[] {
    if (!npcTableIsGated(entries)) {
        return entries as NpcSpawnEntry[];
    }
    const passes = (expression: string | undefined) =>
        spawnTestPasses(expression, bits);
    const roaming = entries.filter(entry =>
        entry.roamingShare === true && passes(entry.appearOn)).length;
    const effective: NpcSpawnEntry[] = [];
    for (const entry of entries) {
        if (!passes(entry.appearOn)) {
            continue;
        }
        if (entry.dude) {
            const ships = entry.dude.ships.filter(ship => passes(ship.appearOn));
            if (ships.length > 0) {
                effective.push({ weight: entry.weight,
                    dude: { ...entry.dude, ships } });
            }
        } else if (entry.roamingShare === true) {
            effective.push({ ...entry, weight: entry.weight / roaming });
        } else {
            effective.push(entry);
        }
    }
    return effective;
}

/**
 * The përs table `bits` sees: entries whose ActiveOn fails are dropped,
 * and a LinkSyst pool (`evenShare`) spreads 100% over the people that
 * remain — again the builder's own arithmetic.
 */
export function effectivePersEntries(entries: readonly PersSpawnEntry[],
    bits: ReadonlySet<number>): PersSpawnEntry[] {
    if (!persTableIsGated(entries)) {
        return entries as PersSpawnEntry[];
    }
    const active = entries.filter(entry => spawnTestPasses(entry.activeOn, bits));
    return active.map(entry => entry.evenShare === true
        ? { ...entry, chance: 100 / active.length }
        : entry);
}

/**
 * Every control bit the spawner's tests read, sorted: the only bits a
 * latch needs to keep. Empty for a table nothing gates.
 */
export function spawnTableBits(spawner: Pick<NpcSpawnerType,
    'entries' | 'persEntries'>): number[] {
    const bits = new Set<number>();
    const add = (expression: string | undefined) => {
        if (expression === undefined) {
            return;
        }
        const test = classifySpawnTest(expression);
        if (test.kind === 'gated') {
            test.bits.forEach(bit => bits.add(bit));
        }
    };
    for (const entry of spawner.entries) {
        add(entry.appearOn);
        entry.dude?.ships.forEach(ship => add(ship.appearOn));
    }
    for (const entry of spawner.persEntries ?? []) {
        add(entry.activeOn);
    }
    return [...bits].sort((a, b) => a - b);
}

/** The bit set a spawner's latch stands for (empty before the latch). */
export function latchedSpawnBits(spawner: Pick<NpcSpawnerType, 'spawnBits'>):
    ReadonlySet<number> {
    return spawner.spawnBits ? new Set(spawner.spawnBits) : NO_SPAWN_BITS;
}
