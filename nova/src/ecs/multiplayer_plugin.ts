import { Component } from './component';
import { Plugin } from './plugin';
import { Resource } from './resource';
import { UUID, World } from './world';
import * as t from 'io-ts';
import { System } from './system';
import { Query } from './query';

export const MultiplayerComponent = new Component({
    name: 'multiplayer',
    getDelta() { return undefined },
    applyDelta() { },
    type: t.record(t.string, t.unknown),
});

const CommsComponent = new Component({
    name: 'comms',
    getDelta() { return undefined },
    applyDelta() { },
    type: t.undefined,
});

export function multiplayer(): Plugin {
    const multiplayerSystem = new System({
        name: 'MultiplayerComms',
        args: [new Query([MultiplayerComponent, UUID]), CommsComponent] as const,
        step: (multiplayerComponents) => {





        }
    });

    function build(world: World) {
        world.commands.addEntity(new Entity

    }

    return {
        name: 'multiplayer',
        build
    }
}
