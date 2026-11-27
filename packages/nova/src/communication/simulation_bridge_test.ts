import 'jasmine';
import * as t from 'io-ts';
import { Emit } from 'nova_ecs/arg_types';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { CommunicatorResource } from 'nova_ecs/plugins/multiplayer_plugin';
import { SingletonComponent, World } from 'nova_ecs/world';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { EncodedEntity, SerializerPlugin, SerializerResource, markerType } from 'nova_ecs/plugins/serializer_plugin';
import { SnapshotPolicies, SnapshotPoliciesResource } from 'nova_ecs/plugins/snapshot_plugin';
import { TimePlugin, TimeResource } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { Position } from 'nova_ecs/datatypes/position';
import {
    applySimulationFrame, movementSyncedSinceStep, syncedComponents,
    warnedUnsyncableEntities,
} from './apply_simulation_frame.js';
import {
    MovementState, MovementStateComponent,
} from 'nova_ecs/plugins/movement_plugin';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Vector } from 'nova_ecs/datatypes/vector';
import {
    FinishJumpEvent, FinishJumpEventType, JumpRouteComponent, LandEvent, LandEventType,
} from '../nova_plugin/travel/index.js';
import { PlayerShipSelector } from '../nova_plugin/player/index.js';
import { ProjectileCollisionEvent, ProjectileCollisionEventType } from '../nova_plugin/combat/index.js';
import { SoundEvent, SoundEventType } from '../nova_plugin/core/index.js';
import { SimulationBridgeClient } from './simulation_bridge_client.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { emitSimulationBridgeEvent } from './simulation_bridge_events.js';
import { unwrapRollbackMessage, wrapRollbackMessage } from './rollback_protocol.js';
import { RollbackRelay } from './rollback_relay.js';
import type { InputRecord } from './simulation_input.js';
import { ShipControlStateComponent, ControlledByComponent } from '../nova_plugin/player/index.js';
import { resetWarnThrottle } from '../common/log_throttle.js';

const FooComponent = new Component<{ x: number }>('Foo');

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

describe('SimulationBridge', () => {
    let world: World;
    let client: SimulationBridgeClient;

    beforeEach(() => {
        world = new World('bridge test world');
        world.addPlugin(SerializerPlugin);
        world.addPlugin(TimePlugin);

        const serializer = world.resources.get(SerializerResource);
        if (!serializer) {
            throw new Error('Expected serializer resource');
        }
        serializer.addComponent(FooComponent, t.type({ x: t.number }));
        serializer.addComponent(MovementStateComponent, MovementState);
        serializer.addComponent(JumpRouteComponent, t.type({ route: t.array(t.string) }));
        serializer.addComponent(PlayerShipSelector, markerType);
        serializer.addEvent(SoundEvent, SoundEventType);
        serializer.addEvent(LandEvent, LandEventType);
        serializer.addEvent(FinishJumpEvent, FinishJumpEventType(serializer));
        serializer.addEvent(ProjectileCollisionEvent, ProjectileCollisionEventType);

        const host = new SimulationBridgeHost(world, makeFakeSimulationData());
        client = new SimulationBridgeClient(host, serializer);
    });

    it('controlEvents refuses events the wire codec would refuse', async () => {
        // The avro-wire e2e desync: the AUTHORING client sent
        // state:'stop', applied it to its own timeline, and had the
        // record refused by the wire codec — the host played a control
        // the rest of the room never saw, a self-inflicted desync the
        // relay convicted. The host now runs the same predicate the
        // wire does BEFORE scheduling, so its timeline only ever holds
        // controls the room will accept.
        const ship = new Entity('ship')
            .addComponent(ControlledByComponent, { peerId: 'local' })
            // No communicator in this world, so local play resolves the
            // controlled ship through PlayerShipSelector (ship_control.ts).
            .addComponent(PlayerShipSelector, undefined);
        world.entities.set('ship', ship);
        // The drop warning is throttled per key for a second across the
        // whole process (common/log_throttle.ts): forget any earlier
        // spec's firing so the count below is this spec's alone.
        resetWarnThrottle();
        const warn = spyOn(console, 'warn');
        client.controlEvents([
            { action: 'accelerate', state: 'stop' } as never,
            { action: 'firePrimary', state: 'start' },
        ]);
        client.step();
        const state = ship.components.get(ShipControlStateComponent);
        expect(state?.get('accelerate')).toBeUndefined();
        expect(state?.get('firePrimary')).toBeUndefined();
        expect(warn.calls.count()).toBe(1);
        expect(warn.calls.mostRecent().args[0])
            .toContain('local control input the wire would refuse');

        // The valid shapes still apply.
        client.controlEvents([{ action: 'accelerate', state: 'start' }]);
        client.step();
        expect(ship.components.get(ShipControlStateComponent)
            ?.get('accelerate')).toBe('start');
    });

    it('the controlEvents drop warning names the offending event', () => {
        // A static "fails the wire codec" line leaves the caller
        // hunting: the warning carries the decode errors (event index,
        // field, value), as the relay's own drop path does.
        resetWarnThrottle();
        const warn = spyOn(console, 'warn');
        client.controlEvents([
            { action: 'firePrimary', state: 'start' },
            { action: 'accelerate', state: 'stop' } as never,
        ]);
        expect(warn.calls.count()).toBe(1);
        const line = String(warn.calls.mostRecent().args[0]);
        expect(line).toContain('1.state');
        expect(line).toContain('stop');
    });

    it('adds and removes entities through bridge commands', async () => {
        const entity = new Entity('foo').addComponent(FooComponent, { x: 3 });

        // Entity insertion and removal are tick-stamped inputs: they
        // apply when the simulation steps.
        await client.addEntity('foo-uuid', entity);
        client.step();
        const addedFrame = client.snapshot();
        expect(addedFrame.added.length).toBe(1);
        expect(addedFrame.added[0]?.[0]).toBe('foo-uuid');

        const decoded = client.decodeEntity(addedFrame.added[0]![1]);
        expect(decoded.name).toBe('foo');
        expect(decoded.components.get(FooComponent)).toEqual({ x: 3 });

        client.removeEntity('foo-uuid');
        client.step();
        const removedFrame = client.snapshot();
        expect(removedFrame.added).toEqual([]);
        expect(removedFrame.changed).toEqual([]);
        expect(removedFrame.removed).toEqual(['foo-uuid']);
    });

    it('only includes changed components in subsequent snapshots', async () => {
        const entity = new Entity('foo').addComponent(FooComponent, { x: 3 });
        await client.addEntity('foo-uuid', entity);
        client.step();
        expect(client.snapshot().added.length).toBe(1);

        const unchangedFrame = client.snapshot();
        expect(unchangedFrame.added).toEqual([]);
        expect(unchangedFrame.changed).toEqual([]);
        expect(unchangedFrame.removed).toEqual([]);

        const worldEntity = world.entities.get('foo-uuid');
        worldEntity?.components.set(FooComponent, { x: 4 });
        const changedFrame = client.snapshot();
        expect(changedFrame.added).toEqual([]);
        expect(changedFrame.changed).toEqual([
            ['foo-uuid', { changed: [['Foo', { x: 4 }]], removed: [] }],
        ]);

        worldEntity?.components.delete(FooComponent);
        const deletedComponentFrame = client.snapshot();
        expect(deletedComponentFrame.changed).toEqual([
            ['foo-uuid', { changed: [], removed: ['Foo'] }],
        ]);
    });

    it('detects in-place mutation of a component whose codec is the identity', async () => {
        // io-ts returns the LIVE data object for all-identity codecs
        // (t.type({x: t.number}) here). The frame diff must not compare
        // that object against itself next frame; it keeps its own copy.
        const data = { x: 3 };
        const entity = new Entity('foo').addComponent(FooComponent, data);
        await client.addEntity('foo-uuid', entity);
        client.step();
        const added = client.snapshot();
        expect(added.added.length).toBe(1);
        const sentAdded = added.added[0]![1].components
            .find(([name]) => name === 'Foo')![1] as { x: number };
        expect(sentAdded).toEqual({ x: 3 });

        const live = world.entities.get('foo-uuid')!.components.get(FooComponent)!;
        // Mutate in place (no components.set): the wire copy must not
        // follow, and the next frame must report the change.
        live.x = 4;
        expect(sentAdded.x).toBe(3);
        const changed = client.snapshot();
        expect(changed.changed).toEqual([
            ['foo-uuid', { changed: [['Foo', { x: 4 }]], removed: [] }],
        ]);
        const sentChanged = changed.changed[0]![1].changed[0]![1] as { x: number };
        live.x = 5;
        expect(sentChanged.x).toBe(4);
        expect(client.snapshot().changed).toEqual([
            ['foo-uuid', { changed: [['Foo', { x: 5 }]], removed: [] }],
        ]);
        // And an unchanged tick sends nothing.
        expect(client.snapshot().changed).toEqual([]);
    });

    it('sends the same deltas the JSON string comparison did', async () => {
        // The old diff compared JSON.stringify output; the new one walks
        // the values. Cover stringify's quirks: dropped undefined
        // properties, NaN reading as null, key order mattering.
        const Quirky = new Component<{ a?: number, b: number, c: number[] }>('Quirky');
        const serializer = world.resources.get(SerializerResource)!;
        serializer.addComponent(Quirky, t.type({
            a: t.union([t.number, t.undefined]), b: t.number, c: t.array(t.number),
        }));
        const entity = new Entity('q').addComponent(Quirky, { a: undefined, b: 1, c: [1] });
        await client.addEntity('q-uuid', entity);
        client.step();
        client.snapshot();
        const live = world.entities.get('q-uuid')!.components.get(Quirky)!;
        // Removing an undefined-valued key: not a change under JSON.
        delete live.a;
        expect(client.snapshot().changed).toEqual([]);
        // NaN reads as null; a change from 1 to NaN is a change...
        live.b = NaN;
        expect(client.snapshot().changed.length).toBe(1);
        // ...but NaN to Infinity is not (both null).
        live.b = Infinity;
        expect(client.snapshot().changed).toEqual([]);
        // Array element change is a change; same values are not.
        live.c = [1];
        expect(client.snapshot().changed).toEqual([]);
        live.c = [2];
        expect(client.snapshot().changed.length).toBe(1);
    });

    it('steps the world through bridge commands', () => {
        const initialFrame = client.snapshot();

        client.step();

        const steppedFrame = client.snapshot();
        expect(steppedFrame.time?.frame).toBe((initialFrame.time?.frame ?? 0) + 1);
    });

    it('updates the player jump route through bridge commands', async () => {
        const entity = new Entity('player')
            .addComponent(FooComponent, { x: 3 })
            .addComponent(JumpRouteComponent, { route: [] });
        entity.components.set(PlayerShipSelector, undefined);

        await client.addEntity('player-uuid', entity);
        client.setPlayerJumpRoute(['nova:131', 'nova:132']);
        client.step();

        const frame = client.snapshot();
        const decoded = client.decodeEntity(frame.added[0]![1]);
        expect(decoded.components.get(JumpRouteComponent)).toEqual({
            route: ['nova:131', 'nova:132'],
        });

        client.setPlayerJumpRoute(['nova:133']);
        client.step();
        const deltaFrame = client.snapshot();
        expect(deltaFrame.changed).toEqual([
            ['player-uuid', {
                changed: [['JumpRouteComponent', { route: ['nova:133'] }]],
                removed: [],
            }],
        ]);
    });

    it('forwards cloneable events and clears them after snapshot', () => {
        world.emit(SoundEvent, { id: 'nova:weapon' });
        world.emit(LandEvent, { id: 'planet-id', uuid: 'planet-uuid' });

        const firstFrame = client.snapshot();
        expect(firstFrame.events).toEqual([
            { name: 'SoundEvent', data: { id: 'nova:weapon' } },
            { name: 'LandEvent', data: { id: 'planet-id', uuid: 'planet-uuid' } },
        ]);

        const secondFrame = client.snapshot();
        expect(secondFrame.events).toEqual([]);
    });

    it('preserves targeted entity uuids on bridged events', () => {
        world.entities.set('ship-uuid', new Entity('ship').addComponent(FooComponent, { x: 1 }));
        world.emit(LandEvent, { id: 'planet-id', uuid: 'planet-uuid' }, ['ship-uuid']);

        const frame = client.snapshot();
        expect(frame.events).toEqual([
            {
                name: 'LandEvent',
                data: { id: 'planet-id', uuid: 'planet-uuid' },
                entityUuids: ['ship-uuid'],
            },
        ]);
    });

    it('encodes entities in finishJump events', () => {
        const entity = new Entity('jumper').addComponent(FooComponent, { x: 7 });

        world.emit(FinishJumpEvent, {
            entity,
            uuid: 'ship-uuid',
            to: 'nova:200',
        });

        const frame = client.snapshot();
        expect(frame.events.length).toBe(1);
        expect(frame.events[0]?.name).toBe('FinishJumpEvent');
        if (frame.events[0]?.name !== 'FinishJumpEvent') {
            fail('Expected finishJump event');
            return;
        }

        const eventData = frame.events[0].data as { entity: EncodedEntity, uuid: string, to: string };
        const decoded = client.decodeEntity(eventData.entity);
        expect(decoded.name).toBe('jumper');
        expect(decoded.components.get(FooComponent)).toEqual({ x: 7 });
        expect(eventData.uuid).toBe('ship-uuid');
        expect(eventData.to).toBe('nova:200');
    });

    it('does not preserve entity targets for bridged projectile collision events', () => {
        const displayWorld = new World('display test world');
        let hitCount = 0;
        let lastCollision: unknown;
        displayWorld.addSystem(new System({
            name: 'ProjectileCollisionListener',
            events: [ProjectileCollisionEvent],
            args: [ProjectileCollisionEvent, SingletonComponent] as const,
            step(collision) {
                hitCount++;
                lastCollision = collision;
            },
        }));

        const collision = {
            otherUuid: 'target-uuid',
            position: new Position(12, 34),
            projectileData: { id: 'weapon-id' } as never,
        };
        world.emit(ProjectileCollisionEvent, collision, ['missing-projectile-uuid']);

        const frame = client.snapshot();
        expect(frame.events).toEqual([
            {
                name: 'ProjectileCollision',
                data: {
                    ...collision,
                    position: { x: 12, y: 34 },
                },
            },
        ]);

        emitSimulationBridgeEvent(frame.events[0]!, client.getSerializer(), displayWorld);
        displayWorld.step();

        expect(hitCount).toBe(1);
        expect(lastCollision).toEqual(jasmine.objectContaining({
            ...collision,
            position: jasmine.any(Position),
        }));
        expect((lastCollision as { position: Position }).position.x).toBe(12);
        expect((lastCollision as { position: Position }).position.y).toBe(34);
    });

    it('delivers events targeting an entity removed in the same frame to display subscribers', async () => {
        syncedComponents.clear();
        warnedUnsyncableEntities.clear();
        const serializer = client.getSerializer();
        const displayWorld = new World('display test world');

        const entity = new Entity('foo').addComponent(FooComponent, { x: 3 });
        await client.addEntity('foo-uuid', entity);
        client.step();
        applySimulationFrame(client.snapshot(), serializer, displayWorld,
            { emitEvents: true });
        expect(displayWorld.entities.get('foo-uuid')).toBeDefined();

        // A subscriber that looks the event's target up in the display
        // world — the pattern browser.ts's event subscribers use.
        let sawEntity: boolean | undefined;
        displayWorld.events.get(LandEvent).subscribe(({ entities }) => {
            const ref = entities?.[0];
            const uuid = typeof ref === 'string' ? ref : ref?.uuid;
            sawEntity = uuid !== undefined
                && displayWorld.entities.get(uuid) !== undefined;
        });

        // Sim side: the event fires during the same tick that removes
        // its target, so the frame carries both the event and the
        // removal.
        world.emit(LandEvent, { id: 'planet-id', uuid: 'planet-uuid' },
            ['foo-uuid']);
        client.removeEntity('foo-uuid');
        client.step();
        const frame = client.snapshot();
        expect(frame.removed).toEqual(['foo-uuid']);
        expect(frame.events.length).toBe(1);

        // Events are emitted BEFORE removals are applied, matching the
        // sim, where the event fired while the entity still existed.
        applySimulationFrame(frame, serializer, displayWorld,
            { emitEvents: true });
        expect(sawEntity).toBeTrue();
        expect(displayWorld.entities.get('foo-uuid')).toBeUndefined();
    });

    /**
     * The display world runs the simulation's own MovementSystem on the wall
     * clock to cover the frames no snapshot reaches
     * (display/movement_extrapolation_plugin.ts). It must NOT run on an
     * entity a snapshot has just placed — that draws it one frame past where
     * the simulation put it, which is what made every projectile appear
     * already clear of the muzzle it left. These specs pin the stamp the
     * gate reads.
     */
    describe('the movement freshness stamp', () => {
        function movementState(x: number): MovementState {
            return {
                position: new Position(x, 0),
                velocity: new Vector(60, 0),
                rotation: new Angle(0),
                turning: 0,
                turnBack: false,
                accelerating: 0,
            };
        }

        beforeEach(() => {
            syncedComponents.clear();
            warnedUnsyncableEntities.clear();
            movementSyncedSinceStep.clear();
        });

        it('stamps an entity whose MovementState an ADDED frame carries',
            async () => {
                const displayWorld = new World('display test world');
                const entity = new Entity('shot')
                    .addComponent(MovementStateComponent, movementState(0));
                await client.addEntity('shot-uuid', entity);
                client.step();

                applySimulationFrame(client.snapshot(), client.getSerializer(),
                    displayWorld);
                // A projectile's very first frame: born at the muzzle, and
                // it has to be RENDERED at the muzzle.
                expect(movementSyncedSinceStep.has('shot-uuid')).toBeTrue();
            });

        it('stamps an entity whose MovementState a CHANGED delta carries',
            async () => {
                const displayWorld = new World('display test world');
                const entity = new Entity('ship')
                    .addComponent(MovementStateComponent, movementState(0));
                await client.addEntity('ship-uuid', entity);
                client.step();
                applySimulationFrame(client.snapshot(), client.getSerializer(),
                    displayWorld);
                movementSyncedSinceStep.clear();

                // The simulation moves it: the bridge's own JSON diff
                // resends the whole MovementState (positions are not
                // omitted the way the peer-to-peer delta omits them).
                world.entities.get('ship-uuid')!.components
                    .set(MovementStateComponent, movementState(7));
                client.step();
                applySimulationFrame(client.snapshot(), client.getSerializer(),
                    displayWorld);
                expect(movementSyncedSinceStep.has('ship-uuid')).toBeTrue();
            });

        it('leaves an entity the frame did not move UNSTAMPED, so wall-clock '
            + 'prediction still covers it', async () => {
                const displayWorld = new World('display test world');
                const entity = new Entity('ship')
                    .addComponent(MovementStateComponent, movementState(0));
                await client.addEntity('ship-uuid', entity);
                client.step();
                applySimulationFrame(client.snapshot(), client.getSerializer(),
                    displayWorld);
                movementSyncedSinceStep.clear();

                // Nothing moved it, so the diff carries no MovementState —
                // the missed-pump shape, where extrapolation is the whole
                // point of the plugin.
                client.step();
                applySimulationFrame(client.snapshot(), client.getSerializer(),
                    displayWorld);
                expect(movementSyncedSinceStep.has('ship-uuid')).toBeFalse();
            });
    });

    describe('rollback event forwarding', () => {
        let communicator: MockCommunicator;
        let rollbackClient: SimulationBridgeClient;

        beforeEach(() => {
            communicator = new MockCommunicator('client');
            world.resources.set(CommunicatorResource, communicator);
            // Rollback needs the clock in its snapshots, or restoring
            // a past tick leaves time at the present and resimulation
            // never runs.
            const policies = new SnapshotPolicies();
            const time = world.resources.get(TimeResource)!;
            policies.addResource({
                name: 'time',
                save: () => ({ ...time }),
                restore: saved => Object.assign(time, saved as object),
            });
            world.resources.set(SnapshotPoliciesResource, policies);
            // A bridged event every tick, tagged with the tick.
            world.addSystem(new System({
                name: 'SoundEachTick',
                args: [Emit, TimeResource, SingletonComponent] as const,
                step: (emit, time) => {
                    emit(SoundEvent, { id: `tick-${time.frame}` });
                },
            }));
            const host = new SimulationBridgeHost(
                world, makeFakeSimulationData());
            rollbackClient = new SimulationBridgeClient(
                host, world.resources.get(SerializerResource)!);
        });

        /** Relays another peer's (harmless) input record for a tick. */
        function relayRecord(tick: number) {
            communicator.messages.next({
                source: 'server',
                message: wrapRollbackMessage({
                    kind: 'inputs',
                    record: {
                        peerId: 'other peer',
                        tick,
                        inputs: [{ kind: 'setTarget', target: null }],
                    },
                }),
            });
        }

        it('does not re-forward already-forwarded events on a rollback correction', () => {
            rollbackClient.step(3);
            const first = rollbackClient.snapshot();
            expect(first.events.map(event => event.tick)).toEqual([1, 2, 3]);

            // A correction for tick 2 arrives after those ticks'
            // events were already handed to the display: the next step
            // rolls back to tick 1 and re-simulates ticks 2-3, whose
            // re-emissions must not be forwarded a second time.
            relayRecord(2);
            rollbackClient.step();
            const second = rollbackClient.snapshot();
            expect(second.events.map(event => event.tick)).toEqual([4]);
        });

        it('forwards each tick\'s events exactly once when rolling back unflushed ticks', () => {
            // Three ticks' events queued but NOT yet flushed by a
            // snapshot when the correction arrives: the originals from
            // the re-simulated ticks are superseded by the corrected
            // timeline's re-emissions — each tick's events must reach
            // the display exactly once.
            rollbackClient.step(3);
            relayRecord(2);
            rollbackClient.step();
            const frame = rollbackClient.snapshot();
            expect(frame.events.map(event => event.tick)).toEqual([1, 2, 3, 4]);
        });
    });

    describe('tick pacing', () => {
        function makePacedHost() {
            const communicator = new MockCommunicator('client');
            world.resources.set(CommunicatorResource, communicator);
            const host = new SimulationBridgeHost(
                world, makeFakeSimulationData());
            const sync = (tick: number, source = 'server') =>
                communicator.messages.next({
                    source,
                    message: wrapRollbackMessage({ kind: 'tickSync', tick }),
                });
            return { host, communicator, sync };
        }

        it('reports no pacing before any tickSync', () => {
            const { host } = makePacedHost();
            expect(host.snapshot().pacing).toBeUndefined();
        });

        describe('the trust model: rollback messages come from the server only',
            () => {
                it('ignores a tickSync from another peer', () => {
                    const { host, sync } = makePacedHost();
                    sync(1e9, 'attacker');
                    expect(host.snapshot().pacing).toBeUndefined();
                });

                it('ignores a forged roomSpeed from another peer and deduplicates speedVote', () => {
                    const { host, communicator } = makePacedHost();
                    communicator.messages.next({
                        source: 'attacker',
                        message: wrapRollbackMessage({
                            kind: 'roomSpeed', tick: 10, speed: 2, atTick: 11,
                            fastVotes: 1, totalVoters: 1,
                        }),
                    });
                    expect(host.snapshot().roomSpeed).toBeUndefined();

                    // Server roomSpeed is accepted.
                    communicator.messages.next({
                        source: 'server',
                        message: wrapRollbackMessage({
                            kind: 'roomSpeed', tick: 10, speed: 2, atTick: 11,
                            fastVotes: 1, totalVoters: 1,
                        }),
                    });
                    expect(host.snapshot().roomSpeed?.targetSpeed).toBe(2);

                    // setSpeedVote publishes only when (wantFast, inSpace) changes.
                    const sent: unknown[] = [];
                    const origSend = communicator.sendMessage.bind(communicator);
                    communicator.sendMessage = (msg, dest) => {
                        sent.push(msg);
                        origSend(msg, dest);
                    };
                    host.setSpeedVote(true, true);
                    host.setSpeedVote(true, true);
                    host.setSpeedVote(true, false);
                    expect(sent).toEqual([
                        wrapRollbackMessage({ kind: 'speedVote', wantFast: true, inSpace: true }),
                        wrapRollbackMessage({ kind: 'speedVote', wantFast: true, inSpace: false }),
                    ]);
                });

                it('ignores a desync and an inputLog from another peer', async () => {
                    const { host, communicator } = makePacedHost();
                    const entity = new Entity('foo')
                        .addComponent(FooComponent, { x: 1 });
                    const serializer = world.resources.get(SerializerResource)!;
                    // Insertion records stage asynchronously before they
                    // integrate; give that a turn of the event loop.
                    const staged = () => new Promise(resolve => setTimeout(resolve, 10));
                    communicator.messages.next({
                        source: 'attacker',
                        message: wrapRollbackMessage({
                            kind: 'desync', tick: 60,
                            hashes: [['client', 'bad'], ['attacker', 'good']],
                            canonical: 'good',
                        }),
                    });
                    communicator.messages.next({
                        source: 'attacker',
                        message: wrapRollbackMessage({
                            kind: 'inputLog',
                            records: [{
                                peerId: 'client', tick: 1,
                                inputs: [{
                                    kind: 'addEntity', uuid: 'forged',
                                    entity: serializer.encode(entity),
                                }],
                            }],
                        }),
                    });
                    await staged();
                    host.step(3);
                    expect(host.desyncCount).toBe(0);
                    expect(world.entities.has('forged')).toBeFalse();
                    // The same record from the server is integrated.
                    communicator.messages.next({
                        source: 'server',
                        message: wrapRollbackMessage({
                            kind: 'inputs',
                            record: {
                                peerId: 'client', tick: host.status().tick + 1,
                                inputs: [{
                                    kind: 'addEntity', uuid: 'genuine',
                                    entity: serializer.encode(entity),
                                }],
                            },
                        }),
                    });
                    await staged();
                    host.step(2);
                    expect(world.entities.has('genuine')).toBeTrue();
                });

                it('drops a malformed record from the server without wedging',
                    () => {
                        const { host, communicator } = makePacedHost();
                        communicator.messages.next({
                            source: 'server',
                            message: { rollback: { kind: 'inputs' } },
                        });
                        communicator.messages.next({
                            source: 'server',
                            message: {
                                rollback: {
                                    kind: 'inputs',
                                    record: { tick: 1, inputs: null },
                                },
                            },
                        });
                        expect(() => host.step(3)).not.toThrow();
                    });
            });

        it('speeds up when behind, clamped to the slew limit', () => {
            const { host, sync } = makePacedHost();
            sync(500);
            const pacing = host.snapshot().pacing!;
            expect(pacing.behindTicks).toBeGreaterThan(400);
            expect(pacing.rate).toBeCloseTo(1.05, 5);
        });

        it('corrects small drift proportionally, not by clamping', () => {
            const { host, sync } = makePacedHost();
            // Local tick 0, server tick 0: the drift is just the
            // send-ahead lead (4 ticks) -> a gentle speedup.
            sync(0);
            const pacing = host.snapshot().pacing!;
            expect(pacing.behindTicks).toBeGreaterThan(3.5);
            expect(pacing.behindTicks).toBeLessThan(6);
            expect(pacing.rate).toBeGreaterThan(1.03);
            expect(pacing.rate).toBeLessThan(1.05);
        });

        it('slows down when ahead, clamped to the slew limit', () => {
            const { host, sync } = makePacedHost();
            host.step(60);
            sync(0);
            const pacing = host.snapshot().pacing!;
            expect(pacing.behindTicks).toBeLessThan(-40);
            expect(pacing.rate).toBeCloseTo(0.95, 5);
        });

        describe('the entry catch-up (catchUpToRoomClock)', () => {
            it('steps straight onto the clock target, leaving no drift '
                + 'for the slew', async () => {
                const { host, sync } = makePacedHost();
                sync(500);
                const stepped = await host.catchUpToRoomClock();
                // Server tick 500 (plus whatever real time the steps
                // took) and the 4-tick send-ahead lead.
                expect(stepped).toBeGreaterThanOrEqual(504);
                expect(host.status().tick).toBe(stepped);
                const pacing = host.snapshot().pacing!;
                expect(pacing.behindTicks).toBeGreaterThan(-1);
                expect(pacing.behindTicks).toBeLessThan(1);
                // The smoothed drift was reset with the jump: no
                // leftover slew against the old position.
                expect(pacing.rate).toBeGreaterThan(0.99);
                expect(pacing.rate).toBeLessThan(1.01);
            });

            it('is a no-op with no room clock (offline play)', async () => {
                const { host } = makePacedHost();
                expect(await host.catchUpToRoomClock()).toBe(0);
                expect(host.status().tick).toBe(0);
            });

            it('never steps a peer that is already at or ahead of the '
                + 'clock (steady state is the pacing\'s)', async () => {
                const { host, sync } = makePacedHost();
                host.step(60);
                sync(0);
                expect(await host.catchUpToRoomClock()).toBe(0);
                expect(host.status().tick).toBe(60);
            });

            it('takes a pending insertion through with it, stamped at '
                + 'the room clock', async () => {
                const { host, communicator, sync } = makePacedHost();
                const sent: InputRecord[] = [];
                const send = communicator.sendMessage.bind(communicator);
                communicator.sendMessage = (message, destination) => {
                    const rollback = unwrapRollbackMessage(message);
                    if (rollback?.kind === 'inputs') {
                        sent.push(rollback.record);
                    }
                    send(message, destination);
                };
                sync(300);
                const serializer = world.resources.get(SerializerResource)!;
                await host.addEntity('arriving', serializer.encode(
                    new Entity('arriving').addComponent(FooComponent, { x: 1 })));
                await host.catchUpToRoomClock();
                // In the world by the end of the catch-up: the first
                // in-space frame shows it.
                expect(world.entities.has('arriving')).toBeTrue();
                const insertion = sent.find(record => record.inputs.some(
                    input => input.kind === 'addEntity'))!;
                expect(insertion).toBeDefined();
                expect(insertion.tick).toBeGreaterThan(300);
            });
        });
    });

    describe('staging-failure recovery', () => {
        // A host whose insertion staging always fails, and which records
        // every resync call (with the `force` flag) plus whether that call
        // actually proceeded past the cooldown guard (i.e. returned via the
        // join loop rather than the early cooldown no-op).
        class StagingFailsHost extends SimulationBridgeHost {
            resyncCalls: { force: boolean; proceeded: boolean }[] = [];
            protected override stageRecords(): Promise<void> {
                return Promise.reject(new Error('staging always fails'));
            }
            override async resync(force = false): Promise<boolean> {
                // A resync that proceeds past the cooldown guard refreshes
                // lastResyncTime; a cooldown no-op leaves it untouched. Diff
                // it across the call to tell the two apart.
                const before = this.lastResyncTime;
                const result = await super.resync(force);
                const proceeded = this.lastResyncTime !== before;
                this.resyncCalls.push({ force, proceeded });
                return result;
            }
            /** Starts the cooldown as a resync that LANDED would (a
             * resync that gives up is terminal since #333, so one cannot
             * be used to warm it any more). */
            warmCooldown() {
                // A millisecond in the past, well inside the cooldown: the
                // forced resync's own stamp (Date.now()) must differ from
                // it, or `proceeded` would read a proceeding resync as a
                // no-op when both land in the same millisecond.
                this.lastResyncTime = Date.now() - 1;
            }
        }

        function makeStagingHost() {
            const communicator = new MockCommunicator('client');
            world.resources.set(CommunicatorResource, communicator);
            // No server uuid handshake happens here, so joinRoom returns
            // false immediately; a proceeding resync just runs its (single,
            // zero-delay) attempt and returns false. We only care that it
            // *ran*, not that it succeeded.
            const host = new StagingFailsHost(world, makeFakeSimulationData(), {
                stagingMaxAttempts: 1,
                stagingRetryMs: 0,
                resyncMaxAttempts: 1,
                resyncRetryMs: 0,
                // No relay answers the join, so let it time out fast rather
                // than block the test on the multi-second default.
                resyncJoinTimeoutMs: 10,
                resyncCooldownMs: 10_000,
            });
            const relayInsertion = (uuid: string, tick: number) => {
                const entity = new Entity('foo')
                    .addComponent(FooComponent, { x: 1 });
                const serializer = world.resources.get(SerializerResource)!;
                communicator.messages.next({
                    source: 'server',
                    message: wrapRollbackMessage({
                        kind: 'inputs',
                        record: {
                            peerId: 'other',
                            tick,
                            inputs: [{
                                kind: 'addEntity',
                                uuid,
                                entity: serializer.encode(entity),
                            }],
                        },
                    }),
                });
            };
            return { host, relayInsertion };
        }

        it('resyncs on staging failure even inside the resync cooldown', async () => {
            const { host, relayInsertion } = makeStagingHost();

            // Warm the cooldown, so any *non-forced* resync for the next
            // 10s would no-op.
            host.warmCooldown();

            // Sanity: a plain resync inside the cooldown is a no-op.
            await host.resync();
            expect(host.resyncCalls[0]).toEqual({ force: false, proceeded: false });

            // Now relay an insertion whose staging will fail. The
            // staging-failure path must force a resync that PROCEEDS despite
            // the still-cooling cooldown — otherwise the record is silently
            // dropped and this peer forks until desync detection ~10s later.
            relayInsertion('inserted-uuid', host.status().tick);

            // integrateStaged stages asynchronously (one failed attempt, then
            // a forced resync whose join times out after ~10ms). Wait past
            // that for the forced resync to land.
            await new Promise(resolve => setTimeout(resolve, 100));

            const forced = host.resyncCalls.filter(c => c.force);
            expect(forced.length).toBeGreaterThanOrEqual(1);
            // The forced staging-failure resync bypassed the cooldown.
            expect(forced.some(c => c.proceeded)).toBe(true);
        });
    });

    describe('a resync that gives up (#333)', () => {
        // No relay answers, so every attempt's join times out and the
        // resync runs out of attempts: the terminal failure, whose
        // handling ruling admin1 set — save, freeze, reload.
        function makeFailingHost() {
            const communicator = new MockCommunicator('client');
            world.resources.set(CommunicatorResource, communicator);
            const host = new SimulationBridgeHost(world, makeFakeSimulationData(), {
                resyncMaxAttempts: 2,
                resyncRetryMs: 0,
                resyncJoinTimeoutMs: 10,
                resyncCooldownMs: 0,
            });
            return { host, communicator };
        }

        it('reports the failure on exactly one frame, and never sends the '
            + 'genesis world', async () => {
            const { host } = makeFailingHost();
            host.step(5);
            // The display already holds the pre-failure world.
            world.entities.set('player', new Entity('player')
                .addComponent(FooComponent, { x: 1 }));
            expect(host.snapshot().added.map(([uuid]) => uuid))
                .toEqual(['player']);
            expect(host.status().resyncFailed).toBeUndefined();

            expect(await host.resync()).toBeFalse();
            // Every attempt restored genesis, which has no 'player'; a
            // frame encoding it would remove the player's ship from the
            // display. The failure frame carries no state at all.
            expect(world.entities.has('player')).toBeFalse();
            const failed = host.snapshot();
            expect(failed).toEqual({
                added: [], changed: [], removed: [], events: [],
                resyncFailed: true,
            });
            // Exactly once: later frames are empty and unflagged.
            for (let i = 0; i < 3; i++) {
                host.step();
                const later = host.snapshot();
                expect(later.resyncFailed).toBeUndefined();
                expect(later.removed).toEqual([]);
                expect(later.added).toEqual([]);
            }
            expect(host.status().resyncFailed).toBeTrue();
        });

        it('freezes: no stepping, no inputs, no further resync', async () => {
            const { host, communicator } = makeFailingHost();
            host.step(5);
            expect(await host.resync()).toBeFalse();
            const tick = host.status().tick;
            const sent = spyOn(communicator, 'sendMessage').and.callThrough();

            host.controlEvents([{ action: 'accelerate', state: 'start' }]);
            host.setTarget('someone');
            host.step(10);
            expect(host.status().tick).toBe(tick);
            // Nothing was published to the room either.
            expect(sent).not.toHaveBeenCalled();
            expect(host.rewind(1)).toBeFalse();

            // A desync conviction or a forced (staging-failure) resync no
            // longer reconstructs: the page reload is the way out.
            expect(await host.resync(true)).toBeFalse();
            expect(await host.joinRoom(10)).toBeFalse();
            expect(host.status().tick).toBe(tick);
        });
    });

    describe('2x real-time window scaling (#371 R1)', () => {
        function makeTimedHost() {
            const communicator = new MockCommunicator('client');
            world.resources.set(CommunicatorResource, communicator);
            const policies = new SnapshotPolicies();
            const time = world.resources.get(TimeResource)!;
            policies.addResource({
                name: 'time',
                save: () => ({ ...time }),
                restore: saved => Object.assign(time, saved as object),
            });
            world.resources.set(SnapshotPoliciesResource, policies);
            const host = new SimulationBridgeHost(
                world, makeFakeSimulationData());
            return { host, communicator };
        }

        it('retains 240 ticks of rollback history (2 full seconds at 2x)', () => {
            const { host } = makeTimedHost();
            host.step(220);
            // Deeper than the old 120-tick ring, still within the 240-tick ring.
            expect(host.rewind(180)).toBeTrue();
            expect(host.status().tick).toBe(40);
        });

        it('doubles STATE_HASH_SETTLE_TICKS to 60 at 2x so the 500ms settle window holds', () => {
            const { host, communicator } = makeTimedHost();
            const stateHashes: number[] = [];
            const origSend = communicator.sendMessage.bind(communicator);
            communicator.sendMessage = (msg, dest) => {
                const rollback = (msg as { rollback?: { kind?: string, tick?: number } })?.rollback;
                if (rollback?.kind === 'stateHash' && rollback.tick !== undefined) {
                    stateHashes.push(rollback.tick);
                }
                origSend(msg, dest);
            };

            // Room switches to 2x from tick 1 onward.
            communicator.messages.next({
                source: 'server',
                message: wrapRollbackMessage({
                    kind: 'roomSpeed', tick: 0, speed: 2, atTick: 1,
                    fastVotes: 1, totalVoters: 1,
                }),
            });

            // Step to tick 90 (30 ticks past checkpoint 60): at 1x tick 60
            // would already publish here, but at 2x it must wait 60 ticks.
            host.step(90);
            expect(stateHashes).toEqual([]);

            // Step to tick 119 (59 ticks past checkpoint 60): still unsettled.
            host.step(29);
            expect(stateHashes).toEqual([]);

            // Step to tick 120 (60 ticks past checkpoint 60): now settled!
            host.step(1);
            expect(stateHashes).toEqual([60]);
        });
    });

    describe('room speed join, reconnect, and #333 terminal path (#371)', () => {
        function makeRoomWorld(communicator: MockCommunicator) {
            const w = new World('speed bridge test');
            w.addPlugin(SerializerPlugin);
            w.addPlugin(TimePlugin);
            const policies = new SnapshotPolicies();
            const time = w.resources.get(TimeResource)!;
            policies.addResource({
                name: 'time',
                save: () => ({ ...time }),
                restore: saved => Object.assign(time, saved as object),
            });
            w.resources.set(SnapshotPoliciesResource, policies);
            w.resources.set(CommunicatorResource, communicator);
            return w;
        }

        it('adopts catchUp.roomSpeed on a mid-2x join and carries initialSpeedVote in joinRequest', async () => {
            const server = new MockCommunicator('server');
            const peerA = new MockCommunicator('a');
            const peers = new Map([['server', server], ['a', peerA]]);
            for (const p of peers.values()) {
                p.mockPeers = peers;
                p.peers.current.next(new Set(peers.keys()));
            }
            const relay = new RollbackRelay(server, { autoClock: false });
            try {
                // Peer A alone puts the room into 2x at tick 20.
                const hostA = new SimulationBridgeHost(
                    makeRoomWorld(peerA), makeFakeSimulationData(), {
                        initialSpeedVote: { wantFast: true, inSpace: true },
                    });
                expect(await hostA.joinRoom(1000)).toBeTrue();
                relay.advanceTicks(20);
                expect(relay.speed).toBe(2);
                peerA.allMessages.length = 0;

                // Peer B joins mid-2x with Caps Lock already on.
                const peerB = new MockCommunicator('b');
                peers.set('b', peerB);
                peerB.mockPeers = peers;
                for (const p of peers.values()) {
                    p.peers.current.next(new Set(peers.keys()));
                }
                const hostB = new SimulationBridgeHost(
                    makeRoomWorld(peerB), makeFakeSimulationData(), {
                        initialSpeedVote: { wantFast: true, inSpace: true },
                    });
                expect(await hostB.joinRoom(1000)).toBeTrue();

                // Room never flipped to 1x, and peer B adopted 2x straight from
                // catchUp.roomSpeed (no speed flip broadcast occurred).
                expect(relay.speed).toBe(2);
                expect(relay.speedState).toEqual({
                    speed: 2, atTick: 1, fastVotes: 2, totalVoters: 2,
                });
                const snapB = hostB.snapshot();
                expect(snapB.pacing?.speed).toBe(2);
                expect(snapB.pacing!.rate).toBeGreaterThan(1.8);
                expect(snapB.roomSpeed?.speed).toBe(2);
                expect(snapB.roomSpeed?.fastVotes).toBe(2);
                expect(snapB.roomSpeed?.totalVoters).toBe(2);
            } finally {
                relay.close();
            }
        });

        it('re-sends speedVote via joinRequest on reconnect without a spurious pre-membership warning', async () => {
            resetWarnThrottle();
            const warn = spyOn(console, 'warn').and.callThrough();
            const server = new MockCommunicator('server');
            const peerA = new MockCommunicator('a');
            const peerB = new MockCommunicator('b1');
            const peers = new Map([
                ['server', server], ['a', peerA], ['b1', peerB],
            ]);
            for (const p of peers.values()) {
                p.mockPeers = peers;
                p.peers.current.next(new Set(peers.keys()));
            }
            const relay = new RollbackRelay(server, { autoClock: false });
            try {
                const hostA = new SimulationBridgeHost(
                    makeRoomWorld(peerA), makeFakeSimulationData(), {
                        initialSpeedVote: { wantFast: true, inSpace: true },
                    });
                const hostB = new SimulationBridgeHost(
                    makeRoomWorld(peerB), makeFakeSimulationData(), {
                        initialSpeedVote: { wantFast: true, inSpace: true },
                        resyncCooldownMs: 0,
                        resyncJoinTimeoutMs: 1000,
                    });
                expect(await hostA.joinRoom(1000)).toBeTrue();
                expect(await hostB.joinRoom(1000)).toBeTrue();
                relay.advanceTicks(10);
                expect(relay.speed).toBe(2);

                // Disconnect B (old uuid b1 leaves room), then reconnect with
                // a new uuid b2 BEFORE room membership is back.
                peerB.connected.next(false);
                peers.delete('b1');
                server.peers.current.next(new Set(['server', 'a']));
                peerB.uuid = 'b2';
                peers.set('b2', peerB);
                // Reconnected edge fires BEFORE b2 is in the room's peer set:
                // must NOT publish a spurious speedVote that the relay drops.
                peerB.connected.next(true);
                const nonMemberWarnings = warn.calls.allArgs().filter(([msg]) =>
                    String(msg).includes('not in this room'));
                expect(nonMemberWarnings).toEqual([]);

                // Now room membership arrives for b2, and stepping triggers
                // noteIdentity() -> reenter() -> reconstructFromRoom() whose
                // joinRequest carries b2's speedVote.
                server.peers.current.next(new Set(['server', 'a', 'b2']));
                peerB.peers.current.next(new Set(['server', 'a', 'b2']));
                hostB.step(1);
                // Let the async re-entry resync finish.
                for (let i = 0; i < 30 && relay.speedState.totalVoters < 2; i++) {
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
                expect(relay.speed).toBe(2);
                expect(relay.speedState.fastVotes).toBe(2);
                expect(relay.speedState.totalVoters).toBe(2);
            } finally {
                relay.close();
            }
        });

        it('withdraws its speed vote on terminal #333 resync failure so it cannot pin the room at 1x', async () => {
            const server = new MockCommunicator('server');
            const peerA = new MockCommunicator('a');
            const peerB = new MockCommunicator('b');
            const peers = new Map([
                ['server', server], ['a', peerA], ['b', peerB],
            ]);
            for (const p of peers.values()) {
                p.mockPeers = peers;
                p.peers.current.next(new Set(peers.keys()));
            }
            const relay = new RollbackRelay(server, { autoClock: false });
            try {
                // Peer A votes yes; Peer B does not (default "no" pins room at 1x).
                const hostA = new SimulationBridgeHost(
                    makeRoomWorld(peerA), makeFakeSimulationData(), {
                        initialSpeedVote: { wantFast: true, inSpace: true },
                    });
                expect(await hostA.joinRoom(1000)).toBeTrue();
                // Subclass peer B so resync fails immediately after 1 attempt
                // while still connected to the relay.
                class TerminalResyncHost extends SimulationBridgeHost {
                    protected override async reconstructFromRoom(): Promise<boolean> {
                        return false;
                    }
                }
                const hostB = new TerminalResyncHost(
                    makeRoomWorld(peerB), makeFakeSimulationData(), {
                        resyncMaxAttempts: 1,
                        resyncRetryMs: 0,
                        resyncJoinTimeoutMs: 10,
                    });
                // Peer B is in space voting "no", pinning the room at 1x.
                hostB.setSpeedVote(false, true);
                expect(relay.speedState).toEqual({
                    speed: 1, atTick: 0, fastVotes: 1, totalVoters: 2,
                });

                // Peer B hits terminal #333 resync failure -> withdraws its vote!
                spyOn(console, 'error');
                expect(await hostB.resync(true)).toBeFalse();
                expect(hostB.status().resyncFailed).toBeTrue();
                expect(relay.speedState).toEqual({
                    speed: 2, atTick: 1, fastVotes: 1, totalVoters: 1,
                });

                // Subsequent setSpeedVote calls on the frozen host are ignored.
                hostB.setSpeedVote(false, true);
                expect(relay.speedState.totalVoters).toBe(1);
                expect(relay.speedState.speed).toBe(2);
            } finally {
                relay.close();
            }
        });

        it('paces at 2x from its first tick using catchUp.roomSpeed when joining a 2x room (#371)', async () => {
            const server = new MockCommunicator('server');
            const peerA = new MockCommunicator('a');
            const peers = new Map<string, MockCommunicator>([
                ['server', server], ['a', peerA],
            ]);
            for (const p of peers.values()) {
                p.mockPeers = peers;
                p.peers.current.next(new Set(peers.keys()));
            }
            const relay = new RollbackRelay(server, { autoClock: false });
            try {
                // Peer A joins with Caps Lock on and activates 2x on the relay.
                const hostA = new SimulationBridgeHost(
                    makeRoomWorld(peerA), makeFakeSimulationData(), {
                        initialSpeedVote: { wantFast: true, inSpace: true },
                    });
                expect(await hostA.joinRoom(1000)).toBeTrue();
                relay.advanceTicks(10);
                expect(relay.speed).toBe(2);

                // Peer B joins landed (inSpace: false), so neither speed nor
                // voter tallies change and the relay sends NO roomSpeed
                // broadcast — catchUp.roomSpeed is the ONLY way B learns the
                // room is running at 2x.
                const peerB = new MockCommunicator('b');
                peers.set('b', peerB);
                for (const p of peers.values()) {
                    p.mockPeers = peers;
                    p.peers.current.next(new Set(peers.keys()));
                }
                const roomSpeedBroadcasts: unknown[] = [];
                peerB.messages.subscribe(({ message }) => {
                    const m = unwrapRollbackMessage(message);
                    if (m?.kind === 'roomSpeed') {
                        roomSpeedBroadcasts.push(m);
                    }
                });
                const hostB = new SimulationBridgeHost(
                    makeRoomWorld(peerB), makeFakeSimulationData(), {
                        initialSpeedVote: { wantFast: false, inSpace: false },
                    });
                expect(await hostB.joinRoom(1000)).toBeTrue();
                expect(roomSpeedBroadcasts).toEqual([]);

                // From its very first snapshot/tick after joinRoom, B must pace
                // at 2x (~2x rate) rather than 1x.
                const firstSnap = hostB.snapshot();
                expect(firstSnap.pacing?.speed).toBe(2);
                expect(firstSnap.pacing!.rate).toBeGreaterThan(1.8);
                expect(firstSnap.roomSpeed).toEqual({
                    speed: 2, targetSpeed: 2, atTick: 1,
                    fastVotes: 1, totalVoters: 1,
                    wantFast: false, inSpace: false,
                });
            } finally {
                relay.close();
            }
        });
    });
});
