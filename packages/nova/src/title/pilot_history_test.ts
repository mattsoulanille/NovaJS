import 'jasmine';
import {
    PILOT_FILE_NO_ESCORT, PILOT_FILE_WITH_ESCORT,
} from './fixtures/sample_pilot_files.js';
import { cloneJson, jsonEqual, JsonValue } from './json_patch.js';
import {
    appendCheckpoint, CheckpointKindCodec, checkpointState, decodeHistory,
    enforceCaps, historyKeyFor, latestState, loadHistory, MAX_CHECKPOINTS,
    PilotHistory, PilotHistoryCodec, recordCheckpoint, rewindHistory,
    rewindPilotSave, saveHistory, squashOldest, truncateAfter,
} from './pilot_history.js';

class MemoryStorage {
    private map = new Map<string, string>();
    getItem(key: string) { return this.map.get(key) ?? null; }
    setItem(key: string, value: string) { this.map.set(key, value); }
    removeItem(key: string) { this.map.delete(key); }
    keys() { return [...this.map.keys()]; }
}

const SAVE_A = (PILOT_FILE_WITH_ESCORT as { save: JsonValue }).save;
const SAVE_B = (PILOT_FILE_NO_ESCORT as { save: JsonValue }).save;

/** A sequence of distinguishable envelopes: SAVE_A with credits = n. */
function envelopeWithCredits(n: number): JsonValue {
    const copy = cloneJson(SAVE_A) as { data: { credits: number } };
    copy.data.credits = n;
    return copy as JsonValue;
}

function build(count: number): PilotHistory {
    let history: PilotHistory | undefined;
    for (let i = 0; i < count; i++) {
        history = appendCheckpoint(history, envelopeWithCredits(i),
            { label: `Checkpoint ${i}`, kind: 'depart', system: `nova:${i}` });
    }
    return history!;
}

describe('pilot history', () => {
    describe('appendCheckpoint / checkpointState', () => {
        it('starts a history whose base is the first envelope', () => {
            const history = appendCheckpoint(undefined, SAVE_A,
                { label: 'Departed Earth', kind: 'depart', system: 'nova:130',
                  stellar: 'nova:128', date: { day: 1, month: 2, year: 1177 } });
            expect(history.checkpoints.length).toBe(1);
            expect(history.checkpoints[0].patch).toEqual([]);
            expect(history.checkpoints[0].label).toBe('Departed Earth');
            expect(history.checkpoints[0].system).toBe('nova:130');
            expect(history.checkpoints[0].stellar).toBe('nova:128');
            expect(history.checkpoints[0].date).toEqual(
                { day: 1, month: 2, year: 1177 });
            expect(jsonEqual(checkpointState(history, 0), SAVE_A)).toBeTrue();
        });

        it('stores each later checkpoint as a patch and folds it back exactly',
            () => {
                let history = appendCheckpoint(undefined, SAVE_A, { label: 'a' });
                history = appendCheckpoint(history, SAVE_B, { label: 'b' });
                history = appendCheckpoint(history, SAVE_A, { label: 'a again' });
                expect(history.checkpoints.map(c => c.id)).toEqual(['1', '2', '3']);
                expect(history.checkpoints[1].patch.length).toBeGreaterThan(0);
                expect(jsonEqual(checkpointState(history, 0), SAVE_A)).toBeTrue();
                expect(jsonEqual(checkpointState(history, 1), SAVE_B)).toBeTrue();
                expect(jsonEqual(checkpointState(history, 2), SAVE_A)).toBeTrue();
                expect(jsonEqual(latestState(history)!, SAVE_A)).toBeTrue();
                // The base is a copy, not an alias of the caller's object.
                expect(history.base).not.toBe(SAVE_A);
            });

        it('does not mutate the history it is given', () => {
            const first = appendCheckpoint(undefined, SAVE_A, { label: 'a' });
            const frozen = JSON.stringify(first);
            appendCheckpoint(first, SAVE_B, { label: 'b' });
            expect(JSON.stringify(first)).toEqual(frozen);
        });

        it('records an empty patch for an unchanged save', () => {
            let history = appendCheckpoint(undefined, SAVE_A, { label: 'a' });
            history = appendCheckpoint(history, SAVE_A, { label: 'same' });
            expect(history.checkpoints[1].patch).toEqual([]);
        });
    });

    describe('caps', () => {
        it('squashes the oldest checkpoints past MAX_CHECKPOINTS, keeping '
            + 'the oldest surviving state reachable', () => {
                const history = build(MAX_CHECKPOINTS + 5);
                expect(history.checkpoints.length).toBe(MAX_CHECKPOINTS);
                // The 5 oldest were folded into the base; the new oldest is
                // checkpoint 5 and its state is intact.
                expect(history.checkpoints[0].label).toBe('Checkpoint 5');
                expect(history.checkpoints[0].patch).toEqual([]);
                const oldest = checkpointState(history, 0) as
                    { data: { credits: number } };
                expect(oldest.data.credits).toBe(5);
                const newest = latestState(history) as { data: { credits: number } };
                expect(newest.data.credits).toBe(MAX_CHECKPOINTS + 4);
                // Ids keep counting up (never reused).
                expect(history.checkpoints[0].id).toBe('6');
            });

        it('squashes by byte size too', () => {
            const history = build(6);
            const bytes = JSON.stringify(history).length;
            const capped = enforceCaps(history, { maxBytes: bytes - 1 });
            expect(capped.checkpoints.length).toBeLessThan(6);
            expect(capped.checkpoints.length).toBeGreaterThanOrEqual(1);
            const newest = latestState(capped) as { data: { credits: number } };
            expect(newest.data.credits).toBe(5);
        });

        it('never squashes below one checkpoint', () => {
            const history = build(3);
            expect(enforceCaps(history, { maxBytes: 1 }).checkpoints.length)
                .toBe(1);
            expect(squashOldest(history, 99).checkpoints.length).toBe(1);
        });
    });

    describe('truncateAfter / rewindHistory', () => {
        it('rewinds: truncates, records "Before rewind" and "Rewound to"', () => {
            const history = build(5);
            const current = envelopeWithCredits(1000); // ahead of the newest
            const { history: rewound, envelope } =
                rewindHistory(history, 2, current, 42);
            expect((envelope as { data: { credits: number } }).data.credits)
                .toBe(2);
            const labels = rewound.checkpoints.map(c => c.label);
            expect(labels).toEqual([
                'Checkpoint 0', 'Checkpoint 1', 'Checkpoint 2',
                'Before rewind', 'Rewound to: Checkpoint 2',
            ]);
            expect(rewound.checkpoints[3].kind).toBe('rewind');
            expect(rewound.checkpoints[3].at).toBe(42);
            // The pre-rewind save is still reachable...
            expect((checkpointState(rewound, 3) as
                { data: { credits: number } }).data.credits).toBe(1000);
            // ...and the newest checkpoint is the installed state.
            expect(jsonEqual(latestState(rewound)!, envelope)).toBeTrue();
            // The rewound-to checkpoint inherits the target's location.
            expect(rewound.checkpoints[4].system).toBe('nova:2');
        });

        it('rewinds without a current save (no "Before rewind")', () => {
            const { history: rewound } = rewindHistory(build(3), 0, undefined);
            expect(rewound.checkpoints.map(c => c.label))
                .toEqual(['Checkpoint 0', 'Rewound to: Checkpoint 0']);
        });

        it('truncateAfter drops the later checkpoints only', () => {
            const truncated = truncateAfter(build(4), 1);
            expect(truncated.checkpoints.length).toBe(2);
            expect(() => truncateAfter(build(2), 5)).toThrowError(RangeError);
        });
    });

    describe('storage', () => {
        it('records under <saveKey>:history and reloads', () => {
            const store = new MemoryStorage();
            recordCheckpoint('novajs:save:pilot-x', SAVE_A,
                { label: 'Departed Earth' }, store);
            recordCheckpoint('novajs:save:pilot-x', SAVE_B,
                { label: 'Bought stuff' }, store);
            expect(store.keys()).toEqual(['novajs:save:pilot-x:history']);
            expect(historyKeyFor('novajs:save')).toBe('novajs:save:history');
            const loaded = loadHistory('novajs:save:pilot-x', store)!;
            expect(loaded.checkpoints.map(c => c.label))
                .toEqual(['Departed Earth', 'Bought stuff']);
            expect(jsonEqual(checkpointState(loaded, 1), SAVE_B)).toBeTrue();
        });

        it('quarantines an unreadable history instead of dropping it', () => {
            const store = new MemoryStorage();
            store.setItem('novajs:save:history', '{not json');
            expect(loadHistory('novajs:save', store)).toBeUndefined();
            expect(store.getItem('novajs:save:history')).toBeNull();
            expect(store.getItem('novajs:save:history:quarantine'))
                .toBe('{not json');
        });

        it('rejects an unknown version or a missing base', () => {
            expect(decodeHistory(JSON.stringify(
                { version: 99, base: {}, checkpoints: [] }))).toBeUndefined();
            expect(decodeHistory(JSON.stringify(
                { version: 1, base: null, checkpoints: [] }))).toBeUndefined();
            expect(decodeHistory(JSON.stringify(
                { version: 1, base: { a: 1 }, checkpoints: [] }))).toBeDefined();
        });

        it('checkpoint kinds decode as stored and an unknown kind is kept, '
            + 'not rejected (the field is open in storage)', () => {
                const checkpoint = (kind: string) =>
                    ({ id: '1', label: 'x', patch: [], kind });
                for (const kind of CheckpointKindCodec.members) {
                    const history = decodeHistory(JSON.stringify({
                        version: 1, base: { a: 1 },
                        checkpoints: [checkpoint(kind)],
                    }));
                    expect(history?.checkpoints[0].kind).toBe(kind);
                }
                // A history written by a newer build.
                const raw = JSON.stringify({
                    version: 1, base: { a: 1 },
                    checkpoints: [checkpoint('teleport')],
                });
                const history = decodeHistory(raw);
                expect(history?.checkpoints[0].kind as string).toBe('teleport');
                // ...and re-encodes byte-for-byte.
                expect(JSON.stringify(PilotHistoryCodec.encode(history!)))
                    .toBe(raw);
                expect(decodeHistory(JSON.stringify({
                    version: 1, base: { a: 1 },
                    checkpoints: [{ id: '1', label: 'x', patch: [], kind: 7 }],
                }))).toBeUndefined();
            });

        it('rewindPilotSave installs the exact earlier save and keeps '
            + 'the pre-rewind save reachable', () => {
                const store = new MemoryStorage();
                const key = 'novajs:save:pilot-r';
                let history: PilotHistory | undefined;
                for (let i = 0; i < 4; i++) {
                    history = appendCheckpoint(history, envelopeWithCredits(i),
                        { label: `cp${i}` });
                }
                saveHistory(key, history!, store);
                // The live save has moved on since the last checkpoint.
                store.setItem(key, JSON.stringify(envelopeWithCredits(77)));

                expect(rewindPilotSave(key, 1, store, 5)).toBeTrue();
                const installed = JSON.parse(store.getItem(key)!);
                expect(jsonEqual(installed, envelopeWithCredits(1))).toBeTrue();
                const after = loadHistory(key, store)!;
                expect(after.checkpoints.map(c => c.label))
                    .toEqual(['cp0', 'cp1', 'Before rewind', 'Rewound to: cp1']);
                expect((checkpointState(after, 2) as
                    { data: { credits: number } }).data.credits).toBe(77);
            });

        it('rewindPilotSave refuses an unknown checkpoint without writing', () => {
            const store = new MemoryStorage();
            expect(rewindPilotSave('novajs:save:pilot-none', 0, store)).toBeFalse();
            expect(store.keys()).toEqual([]);
        });
    });
});
