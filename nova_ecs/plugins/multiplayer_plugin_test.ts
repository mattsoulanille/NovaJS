import { isDraft } from 'immer';
import * as t from 'io-ts';
import 'jasmine';
import { BehaviorSubject, Subject } from 'rxjs';
import { Entities, UUID } from '../arg_types';
import { Component } from '../component';
import { EntityBuilder } from '../entity';
import { System } from '../system';
import { World } from '../world';
import { applyObjectDelta, getObjectDelta } from './delta';
import { DeltaResource } from './delta_plugin';
import { Communicator, Message, multiplayer, MultiplayerData } from './multiplayer_plugin';

const BarComponent = new Component({
    name: "Bar",
    type: t.type({ y: t.string }),
    deltaType: t.partial({ y: t.string }),
    getDelta: getObjectDelta,
    applyDelta: applyObjectDelta
});

const NonMultiplayer = new Component<{ z: string }>({ name: 'NonMultiplayer' });

class MockCommunicator implements Communicator {
    peers = new BehaviorSubject(new Set<string>());
    messages = new Subject<unknown>();
    allMessages: unknown[] = [];

    constructor(public uuid: string | undefined,
        public mockPeers: Map<string, MockCommunicator> = new Map()) {
        this.messages.subscribe(message => this.allMessages.push(message));
    }

    sendMessage(message: Message, destination?: string) {
        const JSONified = JSON.parse(JSON.stringify(message)) as unknown;

        if (destination) {
            this.mockPeers.get(destination)?.messages.next(JSONified);
        } else {
            for (const peer of this.mockPeers.values()) {
                if (peer.uuid !== this.uuid) {
                    peer.messages.next(JSONified);
                }
            }
        }
    }
}

describe('Multiplayer Plugin', () => {
    let world1: World;
    let world2: World;
    let world1Communicator: MockCommunicator;
    let world2Communicator: MockCommunicator;

    beforeEach(() => {
        world1Communicator = new MockCommunicator('world1 uuid');
        world2Communicator = new MockCommunicator('world2 uuid');

        const mockPeers = new Map([
            [world1Communicator.uuid as string, world1Communicator],
            [world2Communicator.uuid as string, world2Communicator],
        ]);
        world1Communicator.mockPeers = mockPeers;
        world2Communicator.mockPeers = mockPeers;

        const peers = new Set([...mockPeers.keys()]);

        function error(message: string) {
            throw new Error(message);
        }
        world1 = new World('world1');
        world1.addPlugin(multiplayer(world1Communicator, error));

        world2 = new World('world2');
        world2.addPlugin(multiplayer(world2Communicator, error));

        world1Communicator.peers.next(peers);
        world2Communicator.peers.next(peers);

        world1.addComponent(BarComponent);
        world2.addComponent(BarComponent);

        const world1delta = world1.resources.get(DeltaResource)!;
        const world2delta = world2.resources.get(DeltaResource)!;

        world1delta.addComponent(BarComponent, { componentType: t.type({ y: t.string }) });
        world2delta.addComponent(BarComponent, { componentType: t.type({ y: t.string }) });
    });

    it('adds the comms component to the singleton entity', () => {
        expect([...world1.singletonEntity.components.keys()]
            .map(component => component.name)).toContain('Comms');
    });

    it('sends new entities that it owns', async () => {
        const reports: [string, string][] = [];

        const barSystem = new System({
            name: 'BarSystem',
            args: [BarComponent] as const,
            step: () => { },
            after: ['Multiplayer'],
        });
        world1.addSystem(barSystem);

        const reportSystem = new System({
            name: 'ReportSystem',
            args: [BarComponent, UUID] as const,
            step: (bar, uuid) => {
                reports.push([bar.y, uuid]);
            },
            after: ['Multiplayer'],
        });
        world2.addSystem(reportSystem);

        world1.entities.set('test entity uuid', new EntityBuilder()
            .addComponent(MultiplayerData, {
                owner: 'world1 uuid',
            })
            .addComponent(BarComponent, {
                y: 'a test component',
            }).build());

        world1.step();
        world2.step();

        expect(reports).toEqual([['a test component', 'test entity uuid']]);
    });

    it('sends updates when an entity changes', () => {
        const reports: string[] = [];

        const barSystem = new System({
            name: 'BarSystem',
            args: [BarComponent] as const,
            step: (bar) => {
                bar.y = bar.y + ' stepped';
            },
            after: ['Multiplayer'],
        });
        world1.addSystem(barSystem);

        const reportSystem = new System({
            name: 'ReportSystem',
            args: [BarComponent] as const,
            after: ['Multiplayer'],
            step: (bar) => {
                reports.push(bar.y);
            }
        });
        world2.addSystem(reportSystem);

        world1.entities.set('test entity uuid', new EntityBuilder()
            .addComponent(MultiplayerData, {
                owner: 'world1 uuid',
            })
            .addComponent(BarComponent, {
                y: 'a test component',
            }).build());

        world1.step();
        world2.step();

        world1.step();
        world2.step();

        world1.step();
        world2.step();

        expect(reports).toEqual([
            'a test component',
            'a test component stepped',
            'a test component stepped stepped',
        ]);
    });

    it('sends nothing if nothing has changed', () => {
        world1.step();
        world2.step();
        world1.step();
        world2.step();
        world1.step();
        world2.step();

        expect(world1Communicator.allMessages).toEqual([]);
        expect(world2Communicator.allMessages).toEqual([]);
    });

    it('removes entities that have been removed', () => {
        let remove = false;
        const removeBarSystem = new System({
            name: 'RemoveBarSystem',
            args: [Entities, UUID, BarComponent] as const,
            step: (entities, uuid) => {
                if (remove) {
                    entities.delete(uuid);
                }
            },
            before: ['Multiplayer'],
        });

        world1.addSystem(removeBarSystem);
        const testUuid = 'test entity uuid';
        world1.entities.set(testUuid, new EntityBuilder()
            .addComponent(MultiplayerData, {
                owner: 'world1 uuid',
            })
            .addComponent(BarComponent, {
                y: 'a test component',
            }).build());

        world1.step();
        world2.step();

        world1.step();
        world2.step();

        expect(world2.entities.get(testUuid)!.components.get(BarComponent))
            .toEqual(world1.entities.get(testUuid)!.components.get(BarComponent))

        remove = true;
        world1.step();
        world2.step();

        expect(world2.entities.get(testUuid)).toBeUndefined();
    });


    it('drafts components of entities it owns', () => {
        const testUuid = 'test entity uuid';
        world1.entities.set(testUuid, new EntityBuilder()
            .addComponent(MultiplayerData, {
                owner: 'world1 uuid',
            }).addComponent(BarComponent, {
                y: 'a test component',
            }).build());

        world1.step();

        const bar = world1.entities.get(testUuid)?.components.get(BarComponent);
        expect(isDraft(bar)).toBeTrue();
    });

    it('does not draft components of entities it does not own', () => {
        const testUuid = 'test entity uuid';
        world1.entities.set(testUuid, new EntityBuilder()
            .addComponent(MultiplayerData, {
                owner: 'not me',
            }).addComponent(BarComponent, {
                y: 'a test component',
            }).build());

        world1.step();

        const bar = world1.entities.get(testUuid)?.components.get(BarComponent);
        expect(isDraft(bar)).toBeFalse();
    });

    it('does not draft non-multiplayer components', () => {
        const testUuid = 'test entity uuid';
        world1.entities.set(testUuid, new EntityBuilder()
            .addComponent(MultiplayerData, {
                owner: 'world1 uuid',
            }).addComponent(BarComponent, {
                y: 'a test component',
            }).addComponent(NonMultiplayer, {
                z: 'not multiplayer'
            }).build());

        world1.step();

        const bar = world1.entities.get(testUuid)?.components.get(BarComponent);
        expect(isDraft(bar)).toBeTrue();

        const nonMultiplaer = world1.entities.get(testUuid)?.components.get(NonMultiplayer);
        expect(isDraft(nonMultiplaer)).toBeFalse();
    });
});
