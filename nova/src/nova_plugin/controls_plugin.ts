import { isLeft } from 'fp-ts/lib/Either';
import { Emit } from 'nova_ecs/arg_types';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { EcsKeyboardEvent } from 'nova_ecs/plugins/keyboard_plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { Subject } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';
import { ControlAction, Controls, getActions, SavedControls } from './controls';
import { GameDataResource } from './game_data_resource';
import { PlatformResource } from './platform_plugin';


export interface ControlEvent {
    action: ControlAction,
    state: false | 'start' | 'repeat',
}

export const ControlsResource = new Resource<Controls>('ControlsResource');
export const EcsControlEvent = new EcsEvent<ControlEvent>('ControlEvent');
export const ControlsSubject = new Resource<Subject<ControlEvent>>('ControlsObservable');

const ControlEventSystem = new System({
    name: 'ControlEventSystem',
    events: [EcsKeyboardEvent],
    args: [EcsKeyboardEvent, ControlsSubject, ControlsResource,
        Emit, SingletonComponent] as const,
    step(keyboardEvent, controlsSubject, controls, emit) {
        const actions = getActions(controls, keyboardEvent);

        for (const action of actions) {
            const controlEvent: ControlEvent = {
                action,
                state: keyboardEvent.type === 'keyup' ? false
                    : keyboardEvent.repeat ? 'repeat' : 'start',
            }

            emit(EcsControlEvent, controlEvent);
            controlsSubject.next(controlEvent);
        }
    }
});

export const ControlsPlugin: Plugin = {
    name: 'ControlsPlugin',
    async build(world) {
        world.resources.set(ControlsSubject, new Subject());

        const platform = world.resources.get(PlatformResource);
        if (platform === 'browser') {
            const gameData = world.resources.get(GameDataResource) as GameData;
            if (!gameData) {
                throw new Error('Expected world to have gameData');
            }
            const controlsJson = await gameData.getSettings('controls.json');
            const decoded = SavedControls.pipe(Controls).decode(controlsJson);
            if (isLeft(decoded)) {
                console.error(decoded.left);
                throw new Error('Failed to parse controls');
            }
            world.resources.set(ControlsResource, decoded.right);
            world.addSystem(ControlEventSystem);
        }
    }
}
