import 'jasmine';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { resetWarnThrottle } from '../common/log_throttle.js';
import { SIMULATION_STEP_MS } from '../nova_plugin/make_system.js';
import { requestCatchUp } from './rollback_messages.js';
import { DesyncInfo, RollbackRelay } from './rollback_relay.js';
import { canonicalDesyncHash, PROTOCOL_VERSION, RollbackProtocolMessage, unwrapRollbackMessage, wrapRollbackMessage } from './rollback_protocol.js';
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

    it('a retime never moves a peer\'s record past its later one (#359)', () => {
        // Retimes may stack several of one peer's records on one tick
        // (the relay's clock stalls, a burst lands) — the same-tick
        // order is settled by seq where records apply — but the clamp
        // is monotonic: records that arrive in seq order with
        // non-decreasing stamps leave with non-decreasing ticks,
        // whatever the clock does in between. Here: stamps one apart,
        // the clock jumping ahead, standing still, and falling behind
        // the stamps again.
        const clockSteps = [0, 5, 0, 0, 1, 0, 3, 0, 0, 0, 0, 0, 2, 0, 0];
        for (const [seq, step] of clockSteps.entries()) {
            relay.advanceTicks(step);
            peerA.sendMessage(wrapRollbackMessage({
                kind: 'inputs',
                record: { peerId: 'a', tick: 2 + seq, seq, inputs: CONTROL },
            }) as never, 'server');
        }
        const relayed = relay.inputLog.map(record => [record.seq!, record.tick]);
        // Some were retimed, some onto a shared tick...
        expect(relayed.some(([seq, tick]) => tick !== 2 + seq)).toBeTrue();
        expect(new Set(relayed.map(([, tick]) => tick)).size)
            .toBeLessThan(relayed.length);
        // ...and none ever overtook its predecessor.
        for (let i = 1; i < relayed.length; i++) {
            expect(relayed[i]![0]).toBe(relayed[i - 1]![0]! + 1);
            expect(relayed[i]![1]).toBeGreaterThanOrEqual(relayed[i - 1]![1]!);
        }
        // B (and the archive, which replays this log) sees the same.
        const atB = received(peerB).flatMap(message =>
            message.kind === 'inputs' ? [[message.record.seq, message.record.tick]] : []);
        expect(atB).toEqual(relayed);
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
            kind: 'joinRequest', fresh: true, schema: liveWireFingerprint(),
        }) as never, 'server');
        const freshReply = received(peerB).find(m => m.kind === 'catchUp');
        expect(freshReply?.kind === 'catchUp'
            && freshReply.baseline?.tick).toBe(300);
        expect(freshReply?.kind === 'catchUp'
            && freshReply.records.map(r => r.tick)).toEqual([350]);

        // A plain request gets the periodic baseline and full tail.
        peerB.allMessages.length = 0;
        peerB.sendMessage(wrapRollbackMessage({
            kind: 'joinRequest', schema: liveWireFingerprint(),
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
    });

    it('refuses a join that omits the fingerprint: protocol 7 requires it', () => {
        const warn = spyOn(console, 'warn');
        peerB.allMessages.length = 0;
        peerB.sendMessage(wrapRollbackMessage({
            kind: 'joinRequest', protocol: PROTOCOL_VERSION,
        }) as never, 'server');
        const refusal = received(peerB).find(m => m.kind === 'joinRefused');
        expect(refusal?.kind === 'joinRefused' && refusal.reason).toMatch(
            /wire schema fingerprint missing: protocol \d+ requires joinRequest\.schema \(server [0-9a-f]{16}\)/);
        expect(received(peerB).some(m => m.kind === 'catchUp')).toBeFalse();
        expect(warn).toHaveBeenCalledWith(jasmine.stringMatching(
            /Refusing join of b: wire schema fingerprint missing/));
    });

    describe('system order (#155)', () => {
        const ROOM = '00000000000000aa';
        const OTHER = '00000000000000bb';

        function join(peer: MockCommunicator, systems: string) {
            peer.allMessages.length = 0;
            peer.sendMessage(wrapRollbackMessage({
                kind: 'joinRequest', schema: liveWireFingerprint(), systems,
            }) as never, 'server');
            return received(peer);
        }
        const mismatchWarnings = (warn: jasmine.Spy) => warn.calls.allArgs()
            .filter(([text]) => /system order mismatch/.test(String(text)));

        it('the first joiner defines the room\'s order; a matching joiner is not warned', () => {
            const warn = spyOn(console, 'warn');
            expect(join(peerA, ROOM).map(m => m.kind)).toEqual(['catchUp']);
            expect(join(peerB, ROOM).map(m => m.kind)).toEqual(['catchUp']);
            expect(mismatchWarnings(warn)).toEqual([]);
        });

        it('warns once per mismatching join, tells the joiner, and still serves it', () => {
            const warn = spyOn(console, 'warn');
            join(peerA, ROOM);
            const atB = join(peerB, OTHER);
            // Warned, not refused: the catch-up follows the warning.
            expect(atB.map(m => m.kind)).toEqual(['joinWarning', 'catchUp']);
            expect(atB[0]!.kind === 'joinWarning' && atB[0].reason).toBe(
                `system order mismatch: peer ${OTHER}, room ${ROOM} (the room's `
                + 'first declaration); the simulations run their systems in '
                + 'different orders and will desync');
            expect(received(peerA).some(m => m.kind === 'joinWarning')).toBeFalse();
            expect(mismatchWarnings(warn)).toEqual([[jasmine.stringMatching(
                new RegExp(`^Peer b joined with a system order mismatch: peer ${OTHER}, room ${ROOM}`))]]);
            // A resync is another join: one more warning, no more.
            join(peerB, OTHER);
            expect(mismatchWarnings(warn).length).toBe(2);
            // The room's reference is the FIRST declaration, not the
            // latest: a's rejoin is still clean.
            expect(join(peerA, ROOM).map(m => m.kind)).toEqual(['catchUp']);
            expect(mismatchWarnings(warn).length).toBe(2);
        });

        it('a joining client declares its hash and logs the relay\'s warning', async () => {
            const warn = spyOn(console, 'warn');
            join(peerA, ROOM);
            peerB.allMessages.length = 0;
            const catchUp = await requestCatchUp(peerB,
                { timeoutMs: 1000, fresh: false, systems: OTHER }, () => { });
            // Warned, and joined all the same.
            expect(catchUp?.kind).toBe('catchUp');
            expect(warn).toHaveBeenCalledWith(
                `The relay warned about this join: system order mismatch: `
                + `peer ${OTHER}, room ${ROOM} (the room's first declaration); `
                + 'the simulations run their systems in different orders '
                + 'and will desync');
        });

        it('stamps the room\'s and each reporter\'s hash into the incident', () => {
            relay.close();
            const incidents: DesyncInfo[] = [];
            relay = new RollbackRelay(server, {
                autoClock: false, desyncThreshold: 1,
                onDesync: info => incidents.push(info),
            });
            spyOn(console, 'warn');
            spyOn(console, 'log');
            join(peerA, ROOM);
            join(peerB, OTHER);
            peerA.sendMessage(wrapRollbackMessage({
                kind: 'stateHash', tick: 60, hash: '11111111',
            }) as never, 'server');
            peerB.sendMessage(wrapRollbackMessage({
                kind: 'stateHash', tick: 60, hash: '22222222',
            }) as never, 'server');
            expect(incidents.length).toBe(1);
            expect(incidents[0]!.roomSystemOrder).toBe(ROOM);
            expect(incidents[0]!.peerSystemOrders).toEqual({ a: ROOM, b: OTHER });
        });

        it('forgets the room\'s order when the room empties, not before', () => {
            const warn = spyOn(console, 'warn');
            join(peerA, ROOM);
            // The first joiner leaving does not reset a live room.
            server.peers.current.next(new Set(['server', 'b']));
            join(peerB, OTHER);
            expect(mismatchWarnings(warn).length).toBe(1);
            // Empty: the next first joiner defines the order afresh.
            server.peers.current.next(new Set(['server']));
            server.peers.current.next(new Set(['server', 'a', 'b']));
            expect(join(peerB, OTHER).map(m => m.kind)).toEqual(['catchUp']);
            expect(join(peerA, ROOM).map(m => m.kind))
                .toEqual(['joinWarning', 'catchUp']);
            expect(mismatchWarnings(warn).length).toBe(2);
        });
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

    describe('one client against the archive (#374)', () => {
        // Ruling of 2026-11-23: with exactly two voices, one client and
        // the server's archive, the client is never convicted. In the
        // nova:282 incident the archive itself had diverged from its
        // own log and convicted an honest client.
        let incidents: DesyncInfo[];
        let outvoted: number[];
        const force = (tick: number) => (relay as unknown as {
            compareStateHashes(tick: number, force: boolean): void,
        }).compareStateHashes(tick, true);
        const report = (peer: MockCommunicator, tick: number, hash: string) =>
            peer.sendMessage(wrapRollbackMessage(
                { kind: 'stateHash', tick, hash }) as never, 'server');

        function makeRelay(desyncThreshold: number) {
            relay.close();
            incidents = [];
            outvoted = [];
            relay = new RollbackRelay(server, {
                autoClock: false,
                referenceHash: () => '11111111',
                desyncThreshold,
                onDesync: info => incidents.push(info),
                onArchiveOutvoted: tick => outvoted.push(tick),
            });
        }

        it('trusts the client: the archive is outvoted and nobody resyncs', () => {
            makeRelay(1);
            // Only peer a reports (b is throttled or gone). The set
            // never completes, so nothing fires until the stale sweep
            // forces the comparison, with the archive as the only
            // other voice.
            report(peerA, 60, '22222222');
            expect(received(peerA).length).toBe(0);
            force(60);
            const desyncs = received(peerA).filter(m => m.kind === 'desync');
            // The client's hash is canonical: a sees its own hash
            // there and does not resync.
            expect(desyncs).toEqual([{
                kind: 'desync',
                tick: 60,
                hashes: [['a', '22222222'], ['server', '11111111']],
                canonical: '22222222',
            }]);
            // The archive is the outvoted party: the loud path, an
            // incident for the analyzer, and a's state as the reference
            // (one dump request, to a, as the healthy peer).
            expect(outvoted).toEqual([60]);
            expect(incidents.length).toBe(1);
            expect(incidents[0]!.archiveOutvoted).toBeTrue();
            expect(incidents[0]!.convicted).toEqual(['server']);
            expect(received(peerA).filter(
                m => m.kind === 'desyncDumpRequest').length).toBe(1);
        });

        it('never convicts the client however long the disagreement lasts', () => {
            makeRelay(3);
            for (let tick = 60; tick <= 600; tick += 60) {
                report(peerA, tick, `2222${tick.toString(16).padStart(4, '0')}`);
                force(tick);
            }
            for (const message of received(peerA)) {
                if (message.kind === 'desync') {
                    expect(message.canonical).toBe(message.hashes
                        .find(([peerId]) => peerId === 'a')![1]);
                }
            }
            expect(incidents.every(info =>
                !info.convicted.includes('a'))).toBeTrue();
            // The archive's own streak still reaches the threshold:
            // the incident is recorded.
            expect(incidents.length).toBeGreaterThan(0);
        });

        it('trusts a lone client whose report is late, too', () => {
            makeRelay(1);
            // A throttled solo tab: its report is stale (no vote), but
            // the comparison is still one client against the archive.
            relay.advanceTicks(500);
            report(peerA, 60, '22222222');
            force(60);
            const desyncs = received(peerA).filter(m => m.kind === 'desync');
            expect(desyncs.length).toBe(1);
            expect(desyncs[0]!.kind === 'desync'
                && desyncs[0].canonical).toBe('22222222');
            expect(incidents[0]!.convicted).toEqual(['server']);
        });

        it('keeps the majority vote with a second client: two against one convicts', () => {
            makeRelay(1);
            // b agrees with the archive: a is outvoted two to one.
            report(peerA, 60, '22222222');
            report(peerB, 60, '11111111');
            const desyncs = received(peerA).filter(m => m.kind === 'desync');
            expect(desyncs.length).toBe(1);
            expect(desyncs[0]!.kind === 'desync'
                && desyncs[0].canonical).toBe('11111111');
            expect(incidents[0]!.convicted).toEqual(['a']);
            expect(outvoted).toEqual([]);
        });

        it('keeps the old rule when a third party reported late: the archive breaks the timely tie', () => {
            makeRelay(1);
            // a reports in time; b's report of the same checkpoint is
            // stale (no vote) but makes three parties, so this is not
            // one client against the archive. The timely voters (a and
            // the archive) tie, and the tie goes to the archive, which
            // b's late report agrees with.
            report(peerA, 60, '22222222');
            relay.advanceTicks(500);
            report(peerB, 60, '11111111');
            const desyncs = received(peerA).filter(m => m.kind === 'desync');
            expect(desyncs.length).toBe(1);
            expect(desyncs[0]!.kind === 'desync'
                && desyncs[0].canonical).toBe('11111111');
            expect(incidents[0]!.convicted).toEqual(['a']);
        });
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

    describe('unanimous 2x room speed vote (#371)', () => {
        const vote = (peer: MockCommunicator, wantFast: boolean, inSpace = true) =>
            peer.sendMessage(wrapRollbackMessage({
                kind: 'speedVote', wantFast, inSpace,
            }) as never, 'server');

        const speedNotices = (peer: MockCommunicator) =>
            received(peer).filter(
                (m): m is Extract<RollbackProtocolMessage, { kind: 'roomSpeed' }> =>
                    m.kind === 'roomSpeed');

        it('advances 2 ticks/step only when all in-space voters want it', () => {
            // Default 1x: 10 steps -> 10 ticks.
            expect(relay.stepClock(SIMULATION_STEP_MS * 10)).toBe(10);
            expect(relay.tick).toBe(10);
            expect(relay.speed).toBe(1);

            // Only peer A votes yes: room stays at 1x, broadcasts tally.
            vote(peerA, true, true);
            expect(relay.speedState).toEqual({
                speed: 1, atTick: 0, fastVotes: 1, totalVoters: 2,
            });
            expect(speedNotices(peerA)).toEqual([{
                kind: 'roomSpeed', tick: 10, speed: 1, atTick: 0,
                fastVotes: 1, totalVoters: 2,
            }]);
            expect(relay.stepClock(SIMULATION_STEP_MS * 5)).toBe(5);
            expect(relay.tick).toBe(15);

            // Peer B also votes yes: switches to 2x at the next tick boundary (16).
            peerA.allMessages.length = 0;
            peerB.allMessages.length = 0;
            vote(peerB, true, true);
            const expected = {
                kind: 'roomSpeed' as const, tick: 15, speed: 2 as const,
                atTick: 16, fastVotes: 2, totalVoters: 2,
            };
            expect(speedNotices(peerA)).toEqual([expected]);
            expect(speedNotices(peerB)).toEqual([expected]);

            // First step crosses boundary 15 -> 16 at 1x, activating 2x.
            expect(relay.stepClock(SIMULATION_STEP_MS)).toBe(1);
            expect(relay.tick).toBe(16);
            expect(relay.speed).toBe(2);

            // Subsequent steps advance 2 ticks per stepMs.
            expect(relay.stepClock(SIMULATION_STEP_MS * 10)).toBe(20);
            expect(relay.tick).toBe(36);

            // One "no" drops back to 1x at the next tick boundary (37).
            peerA.allMessages.length = 0;
            vote(peerA, false, true);
            expect(speedNotices(peerA)).toEqual([{
                kind: 'roomSpeed', tick: 36, speed: 1, atTick: 37,
                fastVotes: 1, totalVoters: 2,
            }]);
            // Cross boundary 36 -> 37 (0.5 stepMs at 2x), leaving 0.5 stepMs debt;
            // then 10 more stepMs at 1x -> 10 ticks (total 11 ticks across 11 stepMs).
            expect(relay.stepClock(SIMULATION_STEP_MS)).toBe(1);
            expect(relay.tick).toBe(37);
            expect(relay.speed).toBe(1);
            expect(relay.stepClock(SIMULATION_STEP_MS * 10)).toBe(10);
            expect(relay.tick).toBe(47);
        });

        it('gives a solo player in space 2x immediately on Caps Lock', () => {
            // Peer B leaves, leaving peer A alone in space.
            server.peers.current.next(new Set(['server', 'a']));
            peerA.allMessages.length = 0;
            vote(peerA, true, true);
            expect(speedNotices(peerA)).toEqual([{
                kind: 'roomSpeed', tick: 0, speed: 2, atTick: 1,
                fastVotes: 1, totalVoters: 1,
            }]);
            relay.stepClock(SIMULATION_STEP_MS); // 0 -> 1 (activates 2x)
            expect(relay.speed).toBe(2);
            expect(relay.stepClock(SIMULATION_STEP_MS * 5)).toBe(10);
        });

        it('ignores a landed player\'s vote and returns to 1x when nobody is in space', () => {
            // Peer A wants 2x in space; peer B is landed without Caps Lock -> unanimous 2x!
            vote(peerA, true, true);
            vote(peerB, false, false);
            expect(relay.speedState).toEqual({
                speed: 2, atTick: 1, fastVotes: 1, totalVoters: 1,
            });
            relay.stepClock(SIMULATION_STEP_MS); // activate 2x at tick 1
            expect(relay.speed).toBe(2);
            expect(relay.stepClock(SIMULATION_STEP_MS * 4)).toBe(8);

            // Landed peer B toggling Caps Lock changes nothing.
            peerA.allMessages.length = 0;
            vote(peerB, true, false);
            vote(peerB, false, false);
            expect(speedNotices(peerA)).toEqual([]);
            expect(relay.speed).toBe(2);

            // Peer A also lands -> nobody in space -> default returns room to 1x.
            vote(peerA, true, false);
            expect(relay.speedState).toEqual({
                speed: 1, atTick: 10, fastVotes: 0, totalVoters: 0,
            });
            relay.stepClock(SIMULATION_STEP_MS); // crosses tick 10 -> 1x
            expect(relay.speed).toBe(1);
            expect(relay.stepClock(SIMULATION_STEP_MS * 5)).toBe(5);
        });

        it('drops a 2x room back to 1x at the next tick boundary when a newcomer joins without Caps Lock', () => {
            vote(peerA, true, true);
            vote(peerB, true, true);
            relay.stepClock(SIMULATION_STEP_MS * 2); // tick 3, active 2x
            expect(relay.speed).toBe(2);
            const beforeJoin = relay.tick;
            peerA.allMessages.length = 0;

            // Peer C enters the room channel (pendingJoinPeers) and then sends
            // joinRequest without Caps Lock (no speedVote / wantFast: false).
            const peerC = new MockCommunicator('c');
            const mockPeers = new Map([
                ['server', server], ['a', peerA], ['b', peerB], ['c', peerC],
            ]);
            for (const peer of mockPeers.values()) {
                peer.mockPeers = mockPeers;
            }
            server.peers.current.next(new Set(['server', 'a', 'b', 'c']));
            // While C is still loading (before joinRequest), the room stays 2x.
            expect(speedNotices(peerA)).toEqual([]);
            expect(relay.speed).toBe(2);

            peerC.allMessages.length = 0;
            peerC.sendMessage(wrapRollbackMessage({
                kind: 'joinRequest', schema: liveWireFingerprint(),
            }) as never, 'server');

            expect(speedNotices(peerA)).toEqual([{
                kind: 'roomSpeed', tick: beforeJoin, speed: 1,
                atTick: beforeJoin + 1, fastVotes: 2, totalVoters: 3,
            }]);
            // A joiner's catchUp carries the room's updated speed state.
            const catchUp = received(peerC).find(m => m.kind === 'catchUp');
            expect(catchUp?.kind === 'catchUp' && catchUp.roomSpeed).toEqual({
                speed: 1, atTick: beforeJoin + 1, fastVotes: 2, totalVoters: 3,
            });
            relay.stepClock(SIMULATION_STEP_MS); // crosses boundary -> 1x
            expect(relay.speed).toBe(1);
            expect(relay.stepClock(SIMULATION_STEP_MS * 6)).toBe(6);
        });

        it('never flips a 2x room to 1x when a joiner arrives with Caps Lock already on', () => {
            vote(peerA, true, true);
            vote(peerB, true, true);
            relay.stepClock(SIMULATION_STEP_MS * 2); // tick 3, active 2x
            expect(relay.speed).toBe(2);
            peerA.allMessages.length = 0;

            // Peer C joins the room channel, spends 150ms loading makeSystem,
            // then sends joinRequest carrying speedVote { wantFast: true, inSpace: true }.
            const peerC = new MockCommunicator('c');
            const mockPeers = new Map([
                ['server', server], ['a', peerA], ['b', peerB], ['c', peerC],
            ]);
            for (const peer of mockPeers.values()) {
                peer.mockPeers = mockPeers;
            }
            server.peers.current.next(new Set(['server', 'a', 'b', 'c']));
            // Simulated 150ms loading window before joinRequest: still 2x!
            expect(relay.stepClock(SIMULATION_STEP_MS * 9)).toBe(18);
            expect(relay.speed).toBe(2);
            expect(speedNotices(peerA)).toEqual([]);

            peerC.allMessages.length = 0;
            peerC.sendMessage(wrapRollbackMessage({
                kind: 'joinRequest',
                schema: liveWireFingerprint(),
                speedVote: { wantFast: true, inSpace: true },
            }) as never, 'server');

            // Room stayed at 2x the entire time (zero speed: 1 broadcasts).
            expect(relay.speed).toBe(2);
            expect(speedNotices(peerA).some(n => n.speed === 1)).toBeFalse();
            expect(speedNotices(peerA)).toEqual([{
                kind: 'roomSpeed', tick: relay.tick, speed: 2,
                atTick: 1, fastVotes: 3, totalVoters: 3,
            }]);
            const catchUp = received(peerC).find(m => m.kind === 'catchUp');
            expect(catchUp?.kind === 'catchUp' && catchUp.roomSpeed).toEqual({
                speed: 2, atTick: 1, fastVotes: 3, totalVoters: 3,
            });
        });

        it('excludes pendingJoinPeers when another peer\'s vote triggers recomputeSpeed (#371)', () => {
            // Peer A votes yes; peer B has not voted yes yet -> 1x (1 of 2).
            vote(peerA, true, true);
            expect(relay.speedState).toEqual({
                speed: 1, atTick: 0, fastVotes: 1, totalVoters: 2,
            });

            // Peer C enters the room channel (pendingJoinPeers) and has not
            // sent joinRequest yet.
            const peerC = new MockCommunicator('c');
            const mockPeers = new Map([
                ['server', server], ['a', peerA], ['b', peerB], ['c', peerC],
            ]);
            for (const peer of mockPeers.values()) {
                peer.mockPeers = mockPeers;
            }
            server.peers.current.next(new Set(['server', 'a', 'b', 'c']));

            // While C is still pending its join, peer B votes yes -> triggers
            // recomputeSpeed(). Pending C must be excluded so A+B reach 2 of 2
            // and schedule 2x instead of being stalled at 2 of 3.
            peerA.allMessages.length = 0;
            vote(peerB, true, true);
            expect(relay.speedState).toEqual({
                speed: 2, atTick: 1, fastVotes: 2, totalVoters: 2,
            });
            expect(speedNotices(peerA)).toEqual([{
                kind: 'roomSpeed', tick: 0, speed: 2, atTick: 1,
                fastVotes: 2, totalVoters: 2,
            }]);

            // Once C sends joinRequest without Caps Lock, C leaves
            // pendingJoinPeers and drops the room back to 1x (2 of 3).
            relay.stepClock(SIMULATION_STEP_MS); // tick 1, active 2x
            expect(relay.speed).toBe(2);
            peerC.sendMessage(wrapRollbackMessage({
                kind: 'joinRequest', schema: liveWireFingerprint(),
            }) as never, 'server');
            expect(relay.speedState).toEqual({
                speed: 1, atTick: 2, fastVotes: 2, totalVoters: 3,
            });
        });

        it('switches to 2x when the sole holdout leaves the room', () => {
            vote(peerA, true, true);
            expect(relay.speedState.speed).toBe(1);
            peerA.allMessages.length = 0;

            server.peers.current.next(new Set(['server', 'a']));
            expect(speedNotices(peerA)).toEqual([{
                kind: 'roomSpeed', tick: 0, speed: 2, atTick: 1,
                fastVotes: 1, totalVoters: 1,
            }]);
        });

        it('drops malformed speedVote messages and votes from non-members', () => {
            resetWarnThrottle();
            const outsider = new MockCommunicator('outsider');
            outsider.mockPeers = server.mockPeers;
            outsider.sendMessage(wrapRollbackMessage({
                kind: 'speedVote', wantFast: true, inSpace: true,
            }) as never, 'server');
            peerA.sendMessage({
                rollback: { kind: 'speedVote', wantFast: 'yes', inSpace: true },
            } as never, 'server');
            expect(relay.speedState.fastVotes).toBe(0);
            expect(relay.speedState.speed).toBe(1);
        });

        it('scales TIMELY_REPORT_TICKS and STATE_HASH_SWEEP_TICKS at 2x (R1)', () => {
            relay.close();
            relay = new RollbackRelay(server, {
                autoClock: false,
                desyncThreshold: 1,
            });
            // Switch room to 2x.
            vote(peerA, true, true);
            vote(peerB, true, true);
            relay.stepClock(SIMULATION_STEP_MS); // tick 1, active 2x
            expect(relay.speed).toBe(2);

            // At 2x, 300 ticks is 2.5s wall time (< 4s timely window = 480
            // ticks at 2x), so peer B's report arriving 300 ticks after tick
            // 60 is STILL timely and votes (unlike at 1x where > 240 is stale).
            // With both A and B timely, tie-break picks lower peerId ('a')
            // when A disagrees with B; test the reverse by having B report
            // early and A report 300 ticks late: if A is timely, A wins tie-break!
            peerB.sendMessage(wrapRollbackMessage({
                kind: 'stateHash', tick: 60, hash: 'bbbbbbbb',
            }) as never, 'server');
            relay.advanceTicks(360); // relay.tick = 361 (301 ticks past 60)
            peerA.sendMessage(wrapRollbackMessage({
                kind: 'stateHash', tick: 60, hash: 'aaaaaaaa',
            }) as never, 'server');
            const desyncs = received(peerB).filter(m => m.kind === 'desync');
            expect(desyncs.length).toBe(1);
            // Because A was still timely at 2x (301 <= 480), A voted and won
            // the tie-break over B; at 1x A would have been stale (> 240) and
            // B would have won alone.
            expect(desyncs[0]!.kind === 'desync' && desyncs[0].canonical)
                .toBe('aaaaaaaa');

            // Sweep window at 2x is 1200 ticks (10s wall time), not 600.
            // Report an incomplete bucket for tick 420 (only peerA reports).
            peerA.sendMessage(wrapRollbackMessage({
                kind: 'stateHash', tick: 420, hash: 'cccccccc',
            }) as never, 'server');
            expect(relay.pendingStateHashTicks).toBe(1);
            // 700 ticks past 420 (tick 1120): swept at 1x, still held at 2x.
            relay.advanceTicks(1120 - relay.tick);
            expect(relay.pendingStateHashTicks).toBe(1);
            // 1201 ticks past 420 (tick 1621): swept at 2x.
            relay.advanceTicks(1621 - relay.tick);
            expect(relay.pendingStateHashTicks).toBe(0);
        });

        it('caps a single stepClock catch-up burst to 600 ticks at 2x (never 1200)', () => {
            vote(peerA, true, true);
            vote(peerB, true, true);
            relay.stepClock(SIMULATION_STEP_MS); // tick 1, active 2x
            expect(relay.speed).toBe(2);

            // Simulate a 30-second server stall at 2x.
            const advanced = relay.stepClock(30_000);
            expect(advanced).toBe(600);
            expect(relay.tick).toBe(601);
        });

        it('rate-limits and coalesces rapid speedVote floods per peer (last one wins)', () => {
            jasmine.clock().install();
            try {
                let fakeNow = 1000;
                relay.close();
                relay = new RollbackRelay(server, {
                    autoClock: false,
                    speedVoteRefillMs: 250,
                    now: () => fakeNow,
                });
                // Peer A stays "yes" so every peer B toggle flips the room.
                vote(peerA, true, true);
                peerA.allMessages.length = 0;

                // Peer B floods 10 alternating votes at the same instant:
                // burst (3) applies immediately, votes 4..10 coalesce to the
                // final value (false) and apply once after refill.
                for (let i = 0; i < 10; i++) {
                    vote(peerB, i % 2 === 0, true);
                }
                const immediate = speedNotices(peerA);
                expect(immediate.length).toBe(3);
                expect(immediate.map(n => n.speed)).toEqual([2, 1, 2]);
                expect(relay.speedState.speed).toBe(2);

                // After 250ms, the coalesced trailing vote (i=9 -> false) lands.
                peerA.allMessages.length = 0;
                fakeNow += 250;
                jasmine.clock().tick(250);
                expect(speedNotices(peerA).length).toBe(1);
                expect(relay.speedState.speed).toBe(1);
                expect(relay.speedState.fastVotes).toBe(1);
            } finally {
                jasmine.clock().uninstall();
            }
        });
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
