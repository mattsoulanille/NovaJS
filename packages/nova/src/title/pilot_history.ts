/**
 * Rewindable pilot history: a chain of labelled CHECKPOINTS of a pilot's
 * save, kept beside the save itself.
 *
 * The original game wrote the pilot file on every departure, and nothing
 * else — a mistake (a bad purchase, an accepted mission you regret) was
 * only undoable by keeping copies of the file. Here every departure, and
 * the cheap-to-catch events in between (mission accept/abort/complete/
 * fail, an outfit or ship bought or sold, a capture), records a checkpoint
 * that the title screen's rollback view can inspect and rewind to.
 *
 * STORAGE. Per pilot, under `<saveKey>:history` (historyKeyFor): the
 * pilot registry's per-pilot save keys are `novajs:save:pilot-<id>` (and
 * the legacy `novajs:save`), so this lands at `novajs:save:pilot-<id>:
 * history`. Deliberately NOT inside the SaveEnvelope: the save stays a
 * snapshot of the player's state that older builds and the sim can read
 * unchanged, and the history treats it as an opaque JSON value.
 *
 * SHAPE. `base` is the full save envelope at the OLDEST checkpoint;
 * `checkpoints[i].patch` is the RFC 6902 patch from checkpoint i-1's state
 * to checkpoint i's (checkpoints[0].patch is always empty). The state at
 * any checkpoint is `base` with the patches up to it folded on
 * (checkpointState). Everything is additive: a pilot without a history is
 * fine, an exported pilot file carries the history in an optional field,
 * and older builds ignore that field.
 *
 * CAPS. At most MAX_CHECKPOINTS checkpoints and MAX_HISTORY_BYTES of
 * serialized history; past either, the oldest checkpoints are squashed
 * into `base` one at a time (their state stays reachable as the new base,
 * only the ability to step between them is lost).
 *
 * REWIND (rewindHistory) is never destructive: the checkpoints after the
 * chosen one are dropped, but the pilot's current save is first recorded
 * as a "Before rewind" checkpoint and the rewound state as a "Rewound to
 * ..." checkpoint, so both ends of the jump remain reachable.
 *
 * Client-only bookkeeping; the sim is never involved.
 */

import { isLeft } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';
import { latestVersion, migrateRaw, Migration } from '../common/migrations.js';
import { openEnum } from '../common/open_enum.js';
import { GameDateType } from '../nova_plugin/player_state_plugin.js';
import {
    applyPatch, cloneJson, diffJson, JsonPatchOp, JsonValue,
} from './json_patch.js';

/**
 * The history's schema version, derived from its migration list the way
 * the save's is (common/migrations.ts, save_migrations.ts): a shape
 * change appends a migration that rewrites the RAW stored object, and
 * PilotHistoryCodec describes only the latest shape. The list is empty
 * today — version 1 is the first and only shape — so the codec's own
 * `t.partial` (nextId, the per-checkpoint meta) still describes the
 * additive growth within it.
 *
 * The SAVE ENVELOPES inside (`base`, and every checkpoint's state) are
 * opaque here and migrate on their own: save_game's decodeSave walks a
 * checkpoint's envelope up from whatever version it was recorded at, so
 * a history never needs rewriting when the save's shape moves.
 */
export const FIRST_PILOT_HISTORY_VERSION = 1;
export const PILOT_HISTORY_MIGRATIONS: readonly Migration<unknown>[] = [];
export const PILOT_HISTORY_VERSION =
    latestVersion(FIRST_PILOT_HISTORY_VERSION, PILOT_HISTORY_MIGRATIONS);

/** Newest checkpoints kept before the oldest are squashed into the base. */
export const MAX_CHECKPOINTS = 300;
/**
 * Serialized-size cap for one pilot's history. localStorage gives an
 * origin ~5 MB; a save with escorts is ~35 KB and a depart patch is
 * usually well under 2 KB, so 300 checkpoints fit with room to spare —
 * this is the backstop for a run of unusually large patches (a fleet of
 * escorts changing on every departure).
 */
export const MAX_HISTORY_BYTES = 1_500_000;

/**
 * A checkpoint kind, for the rollback view's markers. OPEN in storage
 * (openEnum): the stored field was always a plain string, so a history
 * written by a newer build with a kind this build does not know still
 * loads, and its rows simply take the blank marker (kindMarker's default
 * arm), exactly as they always did.
 *
 * It stays open ON PURPOSE — do not narrow it to a strict `t.keyof`.
 * The whole history goes through one `PilotHistoryCodec.decode`
 * (decodeHistoryValue below), so a strict kind would make a single
 * unknown name from a newer build fail the ENTIRE decode: loadHistory
 * returns undefined, the file is parked at `:quarantine`, and the pilot
 * loses their rollback history over a display-only field. The
 * pilot_history spec that keeps an unknown 'teleport' and re-encodes it
 * byte-for-byte pins this (PR #218 review, finding 4).
 */
export const CheckpointKindCodec = openEnum('CheckpointKind', [
    'depart', 'mission', 'purchase', 'capture', 'rewind', 'import', 'other',
] as const);
export type CheckpointKind = t.TypeOf<typeof CheckpointKindCodec>;

const JsonPatchOpCodec = t.intersection([
    t.type({ op: t.string, path: t.string }),
    t.partial({ value: t.unknown }),
]);

export const CheckpointCodec = t.intersection([
    t.type({
        /** Stable within the history (never reused after truncation). */
        id: t.string,
        /** Human-readable, e.g. "Departed Earth", "Bought Blaster ×2". */
        label: t.string,
        /** RFC 6902 patch from the previous checkpoint's state. */
        patch: t.array(JsonPatchOpCodec),
    }),
    t.partial({
        kind: CheckpointKindCodec,
        /** The pilot's calendar date at the checkpoint. */
        date: GameDateType,
        /** System global id where it happened (e.g. 'nova:130'). */
        system: t.string,
        /** Stellar (planet) global id where it happened, if landed. */
        stellar: t.string,
        /** Wall-clock ms when it was recorded (informational). */
        at: t.number,
    }),
]);
export type Checkpoint = t.TypeOf<typeof CheckpointCodec>;

export const PilotHistoryCodec = t.intersection([
    t.type({
        version: t.number,
        /** Full save envelope at checkpoints[0]. */
        base: t.unknown,
        checkpoints: t.array(CheckpointCodec),
    }),
    t.partial({
        /** Next checkpoint id to mint. */
        nextId: t.number,
    }),
]);
export type PilotHistory = t.TypeOf<typeof PilotHistoryCodec>;

/** What a caller knows about the moment a checkpoint records. */
export interface CheckpointMeta {
    label: string;
    kind?: CheckpointKind;
    date?: { day: number, month: number, year: number };
    system?: string;
    stellar?: string;
    at?: number;
}

/** Storage key of the history beside the save at `saveKey`. */
export function historyKeyFor(saveKey: string): string {
    return `${saveKey}:history`;
}

/**
 * Where loadHistory parks an unreadable history (`<historyKey>:quarantine`,
 * the save's discipline). Removed with the history, so a deleted pilot
 * leaves no quarantined bytes behind either.
 */
export function historyQuarantineKeyFor(saveKey: string): string {
    return `${historyKeyFor(saveKey)}:quarantine`;
}

/** Number of checkpoints in a history (0 for none). */
export function checkpointCount(history: PilotHistory | undefined): number {
    return history?.checkpoints.length ?? 0;
}

/**
 * The full save envelope at checkpoint `index` (0 = oldest): the base
 * with the patches up to and including `index` folded on. Returns a
 * fresh value the caller may mutate.
 */
export function checkpointState(history: PilotHistory, index: number):
    JsonValue {
    if (index < 0 || index >= history.checkpoints.length) {
        throw new RangeError(`No checkpoint ${index} (have `
            + `${history.checkpoints.length})`);
    }
    let state = history.base as JsonValue;
    for (let i = 0; i <= index; i++) {
        state = applyPatch(state,
            history.checkpoints[i].patch as JsonPatchOp[]);
    }
    return cloneJson(state);
}

/** The state at the newest checkpoint, or undefined for an empty history. */
export function latestState(history: PilotHistory | undefined):
    JsonValue | undefined {
    if (!history || history.checkpoints.length === 0) {
        return undefined;
    }
    return checkpointState(history, history.checkpoints.length - 1);
}

function mintId(history: PilotHistory): { id: string, nextId: number } {
    const nextId = history.nextId ?? history.checkpoints.length + 1;
    return { id: String(nextId), nextId: nextId + 1 };
}

function metaFields(meta: CheckpointMeta): Omit<Checkpoint, 'id' | 'patch'> {
    return {
        label: meta.label,
        ...(meta.kind ? { kind: meta.kind } : {}),
        ...(meta.date ? { date: { ...meta.date } } : {}),
        ...(meta.system ? { system: meta.system } : {}),
        ...(meta.stellar ? { stellar: meta.stellar } : {}),
        ...(meta.at !== undefined ? { at: meta.at } : {}),
    };
}

/**
 * Appends a checkpoint holding `envelope` (the pilot's save envelope as
 * plain JSON) to `history` (undefined starts a new history with this
 * envelope as its base). Pure: returns a new history; the input is not
 * mutated. Applies the caps.
 */
export function appendCheckpoint(history: PilotHistory | undefined,
    envelope: JsonValue, meta: CheckpointMeta): PilotHistory {
    if (!history || history.checkpoints.length === 0) {
        const fresh: PilotHistory = {
            version: PILOT_HISTORY_VERSION,
            base: cloneJson(envelope),
            checkpoints: [],
            nextId: history?.nextId ?? 1,
        };
        const { id, nextId } = mintId(fresh);
        fresh.checkpoints.push({ id, ...metaFields(meta), patch: [] });
        fresh.nextId = nextId;
        return fresh;
    }
    const previous = latestState(history)!;
    const patch = diffJson(previous, envelope);
    const { id, nextId } = mintId(history);
    const next: PilotHistory = {
        ...history,
        checkpoints: [...history.checkpoints,
            { id, ...metaFields(meta), patch }],
        nextId,
    };
    return enforceCaps(next);
}

/**
 * Squashes the oldest checkpoints into the base until the history is
 * within MAX_CHECKPOINTS and MAX_HISTORY_BYTES (always keeps at least
 * one). Pure.
 */
export function enforceCaps(history: PilotHistory,
    caps: { maxCheckpoints?: number, maxBytes?: number } = {}): PilotHistory {
    const maxCheckpoints = caps.maxCheckpoints ?? MAX_CHECKPOINTS;
    const maxBytes = caps.maxBytes ?? MAX_HISTORY_BYTES;
    let current = history;
    // Squash by count first (cheap: one fold), then by bytes.
    if (current.checkpoints.length > maxCheckpoints) {
        current = squashOldest(current,
            current.checkpoints.length - maxCheckpoints);
    }
    while (current.checkpoints.length > 1
        && JSON.stringify(current).length > maxBytes) {
        current = squashOldest(current, 1);
    }
    return current;
}

/**
 * Folds the oldest `count` checkpoints into the base, so checkpoint
 * `count` becomes the new oldest (with an empty patch). Pure.
 */
export function squashOldest(history: PilotHistory, count: number):
    PilotHistory {
    if (count <= 0 || history.checkpoints.length <= 1) {
        return history;
    }
    const keepFrom = Math.min(count, history.checkpoints.length - 1);
    const base = checkpointState(history, keepFrom);
    const [first, ...rest] = history.checkpoints.slice(keepFrom);
    return {
        ...history,
        base,
        checkpoints: [{ ...first, patch: [] }, ...rest],
    };
}

/** Drops every checkpoint after `index`. Pure. */
export function truncateAfter(history: PilotHistory, index: number):
    PilotHistory {
    if (index < 0 || index >= history.checkpoints.length) {
        throw new RangeError(`No checkpoint ${index}`);
    }
    return { ...history, checkpoints: history.checkpoints.slice(0, index + 1) };
}

/** Where a checkpoint's meta comes from when only a save is at hand. */
export function metaFromEnvelope(envelope: JsonValue | undefined):
    Pick<CheckpointMeta, 'date' | 'system'> {
    const data = (envelope as { data?: { date?: unknown, system?: unknown } }
        | undefined)?.data;
    const date = data?.date as CheckpointMeta['date'] | undefined;
    const system = data?.system;
    return {
        ...(date && typeof date === 'object' ? { date: { ...date } } : {}),
        ...(typeof system === 'string' ? { system } : {}),
    };
}

/**
 * Rewinds to checkpoint `index`: the checkpoints after it are dropped, a
 * "Before rewind" checkpoint holding `currentEnvelope` (the pilot's save
 * as it stands right now, which may be ahead of the newest checkpoint)
 * is appended so nothing is lost, and then a "Rewound to ..." checkpoint
 * holding the target state, so the newest checkpoint again matches the
 * pilot's save. Returns the new history and the envelope to install as
 * the pilot's save. Pure.
 */
export function rewindHistory(history: PilotHistory, index: number,
    currentEnvelope: JsonValue | undefined, at?: number):
    { history: PilotHistory, envelope: JsonValue } {
    const target = history.checkpoints[index];
    if (!target) {
        throw new RangeError(`No checkpoint ${index}`);
    }
    const envelope = checkpointState(history, index);
    let next = truncateAfter(history, index);
    if (currentEnvelope !== undefined) {
        next = appendCheckpoint(next, currentEnvelope, {
            label: 'Before rewind',
            kind: 'rewind',
            ...metaFromEnvelope(currentEnvelope),
            ...(at !== undefined ? { at } : {}),
        });
    }
    next = appendCheckpoint(next, envelope, {
        label: `Rewound to: ${target.label}`,
        kind: 'rewind',
        ...(target.date ? { date: { ...target.date } } : {}),
        ...(target.system ? { system: target.system } : {}),
        ...(target.stellar ? { stellar: target.stellar } : {}),
        ...(at !== undefined ? { at } : {}),
    });
    return { history: next, envelope };
}

// ---------------------------------------------------------------------------
// Storage.
// ---------------------------------------------------------------------------

/** The minimal storage surface (localStorage satisfies it). */
export interface HistoryStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

function getStorage(storage?: HistoryStorage): HistoryStorage | undefined {
    if (storage) {
        return storage;
    }
    try {
        return typeof localStorage !== 'undefined' ? localStorage : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Decodes a history from its JSON text. Undefined for anything this build
 * cannot read (malformed, wrong shape, unknown version). Never throws.
 */
export function decodeHistory(raw: string | null | undefined):
    PilotHistory | undefined {
    if (raw == null) {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return undefined;
    }
    return decodeHistoryValue(parsed);
}

/** What reading a stored history produced. */
export type HistoryDecodeResult =
    | { readonly ok: true; readonly history: PilotHistory }
    | { readonly ok: false; readonly reason: string };

/**
 * decodeHistory over an already-parsed value (an import file's field),
 * saying why when it cannot: the version is read first, the migrations
 * run on the raw object, and only then does the codec see it — the same
 * order as save_game's decodeSaveDetailed.
 */
export function decodeHistoryDetailed(parsed: unknown): HistoryDecodeResult {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
        || typeof (parsed as { version?: unknown }).version !== 'number') {
        return {
            ok: false,
            reason: 'The pilot history is not a versioned record.',
        };
    }
    const migrated = migrateRaw('pilot history', FIRST_PILOT_HISTORY_VERSION,
        PILOT_HISTORY_MIGRATIONS, (parsed as { version: number }).version,
        parsed);
    if (!migrated.ok) {
        return migrated;
    }
    const decoded = PilotHistoryCodec.decode(migrated.raw);
    if (isLeft(decoded)) {
        return {
            ok: false,
            reason: 'The pilot history does not match this build\'s shape.',
        };
    }
    const history = decoded.right;
    if (history.base === undefined || history.base === null) {
        return { ok: false, reason: 'The pilot history has no base save.' };
    }
    return { ok: true, history };
}

/** decodeHistoryDetailed without the reason. */
export function decodeHistoryValue(parsed: unknown): PilotHistory | undefined {
    const result = decodeHistoryDetailed(parsed);
    return result.ok ? result.history : undefined;
}

/**
 * Loads the history beside `saveKey`. An unreadable history is parked at
 * `<historyKey>:quarantine` (save_game's discipline) and undefined is
 * returned; a pilot then simply starts a new history at their next
 * checkpoint.
 */
export function loadHistory(saveKey: string, storage?: HistoryStorage):
    PilotHistory | undefined {
    const store = getStorage(storage);
    if (!store) {
        return undefined;
    }
    const key = historyKeyFor(saveKey);
    let raw: string | null;
    try {
        raw = store.getItem(key);
    } catch {
        return undefined;
    }
    if (raw == null) {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        parsed = undefined;
    }
    const result = parsed === undefined
        ? { ok: false as const, reason: 'The pilot history is not valid JSON.' }
        : decodeHistoryDetailed(parsed);
    if (!result.ok) {
        const quarantine = historyQuarantineKeyFor(saveKey);
        try {
            store.setItem(quarantine, raw);
            store.removeItem(key);
        } catch {
            // Best effort.
        }
        console.warn(`Ignoring an unreadable pilot history (moved to `
            + `'${quarantine}'): ${result.reason}`);
        return undefined;
    }
    return result.history;
}

/** Persists `history` beside `saveKey`. Never throws. */
export function saveHistory(saveKey: string, history: PilotHistory,
    storage?: HistoryStorage): void {
    const store = getStorage(storage);
    if (!store) {
        return;
    }
    try {
        // Always at the current version: a history in memory has been
        // migrated to it, whatever version it was read at.
        store.setItem(historyKeyFor(saveKey), JSON.stringify(
            PilotHistoryCodec.encode(
                { ...history, version: PILOT_HISTORY_VERSION })));
    } catch (e) {
        console.warn('Failed to write the pilot history', e);
    }
}

/**
 * Removes the history beside `saveKey` (a deleted pilot), and any
 * unreadable one loadHistory parked at its quarantine key: both are the
 * pilot's bytes, and nothing else ever cleans the quarantine up. Never
 * throws.
 */
export function removeHistory(saveKey: string, storage?: HistoryStorage):
    void {
    const store = getStorage(storage);
    if (!store) {
        return;
    }
    for (const key of [historyKeyFor(saveKey), historyQuarantineKeyFor(saveKey)]) {
        try {
            store.removeItem(key);
        } catch {
            // Best effort.
        }
    }
}

/**
 * Records a checkpoint of `envelope` for the pilot whose save lives at
 * `saveKey`: loads the history, appends, saves. Returns the new history.
 * The one-call form the game client uses.
 */
export function recordCheckpoint(saveKey: string, envelope: JsonValue,
    meta: CheckpointMeta, storage?: HistoryStorage): PilotHistory {
    const history = appendCheckpoint(loadHistory(saveKey, storage), envelope,
        meta);
    saveHistory(saveKey, history, storage);
    return history;
}

/**
 * Rewinds the pilot at `saveKey` to checkpoint `index` in storage: the
 * current save is read (as the "Before rewind" snapshot), the history is
 * rewritten per rewindHistory, and the target envelope is installed as
 * the pilot's save. Returns false when there is no such checkpoint or
 * the storage write failed (nothing is changed then).
 */
export function rewindPilotSave(saveKey: string, index: number,
    storage?: HistoryStorage, at: number = Date.now()): boolean {
    const store = getStorage(storage);
    if (!store) {
        return false;
    }
    const history = loadHistory(saveKey, storage);
    if (!history || index < 0 || index >= history.checkpoints.length) {
        return false;
    }
    let currentEnvelope: JsonValue | undefined;
    try {
        const raw = store.getItem(saveKey);
        currentEnvelope = raw == null ? undefined : JSON.parse(raw) as JsonValue;
    } catch {
        currentEnvelope = undefined;
    }
    const result = rewindHistory(history, index, currentEnvelope, at);
    try {
        store.setItem(saveKey, JSON.stringify(result.envelope));
    } catch (e) {
        console.warn('Failed to install the rewound save', e);
        return false;
    }
    saveHistory(saveKey, result.history, storage);
    return true;
}
