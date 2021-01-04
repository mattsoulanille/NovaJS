import * as t from 'io-ts';
import 'jasmine';
import { UUID } from '../arg_types';
import { Component } from '../component';
import { Entity } from '../entity';
import { System } from '../system';
import { World } from '../world';
import { Message, multiplayer, MultiplayerData } from './multiplayer_plugin';


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

describe('Multiplayer Plugin', () => {
    let toWorld1: Message[][];
    let toWorld2: Message[][];
    let world1: World;
    let world2: World;

    beforeEach(() => {
        toWorld1 = [[]];
        toWorld2 = [[]];
        world1 = new World('world1');
        world1.addPlugin(multiplayer(() => {
            const messages = toWorld1[toWorld1.length - 1];
            if (messages.length !== 0) {
                toWorld1.push([]);
            }
            return messages;
        }, (message) => {
            // Sometimes the engine edits messages, so they must be new objects.
            const JSONified = JSON.parse(JSON.stringify(message));
            toWorld2[toWorld2.length - 1].push(JSONified);
        }, 'world1 uuid'));

        world2 = new World('world2');
        world2.addPlugin(multiplayer(() => {
            const messages = toWorld2[toWorld2.length - 1];
            if (messages.length !== 0) {
                toWorld2.push([]);
            }
            return messages;
        }, (message) => {
            // Sometimes the engine edits messages, so they must be new objects.
            const JSONified = JSON.parse(JSON.stringify(message));
            toWorld1[toWorld1.length - 1].push(JSONified);
        }, 'world2 uuid'));
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

        expect(reports).toEqual([
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

        expect(toWorld1).toEqual([[]]);
        expect(toWorld2).toEqual([[]]);
    });
});
