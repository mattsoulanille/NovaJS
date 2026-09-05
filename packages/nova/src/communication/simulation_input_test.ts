import 'jasmine';
import * as t from 'io-ts';
import { isLeft, isRight } from 'fp-ts/lib/Either.js';
import { Entity } from 'nova_ecs/entity';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { CommunicatorResource, MultiplayerData, MultiplayerDataType } from 'nova_ecs/plugins/multiplayer_plugin';
import { SerializerPlugin, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { World } from 'nova_ecs/world';
import { Component } from 'nova_ecs/component';
import { ActiveMissionType, MissionsComponent } from '../nova_plugin/player_state_plugin.js';
import { ControlledByComponent, ControlledByType } from '../nova_plugin/ship_control.js';
import { applyInputRecords, InputRecordType, SimulationInput, SimulationInputType } from './simulation_input.js';

/**
 * ============================================================================
 * Hostile input records
 * ============================================================================
 *
 * The relay stamps a record's peerId with the socket it came from, but
 * the PAYLOAD is the sender's: without authorisation, any peer's record
 * could delete or replace any other peer's ship (removePeer / removeEntity
 * / addEntity on an existing uuid) — deterministically, on every peer,
 * and permanently, since the record is logged and served to every joiner.
 * These specs pin the ownership rule (see simulation_input.ts).
 */

const Foo = new Component<{ x: number }>('Foo');

function makeWorld({ communicator = true } = {}) {
    const world = new World('input auth');
    world.addPlugin(SerializerPlugin);
    const serializer = world.resources.get(SerializerResource)!;
    serializer.addComponent(Foo, t.type({ x: t.number }));
    serializer.addComponent(ControlledByComponent, ControlledByType);
    serializer.addComponent(MultiplayerData, MultiplayerDataType);
    if (communicator) {
        world.resources.set(CommunicatorResource, new MockCommunicator('a'));
    }
    const victim = new Entity('victim ship')
        .addComponent(Foo, { x: 1 })
        .addComponent(ControlledByComponent, { peerId: 'b' })
        .addComponent(MultiplayerData, { owner: 'b' });
    world.entities.set('victim', victim);
    const own = new Entity('own ship')
        .addComponent(Foo, { x: 2 })
        .addComponent(ControlledByComponent, { peerId: 'a' })
        .addComponent(MultiplayerData, { owner: 'a' });
    world.entities.set('own', own);
    const escort = new Entity('escort of b')
        .addComponent(Foo, { x: 3 })
        .addComponent(MultiplayerData, { owner: 'b' });
    world.entities.set('escort', escort);
    return { world, serializer };
}

function apply(world: World, peerId: string | undefined,
    inputs: SimulationInput[]) {
    applyInputRecords(world, [{ peerId, tick: 1, inputs }]);
}

describe('input record authorisation', () => {
    it('removePeer is server-authored: a peer\'s record cannot carry it', () => {
        const { world } = makeWorld();
        apply(world, 'a', [{ kind: 'removePeer', peerId: 'b' }]);
        expect(world.entities.has('victim')).toBeTrue();
        // The relay's own record does what it says.
        apply(world, 'server', [{ kind: 'removePeer', peerId: 'b' }]);
        expect(world.entities.has('victim')).toBeFalse();
        expect(world.entities.has('own')).toBeTrue();
    });

    it('a world with no communicator still trusts the server\'s uuid '
        + '(the archive sim, offline log replay)', () => {
            const { world } = makeWorld({ communicator: false });
            apply(world, 'a', [{ kind: 'removePeer', peerId: 'b' }]);
            expect(world.entities.has('victim')).toBeTrue();
            apply(world, 'server', [{ kind: 'removePeer', peerId: 'b' }]);
            expect(world.entities.has('victim')).toBeFalse();
        });

    it('removeEntity needs ownership of the target', () => {
        const { world } = makeWorld();
        apply(world, 'a', [{ kind: 'removeEntity', uuid: 'victim' }]);
        apply(world, 'a', [{ kind: 'removeEntity', uuid: 'escort' }]);
        expect(world.entities.has('victim')).toBeTrue();
        expect(world.entities.has('escort')).toBeTrue();
        // Own ship: fine (docking pulls the player's ship out this way).
        apply(world, 'a', [{ kind: 'removeEntity', uuid: 'own' }]);
        expect(world.entities.has('own')).toBeFalse();
        // The owner of an escort (MultiplayerData.owner) may remove it.
        apply(world, 'b', [{ kind: 'removeEntity', uuid: 'escort' }]);
        expect(world.entities.has('escort')).toBeFalse();
    });

    it('addEntity may not overwrite another peer\'s uuid', () => {
        const { world, serializer } = makeWorld();
        const hijacked = new Entity('hijacked')
            .addComponent(Foo, { x: 99 })
            .addComponent(ControlledByComponent, { peerId: 'a' });
        apply(world, 'a', [{
            kind: 'addEntity', uuid: 'victim',
            entity: serializer.encode(hijacked),
        }]);
        expect(world.entities.get('victim')!.components.get(Foo))
            .toEqual({ x: 1 });
        expect(world.entities.get('victim')!.components
            .get(ControlledByComponent)).toEqual({ peerId: 'b' });
    });

    it('a fresh addEntity may not declare another peer as controller or owner',
        () => {
            const { world, serializer } = makeWorld();
            // A second hull answering to b's controls: findControlledEntity
            // takes the first match, so b's steering could land here.
            apply(world, 'a', [{
                kind: 'addEntity', uuid: 'decoy',
                entity: serializer.encode(new Entity('decoy')
                    .addComponent(ControlledByComponent, { peerId: 'b' })),
            }]);
            apply(world, 'a', [{
                kind: 'addEntity', uuid: 'decoy2',
                entity: serializer.encode(new Entity('decoy')
                    .addComponent(MultiplayerData, { owner: 'b' })),
            }]);
            expect(world.entities.has('decoy')).toBeFalse();
            expect(world.entities.has('decoy2')).toBeFalse();
            // Its own, and an unowned (NPC-style) hull: fine.
            apply(world, 'a', [{
                kind: 'addEntity', uuid: 'mine',
                entity: serializer.encode(new Entity('mine')
                    .addComponent(ControlledByComponent, { peerId: 'a' })
                    .addComponent(MultiplayerData, { owner: 'a' })),
            }, {
                kind: 'addEntity', uuid: 'npc',
                entity: serializer.encode(new Entity('npc')
                    .addComponent(Foo, { x: 5 })),
            }]);
            expect(world.entities.has('mine')).toBeTrue();
            expect(world.entities.has('npc')).toBeTrue();
        });

    it('the owner may replace its own entity (the relaunch path)', () => {
        const { world, serializer } = makeWorld();
        apply(world, 'a', [{
            kind: 'addEntity', uuid: 'own',
            entity: serializer.encode(new Entity('refit')
                .addComponent(Foo, { x: 42 })
                .addComponent(ControlledByComponent, { peerId: 'a' })),
        }]);
        expect(world.entities.get('own')!.components.get(Foo))
            .toEqual({ x: 42 });
    });

    it('no peer-authored input may name the singleton', () => {
        const { world, serializer } = makeWorld();
        apply(world, 'a', [
            { kind: 'removeEntity', uuid: 'singleton' },
            {
                kind: 'addEntity', uuid: 'singleton',
                entity: serializer.encode(new Entity('fake singleton')),
            },
        ]);
        expect(world.entities.has('singleton')).toBeTrue();
        expect(world.singletonEntity.name).toBe('singleton');
    });

    it('local play (no peerId) is unrestricted', () => {
        const { world } = makeWorld({ communicator: false });
        apply(world, undefined, [{ kind: 'removeEntity', uuid: 'victim' }]);
        expect(world.entities.has('victim')).toBeFalse();
    });

    it('a mission ship the peer may not insert is dropped from the batch; '
        + 'the rest of the acceptance applies', () => {
            const { world, serializer } = makeWorld();
            world.entities.get('own')!.components
                .set(MissionsComponent, new Map());
            apply(world, 'a', [{
                kind: 'acceptMission',
                accepted: {
                    missionId: 'nova:134',
                    mission: ActiveMissionType.encode({
                        id: 'nova:134', acceptedDay: 0, acceptedAt: 'nova:128',
                        travelPlanet: null, returnPlanet: null,
                        cargoType: -1, cargoQty: 0, cargoLoaded: false,
                        travelDone: false, deadlineDay: null,
                    }),
                    ships: [
                        // b's ship, under a copy answering to a.
                        {
                            uuid: 'victim',
                            entity: serializer.encode(new Entity('x')
                                .addComponent(ControlledByComponent, { peerId: 'a' })),
                        },
                        { uuid: 'fresh', entity: serializer.encode(new Entity('y')) },
                    ],
                },
            }]);
            expect(world.entities.get('victim')!.components.get(Foo))
                .toEqual({ x: 1 });
            expect(world.entities.has('fresh')).toBeTrue();
            expect(world.entities.get('own')!.components
                .get(MissionsComponent)!.has('nova:134')).toBeTrue();
        });
});

describe('malformed inputs', () => {
    it('one throwing input is dropped; the rest of the record applies', () => {
        const { world } = makeWorld();
        const bad = { kind: 'control', events: null } as unknown as SimulationInput;
        expect(() => apply(world, 'a', [
            bad,
            { kind: 'removeEntity', uuid: 'own' },
        ])).not.toThrow();
        expect(world.entities.has('own')).toBeFalse();
    });

    it('the input codec rejects every shape the relay used to forward', () => {
        for (const input of [
            { kind: 'control' },
            { kind: 'control', events: null },
            { kind: 'control', events: [{ action: 'accelerate' }] },
            { kind: 'analogControl', heading: 'up', throttle: 1 },
            { kind: 'addEntity', uuid: 'x', entity: {} },
            { kind: 'addEntity', uuid: 'x', entity: { components: 'no' } },
            { kind: 'removeEntity' },
            { kind: 'setJumpRoute', route: [1, 2] },
            { kind: 'removePeer', peerId: 7 },
            { kind: 'hail', action: { kind: 'bribe' } },
            { kind: 'acceptMission', accepted: { missionId: 3 } },
            { kind: 'teleport', to: [0, 0] },
            null, 'inputs', 42,
        ]) {
            expect(isLeft(SimulationInputType.decode(input)))
                .withContext(JSON.stringify(input)).toBeTrue();
        }
    });

    it('the record codec accepts the real shapes, strips junk, and bounds ticks',
        () => {
            const record = {
                peerId: 'a', tick: 5, seq: 2,
                inputs: [
                    { kind: 'control', events: [{ action: 'accelerate', state: 'start' }] },
                    { kind: 'analogControl', heading: null, throttle: 0.5 },
                    { kind: 'setTarget', target: null },
                    { kind: 'removeEntity', uuid: 'x' },
                    { kind: 'setJumpRoute', route: ['nova:130'] },
                    { kind: 'hail', action: { kind: 'bribe', target: 'x' } },
                    { kind: 'escortAction', action: { kind: 'releaseEscort', target: 'e' } },
                    { kind: 'addEntity', uuid: 'x', entity: { components: [['Foo', { x: 1 }]] } },
                    { kind: 'acceptMission', accepted: { missionId: 'nova:1', mission: null } },
                ],
                junk: 'x'.repeat(1000),
            };
            const decoded = InputRecordType.decode(record);
            expect(isRight(decoded)).toBeTrue();
            if (isRight(decoded)) {
                expect('junk' in decoded.right).toBeFalse();
                expect(decoded.right.inputs.length).toBe(9);
            }
            for (const tick of [-1, 1.5, 1e300, 'x', NaN]) {
                expect(isLeft(InputRecordType.decode({ ...record, tick })))
                    .withContext(`tick ${tick}`).toBeTrue();
            }
            expect(isLeft(InputRecordType.decode({ tick: 1, inputs: null })))
                .toBeTrue();
            expect(isLeft(InputRecordType.decode({ tick: 1 }))).toBeTrue();
        });
});
