import { isLeft } from 'fp-ts/lib/Either';
import * as t from 'io-ts';
import 'jasmine';
import { UUID } from '../arg_types';
import { Component } from '../component';
import { Entity } from '../entity';
import { System } from '../system';
import { World } from '../world';
import { Communicator, Message, multiplayer, MultiplayerData } from './multiplayer_plugin';


// TODO: Test delta deserialization.
const BarComponent = new Component<{ y: string }, { y: string }, { y: string }, { y: string }>({
    name: "Bar",
    type: t.type({ y: t.string }),
    getDelta: (a, b) => {
        if (a.y !== b.y) {
            return { y: b.y };
        }
        return;
    },
    applyDelta: (data, delta) => {
        data.y = delta.y
    },
});

class MockCommunicator implements Communicator {
    incomingMessages: Message[] = [];
    constructor(public uuid: string | undefined,
        public peers: Map<string, MockCommunicator> = new Map()) { }

    sendMessage(message: Message, destination?: string) {
        const JSONified = Message.decode(JSON.parse(JSON.stringify(message)));
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
            before: ['SendChanges'],
            after: ['ApplyChanges'],
        });
        world1.addSystem(barSystem);

        const reportSystem = new System({
            name: 'ReportSystem',
            args: [BarComponent, UUID] as const,
            step: (bar, uuid) => {
                reports.push([bar.y, uuid]);
            },
            before: ['SendChanges'],
            after: ['ApplyChanges'],
        });
        world2.addSystem(reportSystem);

        world1.addEntity(new Entity({ uuid: 'test entity uuid' })
            .addComponent(MultiplayerData, {
                owner: 'world1 uuid',
            })
            .addComponent(BarComponent, {
                y: 'a test component',
            }));

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
            after: ['ApplyChanges'],
            before: ['SendChanges'],
        });
        world1.addSystem(barSystem);

        const reportSystem = new System({
            name: 'ReportSystem',
            args: [BarComponent] as const,
            after: ['ApplyChanges'],
            before: ['SendChanges'],
            step: (bar) => {
                reports.push(bar.y);
            }
        });
        world2.addSystem(reportSystem);

        world1.addEntity(new Entity({ uuid: 'test entity uuid' })
            .addComponent(MultiplayerData, {
                owner: 'world1 uuid',
            })
            .addComponent(BarComponent, {
                y: 'a test component',
            }));

        world1.step();
        world2.step();

        world1.step();
        world2.step();

        world1.step();
        world2.step();

        expect(reports).toEqual([
            'a test component stepped',
            'a test component stepped stepped',
            'a test component stepped stepped stepped',
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
});
