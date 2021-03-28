import { Resource } from '../resource';
import { EcsEvent } from '../events';
import { Plugin } from '../plugin';


const KeyboardResource = new Resource<undefined>('KeyboardResource');

export const EcsKeyboardEvent = new EcsEvent<KeyboardEvent>('KeyboardEvent');
export const KeyboardPlugin: Plugin = {
    name: 'KeyboardPlugin',
    build: (world) => {
        // Only add once
        if (world.resources.has(KeyboardResource)) {
            return;
        }
        world.resources.set(KeyboardResource, undefined);


        function report(event: KeyboardEvent) {
            world.emit(EcsKeyboardEvent, event);
        }
        document.addEventListener('keydown', report);
        document.addEventListener('keyup', report);
    }
};
