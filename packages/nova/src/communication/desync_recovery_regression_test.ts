import 'jasmine';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { CommunicatorResource } from 'nova_ecs/plugins/multiplayer_plugin';
import { SerializerPlugin } from 'nova_ecs/plugins/serializer_plugin';
import { SnapshotPolicies, SnapshotPoliciesResource } from 'nova_ecs/plugins/snapshot_plugin';
import { TimePlugin, TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { RollbackRelay } from './rollback_relay.js';
import { PROTOCOL_VERSION, unwrapRollbackMessage, wrapRollbackMessage } from './rollback_protocol.js';
import { RoomArchive } from './room_archive.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { liveWireFingerprint } from './wire_schemas.js';

function makeFakeSimulationData() {
    return {
        ids: Promise.resolve({} as never),
        data: {
            Ship: {
                getCached: () => undefined,
            },
        },
    } as never;
}

function makeTimedWorld(communicator: MockCommunicator): World {
    const world = new World('desync regression test world');
    world.addPlugin(SerializerPlugin);
    world.addPlugin(TimePlugin);
    const policies = new SnapshotPolicies();
    const time = world.resources.get(TimeResource)!;
    policies.addResource({
        name: 'time',
        save: () => ({ ...time }),
        restore: saved => Object.assign(time, saved as object),
    });
    world.resources.set(SnapshotPoliciesResource, policies);
    world.resources.set(CommunicatorResource, communicator);
    return world;
}

class TrackingResyncHost extends SimulationBridgeHost {
    resyncStarted = 0;
    protected override async reconstructFromRoom(): Promise<boolean> {
        // Hold the resync open briefly (mimicking an async network join).
        await new Promise(resolve => setTimeout(resolve, 20));
        return true;
    }
    override async resync(force = false): Promise<boolean> {
        const before = this.lastResyncTime;
        const promise = super.resync(force);
        if (this.lastResyncTime !== before) {
            this.resyncStarted++;
        }
        return promise;
    }
}

/**
 * Gemini Neon's review of the 2026-11-27 nova:129 desyncs (after the relay
 * confirmation fix): the archive's catch-up blocking the server's event
 * loop, the relay answering on a clock a stall behind, a retimed echo of
 * a record past the rollback ring going unnoticed, and a resync started
 * inside step() stepping the genesis world it had just restored.
 */
describe('Desync incident 2026-11-27 regressions', () => {
    it('triggers retimeTooOld resync even after a sent record ages past rollback.earliestTick', async () => {
        const communicator = new MockCommunicator('peer-a');
        const world = makeTimedWorld(communicator);
        const host = new TrackingResyncHost(world, makeFakeSimulationData(), {
            resyncCooldownMs: 0,
            resyncJoinTimeoutMs: 50,
            resyncMaxAttempts: 1,
            resyncRetryMs: 0,
        });

        // Send a control input at tick 1 (seq 0), then step past the 240-tick
        // rollback horizon so tick 1 is older than rollback.earliestTick.
        // No relay clock confirms anything here (no tickSync), so step()
        // does not hold for the echo; with one, it holds before the record
        // leaves the ring (input_room_integration_test, 320-tick uplink).
        host.controlEvents([{ action: 'turnLeft', state: 'start' }]);
        host.step(260);
        expect(host.resyncStarted).toBe(0);

        // Now the relay's retimed echo for seq 0 arrives late (after the local
        // application at tick 1 fell off the rollback ring buffer). This is a
        // guaranteed fork and must trigger retimeTooOld -> resync, not be
        // silently ignored because sentRecords prematurely evicted seq 0.
        communicator.messages.next({
            source: 'server',
            message: wrapRollbackMessage({
                kind: 'inputs',
                record: {
                    peerId: 'peer-a',
                    tick: 270,
                    seq: 0,
                    inputs: [{ kind: 'control', events: [{ action: 'turnLeft', state: 'start' }] }],
                },
            }),
        });
        host.step(1);

        expect(host.resyncStarted).toBe(1);
    });

    it('ignores retimed echoes from before a resync catch-up without re-triggering resync', async () => {
        const server = new MockCommunicator('server');
        const peerA = new MockCommunicator('peer-a');
        const peers = new Map([['server', server], ['peer-a', peerA]]);
        for (const p of peers.values()) {
            p.mockPeers = peers;
            p.peers.current.next(new Set(peers.keys()));
        }
        const relay = new RollbackRelay(server, { autoClock: false });
        try {
            const world = makeTimedWorld(peerA);
            const host = new SimulationBridgeHost(world, makeFakeSimulationData(), {
                resyncCooldownMs: 0,
            });
            // Send seq 0 before joining/resyncing.
            host.controlEvents([{ action: 'turnLeft', state: 'start' }]);
            host.step(1);

            // Reconstruct from the room: catch-up already includes everything
            // published before this point.
            expect(await host.joinRoom(1000)).toBeTrue();

            const resyncSpy = spyOn(host, 'resync').and.callThrough();
            // A stale echo for seq 0 from before the catch-up arrives now.
            peerA.messages.next({
                source: 'server',
                message: wrapRollbackMessage({
                    kind: 'inputs',
                    record: {
                        peerId: 'peer-a',
                        tick: 50,
                        seq: 0,
                        inputs: [{ kind: 'control', events: [{ action: 'turnLeft', state: 'start' }] }],
                    },
                }),
            });
            host.step(1);
            expect(resyncSpy).not.toHaveBeenCalled();
        } finally {
            relay.close();
        }
    });

    it('does not step the fresh genesis world when lateRecord starts a resync inside step()', () => {
        const communicator = new MockCommunicator('peer-a');
        const world = makeTimedWorld(communicator);
        const host = new TrackingResyncHost(world, makeFakeSimulationData(), {
            resyncCooldownMs: 0,
            resyncJoinTimeoutMs: 50,
            resyncMaxAttempts: 1,
            resyncRetryMs: 0,
        });

        host.step(260);
        // Queue a local input AND deliver a late remote record behind the
        // rollback horizon. Calling step(5) will trigger resync() inside
        // integrateRemoteInputs().
        host.controlEvents([{ action: 'accelerate', state: 'start' }]);
        communicator.messages.next({
            source: 'server',
            message: wrapRollbackMessage({
                kind: 'inputs',
                record: {
                    peerId: 'peer-b',
                    tick: 5,
                    inputs: [{ kind: 'setTarget', target: null }],
                },
            }),
        });

        const sentRecords: unknown[] = [];
        const origSend = communicator.sendMessage.bind(communicator);
        communicator.sendMessage = (msg, dest) => {
            const m = unwrapRollbackMessage(msg);
            if (m?.kind === 'inputs') {
                sentRecords.push(m.record);
            }
            origSend(msg, dest);
        };

        host.step(5);

        expect(host.resyncStarted).toBe(1);
        // The genesis world restored by resync() must stay at tick 0 while
        // resyncing is in flight — never stepped to tick 1..5, and no local
        // inputs published against the abandoned genesis timeline.
        expect(host.status().tick).toBe(0);
        expect(sentRecords).toEqual([]);
    });

    it('catches up RollbackRelay wall clock before answering joinRequest or stamping removePeer after a stall', () => {
        const server = new MockCommunicator('server');
        const peerA = new MockCommunicator('a');
        const peerB = new MockCommunicator('b');
        const peers = new Map([['server', server], ['a', peerA], ['b', peerB]]);
        for (const p of peers.values()) {
            p.mockPeers = peers;
            p.peers.current.next(new Set(peers.keys()));
        }

        let fakeNow = 10_000;
        const relay = new RollbackRelay(server, {
            autoClock: true,
            now: () => fakeNow,
        });
        try {
            // Put the room at 2x speed (peer A in space with Caps Lock, peer B landed).
            peerA.sendMessage(wrapRollbackMessage({
                kind: 'speedVote', wantFast: true, inSpace: true,
            }) as never, 'server');
            peerB.sendMessage(wrapRollbackMessage({
                kind: 'speedVote', wantFast: false, inSpace: false,
            }) as never, 'server');
            relay.advanceTicks(1);
            expect(relay.speed).toBe(2);

            // Simulate a 2-second event-loop stall: wall time advances 2000ms
            // (240 ticks at 2x), and queued I/O (joinRequest + peer leave) runs
            // BEFORE clockInterval fires.
            fakeNow += 2000;

            peerB.allMessages.length = 0;
            peerB.sendMessage(wrapRollbackMessage({
                kind: 'joinRequest',
                protocol: PROTOCOL_VERSION,
                fresh: true,
                schema: liveWireFingerprint(),
                speedVote: { wantFast: false, inSpace: false },
            }) as never, 'server');

            const catchUp = peerB.allMessages
                .map(m => unwrapRollbackMessage((m as { message: unknown }).message))
                .find(m => m?.kind === 'catchUp');
            expect(catchUp?.kind).toBe('catchUp');
            if (catchUp?.kind === 'catchUp') {
                // Must reflect the elapsed 2000ms (~240 ticks at 2x), not the
                // pre-stall tick 1.
                expect(catchUp.tick).toBeGreaterThanOrEqual(235);
            }

            // Another 500ms stall before peer A leaves: removePeer must be
            // stamped at the caught-up wall-clock tick, not the pre-stall tick.
            const tickBeforeLeaveStall = relay.tick;
            fakeNow += 500;
            server.peers.current.next(new Set(['server', 'b']));
            const removeRecord = relay.inputLog.find(r =>
                r.inputs.some(i => i.kind === 'removePeer'));
            expect(removeRecord).toBeDefined();
            expect(removeRecord!.tick).toBeGreaterThanOrEqual(tickBeforeLeaveStall + 55);
        } finally {
            relay.close();
        }
    });

    it('yields between tick chunks in RoomArchive.update() so the event loop is not blocked', async () => {
        const server = new MockCommunicator('server');
        const relay = new RollbackRelay(server, { autoClock: false });
        const archive = new RoomArchive(relay, async () => {
            const world = new World('chunked archive test');
            world.addPlugin(SerializerPlugin);
            world.addPlugin(TimePlugin);
            return world;
        }, { autoUpdate: false });

        try {
            // Initialize archive world at tick 0.
            await archive.update();
            expect(archive.tick).toBe(0);

            // Advance relay by 60 ticks and start an archive catch-up.
            relay.advanceTicks(60);
            const updatePromise = archive.update();

            // A callback queued on the event loop must run mid-update (after a
            // chunk, before all 60 ticks finish), proving update() yielded.
            const tickWhenEventLoopRan = await new Promise<number>(resolve => {
                setImmediate(() => resolve(archive.tick));
            });
            await updatePromise;

            expect(archive.tick).toBe(60);
            expect(tickWhenEventLoopRan).toBeGreaterThan(0);
            expect(tickWhenEventLoopRan).toBeLessThan(60);
        } finally {
            archive.close();
            relay.close();
        }
    });
});
