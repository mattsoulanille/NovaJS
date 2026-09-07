import 'jasmine';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { resetWarnThrottle } from '../common/log_throttle.js';
import { RollbackRelay } from './rollback_relay.js';
import { canonicalDesyncHash, RollbackProtocolMessage, unwrapRollbackMessage, wrapRollbackMessage } from './rollback_protocol.js';
import { SimulationInput } from './simulation_input.js';
import { liveWireFingerprint } from './wire_schemas.js';

const CONTROL: SimulationInput[] = [
    { kind: 'control', events: [{ action: 'accelerate', state: 'start' }] },
];

describe('RollbackRelay', () => {
    let server: MockCommunicator;
    let peerA: MockCommunicator;
    let peerB: MockCommunicator;
    let relay: RollbackRelay;

    function received(peer: MockCommunicator): RollbackProtocolMessage[] {
        return peer.allMessages
            .map(m => unwrapRollbackMessage((m as { message: unknown }).message))
            .filter((m): m is RollbackProtocolMessage => m !== undefined);
    }

    beforeEach(() => {
        server = new MockCommunicator('server');
        peerA = new MockCommunicator('a');
        peerB = new MockCommunicator('b');
        const mockPeers = new Map([
            ['server', server], ['a', peerA], ['b', peerB],
        ]);
        for (const peer of mockPeers.values()) {
            peer.mockPeers = mockPeers;
            peer.peers.current.next(new Set(mockPeers.keys()));
        }
        relay = new RollbackRelay(server, { autoClock: false });
    });

    afterEach(() => {
        relay.close();
    });

    it('relays input records to the other peers and archives them', () => {
        peerA.sendMessage(wrapRollbackMessage({
            kind: 'inputs',
            record: { peerId: 'a', tick: 5, inputs: CONTROL },
        }) as never, 'server');

        const atB = received(peerB);
        expect(atB.length).toBe(1);
        expect(atB[0]).toEqual({
            kind: 'inputs',
            record: { peerId: 'a', tick: 5, inputs: CONTROL },
        });
        // The sender does not get an echo.
        expect(received(peerA).length).toBe(0);
        expect(relay.inputLog.length).toBe(1);
    });

    it('stamps the sender and clamps inputs out of the past', () => {
        relay.advanceTicks(100);
        peerA.sendMessage(wrapRollbackMessage({
            kind: 'inputs',
            // Claims to be someone else, in the past.
            record: { peerId: 'b', tick: 3, seq: 7, inputs: CONTROL },
        }) as never, 'server');

        const clamped = {
            peerId: 'a',
            tick: 101,
            seq: 7,
            inputs: CONTROL,
        };
        expect(relay.inputLog[0]).toEqual(clamped);
        // A retimed record is echoed to its sender, who applied it at
        // the stale tick and must move it to the room's tick — the
        // room and the sender otherwise fork silently (the cause of
        // the first real recorded desync).
        expect(received(peerA)).toEqual([{ kind: 'inputs', record: clamped }]);
    });

    it('holds hash comparisons until the archive hash exists', () => {
        relay.close();
        let reference: string | undefined = undefined;
        relay = new RollbackRelay(server, {
            autoClock: false,
            referenceHash: () => reference,
            desyncThreshold: 1,
        });
        // The peers disagree. Without holding, the comparison would
        // run immediately (all peers reported) and break the tie by
        // peerId — the archive's actual verdict arrives a beat later.
        peerA.sendMessage(wrapRollbackMessage({
            kind: 'stateHash', tick: 60, hash: '11111111',
        }) as never, 'server');
        peerB.sendMessage(wrapRollbackMessage({
            kind: 'stateHash', tick: 60, hash: '22222222',
        }) as never, 'server');
        expect(received(peerA).filter(m => m.kind === 'desync').length)
            .toBe(0);
        // The archive catches up; the next clock advance compares,
        // with the archive's vote breaking the tie.
        reference = '11111111';
        relay.advanceTicks(1);
        const desyncs = received(peerA).filter(m => m.kind === 'desync');
        expect(desyncs.length).toBe(1);
        expect(desyncs[0]!.kind === 'desync' && desyncs[0].canonical)
            .toBe('11111111');
    });

    it('serves a fresh baseline to fresh join requests', () => {
        relay.close();
        const empty = { entities: [], singleton: [], resources: [] };
        relay = new RollbackRelay(server, {
            autoClock: false,
            baseline: () => ({ tick: 60, snapshot: empty }),
            freshBaseline: () => ({ tick: 300, snapshot: empty }),
        });
        // Records land before the clock advances so their ticks stay
        // as stamped (a past-clock record would be clamped and echoed).
        for (const tick of [100, 250, 350]) {
            peerA.sendMessage(wrapRollbackMessage({
                kind: 'inputs',
                record: { peerId: 'a', tick, inputs: CONTROL },
            }) as never, 'server');
        }
        relay.advanceTicks(310);

        // A fresh request reconstructs from a baseline captured now:
        // only the tail after it comes along (a resync's whole point —
        // replaying a 30s-old baseline's tail is the recovery hiccup).
        peerB.allMessages.length = 0;
        peerB.sendMessage(wrapRollbackMessage({
            kind: 'joinRequest', fresh: true,
        }) as never, 'server');
        const freshReply = received(peerB).find(m => m.kind === 'catchUp');
        expect(freshReply?.kind === 'catchUp'
            && freshReply.baseline?.tick).toBe(300);
        expect(freshReply?.kind === 'catchUp'
            && freshReply.records.map(r => r.tick)).toEqual([350]);

        // A plain request gets the periodic baseline and full tail.
        peerB.allMessages.length = 0;
        peerB.sendMessage(wrapRollbackMessage({
            kind: 'joinRequest',
        }) as never, 'server');
        const plainReply = received(peerB).find(m => m.kind === 'catchUp');
        expect(plainReply?.kind === 'catchUp'
            && plainReply.baseline?.tick).toBe(60);
        expect(plainReply?.kind === 'catchUp'
            && plainReply.records.map(r => r.tick)).toEqual([100, 250, 350]);
    });

    it('refuses a join whose wire schema fingerprint differs, and serves one that matches', () => {
        const warn = spyOn(console, 'warn');
        peerB.allMessages.length = 0;
        peerB.sendMessage(wrapRollbackMessage({
            kind: 'joinRequest', schema: '0000000000000000',
        }) as never, 'server');
        const refusal = received(peerB).find(m => m.kind === 'joinRefused');
        expect(refusal?.kind === 'joinRefused' && refusal.reason)
            .toMatch(/wire schema mismatch: peer 0000000000000000, server [0-9a-f]{16}/);
        expect(received(peerB).some(m => m.kind === 'catchUp')).toBeFalse();
        expect(warn).toHaveBeenCalledWith(jasmine.stringMatching(/Refusing join of b/));

        peerB.allMessages.length = 0;
        peerB.sendMessage(wrapRollbackMessage({
            kind: 'joinRequest', schema: liveWireFingerprint(),
        }) as never, 'server');
        expect(received(peerB).some(m => m.kind === 'catchUp')).toBeTrue();
        expect(received(peerB).some(m => m.kind === 'joinRefused')).toBeFalse();
        // A joiner that sends no fingerprint (an unschema'd wire) is
        // served: the check is a comparison, not a requirement.
        peerB.allMessages.length = 0;
        peerB.sendMessage(wrapRollbackMessage({ kind: 'joinRequest' }) as never, 'server');
        expect(received(peerB).some(m => m.kind === 'catchUp')).toBeTrue();
    });

    it('serves the input log from a tick to late joiners', () => {
        for (const tick of [5, 15, 25]) {
            peerA.sendMessage(wrapRollbackMessage({
                kind: 'inputs',
                record: { peerId: 'a', tick, inputs: CONTROL },
            }) as never, 'server');
        }
        peerB.allMessages.length = 0;
        peerB.sendMessage(wrapRollbackMessage({
            kind: 'inputLogRequest', fromTick: 10,
        }) as never, 'server');

        const atB = received(peerB);
        expect(atB.length).toBe(1);
        expect(atB[0]?.kind).toBe('inputLog');
        if (atB[0]?.kind !== 'inputLog') {
            return;
        }
        expect(atB[0].records.map(r => r.tick)).toEqual([15, 25]);
    });

    it('convicts a peer after consecutive mismatched checkpoints', () => {
        relay.close();
        relay = new RollbackRelay(server, {
            autoClock: false,
            desyncThreshold: 3,
        });
        const report = (peer: MockCommunicator, tick: number, hash: string) =>
            peer.sendMessage(wrapRollbackMessage(
                { kind: 'stateHash', tick, hash }) as never, 'server');

        // Two mismatched checkpoints: below the threshold, no desync —
        // a rollback correction deeper than the settle margin briefly
        // makes honest reports describe an abandoned timeline.
        report(peerA, 60, '11111111');
        report(peerB, 60, '22222222');
        report(peerA, 120, '33333333');
        report(peerB, 120, '44444444');
        expect(received(peerA).length).toBe(0);

        // An agreeing checkpoint resets the streak...
        report(peerA, 180, '55555555');
        report(peerB, 180, '55555555');
        // ...so two more mismatches still stay quiet...
        report(peerA, 240, '66666666');
        report(peerB, 240, '77777777');
        report(peerA, 300, '88888888');
        report(peerB, 300, '99999999');
        expect(received(peerA).length).toBe(0);

        // ...but the third consecutive mismatch convicts.
        report(peerA, 360, 'aaaaaaaa');
        report(peerB, 360, 'bbbbbbbb');
        const expected: RollbackProtocolMessage = {
            kind: 'desync',
            tick: 360,
            hashes: [['a', 'aaaaaaaa'], ['b', 'bbbbbbbb']],
            canonical: 'aaaaaaaa',
        };
        expect(received(peerA)).toEqual([expected]);
        // The convicted peer also gets a dump request: the fallback
        // for a lost unprompted push (dedupe suppresses doubles).
        expect(received(peerB)).toEqual([expected,
            { kind: 'desyncDumpRequest' }]);
    });

    it('a stale reporter cannot vote but can be convicted', () => {
        relay.close();
        relay = new RollbackRelay(server, {
            autoClock: false,
            desyncThreshold: 1,
        });
        // Peer a reports promptly; peer b reports the same checkpoint
        // 500 ticks late (a throttled tab catching up). Without b's
        // vote, a's word alone is canonical, and b is convicted.
        peerA.sendMessage(wrapRollbackMessage({
            kind: 'stateHash', tick: 60, hash: '11111111',
        }) as never, 'server');
        relay.advanceTicks(500);
        peerB.sendMessage(wrapRollbackMessage({
            kind: 'stateHash', tick: 60, hash: '22222222',
        }) as never, 'server');
        const desyncs = received(peerB).filter(m => m.kind === 'desync');
        expect(desyncs).toEqual([{
            kind: 'desync',
            tick: 60,
            hashes: [['a', '11111111'], ['b', '22222222']],
            canonical: '11111111',
        }]);
    });

    it('adds the archive reference hash to desync votes', () => {
        relay.close();
        relay = new RollbackRelay(server, {
            autoClock: false,
            referenceHash: () => '11111111',
            desyncThreshold: 1,
        });
        peerA.sendMessage(wrapRollbackMessage({
            kind: 'stateHash', tick: 60, hash: '11111111',
        }) as never, 'server');
        peerB.sendMessage(wrapRollbackMessage({
            kind: 'stateHash', tick: 60, hash: '22222222',
        }) as never, 'server');
        const desyncs = received(peerB).filter(m => m.kind === 'desync');
        expect(desyncs).toEqual([{
            kind: 'desync',
            tick: 60,
            hashes: [
                ['a', '11111111'],
                ['b', '22222222'],
                // The archive's vote, under the server's identity:
                // peer a is provably the canonical one, so peer b
                // resyncs even though peers alone would be a tie.
                ['server', '11111111'],
            ],
            canonical: '11111111',
        }]);
        expect(canonicalDesyncHash(desyncs[0]!.kind === 'desync'
            ? desyncs[0].hashes : [])).toBe('11111111');
    });

    it('convicts a lone peer that disagrees with the archive', () => {
        relay.close();
        relay = new RollbackRelay(server, {
            autoClock: false,
            referenceHash: () => '11111111',
            desyncThreshold: 1,
        });
        // Only peer a reports (b is throttled or gone). The set never
        // completes, so nothing fires until the stale sweep forces
        // the comparison — where the archive is the second witness.
        peerA.sendMessage(wrapRollbackMessage({
            kind: 'stateHash', tick: 60, hash: '22222222',
        }) as never, 'server');
        expect(received(peerA).length).toBe(0);
        (relay as unknown as {
            compareStateHashes(tick: number, force: boolean): void,
        }).compareStateHashes(60, true);
        const desyncs = received(peerA).filter(m => m.kind === 'desync');
        expect(desyncs).toEqual([{
            kind: 'desync',
            tick: 60,
            hashes: [['a', '22222222'], ['server', '11111111']],
            canonical: '11111111',
        }]);
    });

    it('stays quiet when state hashes agree', () => {
        for (const peer of [peerA, peerB]) {
            peer.sendMessage(wrapRollbackMessage({
                kind: 'stateHash', tick: 60, hash: '33333333',
            }) as never, 'server');
        }
        expect(received(peerA).length).toBe(0);
        expect(received(peerB).length).toBe(0);
    });

    describe('hostile traffic', () => {
        // Raw envelopes, bypassing the typed wrapper: what a client that
        // speaks the wire format but not the contract can send.
        const raw = (peer: MockCommunicator, rollback: unknown) =>
            peer.sendMessage({ rollback } as never, 'server');

        it('drops malformed envelopes without throwing or logging them', () => {
            // The drop path's warning is rate-limited process-wide.
            resetWarnThrottle();
            const warn = spyOn(console, 'warn');
            expect(() => {
                raw(peerA, { kind: 'inputs' });
                raw(peerA, { kind: 'inputs', record: { tick: 1, inputs: null } });
                raw(peerA, { kind: 'inputs', record: { tick: 'x', inputs: [] } });
                raw(peerA, { kind: 'inputs', record: { tick: 1, inputs: [{ kind: 'control', events: null }] } });
                raw(peerA, { kind: 'stateHash', tick: 'x' });
                raw(peerA, { kind: 'stateHash', tick: 60 });
                raw(peerA, { kind: 'joinRequest', protocol: 'five' });
                raw(peerA, { kind: 'inputLogRequest' });
                raw(peerA, { kind: 'desyncDump', dump: { tick: 1 } });
                raw(peerA, { kind: 'catchUp', tick: 1, records: [] });
                raw(peerA, null);
                raw(peerA, 'inputs');
                raw(peerA, { kind: 'nope' });
            }).not.toThrow();
            expect(relay.inputLog.length).toBe(0);
            expect(received(peerB).length).toBe(0);
            expect(warn).toHaveBeenCalled();
        });

        it('strips junk fields before logging and relaying a record', () => {
            peerA.sendMessage({
                rollback: {
                    kind: 'inputs',
                    record: { tick: 5, inputs: CONTROL, junk: 'x'.repeat(100) },
                    trailer: 'y',
                },
            } as never, 'server');
            expect(relay.inputLog).toEqual([
                { peerId: 'a', tick: 5, inputs: CONTROL },
            ]);
        });

        it('ignores every message from a socket that is not in the room', () => {
            const outsider = new MockCommunicator('outsider');
            outsider.mockPeers = server.mockPeers;
            // Not added to any peer list: it never sent inRoom.
            outsider.sendMessage(wrapRollbackMessage({
                kind: 'inputs',
                record: { tick: 5, inputs: CONTROL },
            }) as never, 'server');
            outsider.sendMessage(wrapRollbackMessage({
                kind: 'joinRequest',
            }) as never, 'server');
            outsider.sendMessage(wrapRollbackMessage({
                kind: 'stateHash', tick: 60, hash: 'x',
            }) as never, 'server');
            expect(relay.inputLog.length).toBe(0);
            expect(received(peerB).length).toBe(0);
            expect(outsider.allMessages.length).toBe(0);
            expect(relay.pendingStateHashTicks).toBe(0);
        });

        it('does not retain stateHash buckets for ticks nobody else can report',
            () => {
                relay.advanceTicks(1000);
                // Far future, off-grid, and a spray of distinct values.
                for (let i = 0; i < 1000; i++) {
                    peerA.sendMessage(wrapRollbackMessage({
                        kind: 'stateHash', tick: 1_000_000 + i * 60, hash: 'x',
                    }) as never, 'server');
                    peerA.sendMessage(wrapRollbackMessage({
                        kind: 'stateHash', tick: 1001 + i * 60, hash: 'x',
                    }) as never, 'server');
                }
                expect(relay.pendingStateHashTicks).toBe(0);
                // A checkpoint just ahead of the clock (a joiner's
                // replayed hashes, clock jitter) is held, then swept.
                peerA.sendMessage(wrapRollbackMessage({
                    kind: 'stateHash', tick: 1020, hash: 'x',
                }) as never, 'server');
                expect(relay.pendingStateHashTicks).toBe(1);
                relay.advanceTicks(700);
                expect(relay.pendingStateHashTicks).toBe(0);
            });

        it('forwards a desync dump only from a peer it convicted or asked', () => {
            relay.close();
            const dumps: string[] = [];
            relay = new RollbackRelay(server, {
                autoClock: false,
                desyncThreshold: 1,
                onDesyncDump: peerId => dumps.push(peerId),
            });
            const dump = {
                tick: 100, engine: 'test', checkpoints: [], rollbackLog: [],
            };
            // Unsolicited: nobody convicted b.
            peerB.sendMessage(wrapRollbackMessage({
                kind: 'desyncDump', dump,
            }) as never, 'server');
            expect(dumps).toEqual([]);

            // b diverges and is convicted; its unprompted push lands.
            // Exactly once: the relay's request fallback is deduped by
            // the peer, and a second push is not honoured either.
            peerA.sendMessage(wrapRollbackMessage({
                kind: 'stateHash', tick: 60, hash: '11111111',
            }) as never, 'server');
            peerB.sendMessage(wrapRollbackMessage({
                kind: 'stateHash', tick: 60, hash: '22222222',
            }) as never, 'server');
            peerB.sendMessage(wrapRollbackMessage({
                kind: 'desyncDump', dump: { ...dump, desyncTick: 60 },
            }) as never, 'server');
            peerB.sendMessage(wrapRollbackMessage({
                kind: 'desyncDump', dump: { ...dump, desyncTick: 61 },
            }) as never, 'server');
            expect(dumps).toEqual(['b']);
            // The healthy peer was not asked (the archive was not
            // outvoted), so its dump is not taken either.
            peerA.sendMessage(wrapRollbackMessage({
                kind: 'desyncDump', dump,
            }) as never, 'server');
            expect(dumps).toEqual(['b']);
        });
    });

    it('broadcasts its clock', () => {
        relay.advanceTicks(42);
        // Simulate the periodic sync manually (autoClock is off).
        server.sendMessage(wrapRollbackMessage({ kind: 'tickSync', tick: relay.tick }) as never);
        const atA = received(peerA);
        expect(atA).toEqual([{ kind: 'tickSync', tick: 42 }]);
    });
});

describe('canonicalDesyncHash', () => {
    it('picks the majority hash', () => {
        expect(canonicalDesyncHash([
            ['a', 'x'], ['b', 'y'], ['c', 'x'],
        ])).toBe('x');
    });

    it('breaks ties toward the lowest peerId', () => {
        expect(canonicalDesyncHash([['b', 'y'], ['a', 'x']])).toBe('x');
        expect(canonicalDesyncHash([['a', 'x'], ['b', 'y']])).toBe('x');
    });

    it('prefers the server witness on ties', () => {
        const preferred = new Set(['server']);
        // 'a' sorts below 'server', but the archive is the log's true
        // simulation: the lone diverged peer must resync.
        expect(canonicalDesyncHash(
            [['a', 'x'], ['server', 'y']], preferred)).toBe('y');
        // Majority still beats preference.
        expect(canonicalDesyncHash(
            [['a', 'x'], ['b', 'x'], ['server', 'y']], preferred)).toBe('x');
    });
});
