import { isLeft } from 'fp-ts/lib/Either';
import { isDraft } from 'immer';
import * as t from 'io-ts';
import 'jasmine';
import { Entities, UUID } from '../arg_types';
import { Component } from '../component';
import { EntityBuilder } from '../entity';
import { System } from '../system';
import { World } from '../world';
import { applyObjectDelta, getObjectDelta } from './delta';
import { Communicator, Message, multiplayer, MultiplayerData } from './multiplayer_plugin';


// TODO: Test delta deserialization.
const BarComponent = new Component({
    name: "Bar",
    type: t.type({ y: t.string }),
    deltaType: t.partial({ y: t.string }),
    getDelta: getObjectDelta,
    applyDelta: applyObjectDelta
});

class MockCommunicator implements Communicator {
    incomingMessages: Message[] = [];
    constructor(public uuid: string | undefined,
        public peers: Map<string, MockCommunicator> = new Map()) { }

    sendMessage(message: Message, destination?: string) {
        const JSONified = Message.decode(JSON.parse(JSON.stringify(message)) as unknown);
        if (isLeft(JSONified)) {
            throw new Error(`JSON failed to parse: ${JSONified.left}`);
        }

        const copied = JSONified.right;

        if (destination) {
            this.peers.get(destination)?.incomingMessages.push(copied);
        } else {
            for (const peer of this.peers.values()) {
                if (peer.uuid !== this.uuid) {
                    peer.incomingMessages.push(copied);
                }
            }
        }
    }

    getMessages() {
        const messages = this.incomingMessages;
        this.incomingMessages = [];
        return messages;
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

        const communicators = new Map([
            [world1Communicator.uuid as string, world1Communicator],
            [world2Communicator.uuid as string, world2Communicator],
        ]);
        world1Communicator.peers = communicators;
        world2Communicator.peers = communicators;

        world1 = new World('world1');
        world1.addPlugin(multiplayer(world1Communicator));

        world2 = new World('world2');
        world2.addPlugin(multiplayer(world2Communicator));

        world1.addComponent(BarComponent);
        world2.addComponent(BarComponent);
    });

    it('adds the comms component to the singleton entity', () => {
        expect([...world1.singletonEntity.components.keys()]
            .map(component => component.name)).toContain('Comms');
    });

    it('sends new entities that it owns', () => {
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

        expect(world1Communicator.incomingMessages).toEqual([]);
        expect(world2Communicator.incomingMessages).toEqual([]);
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
});
