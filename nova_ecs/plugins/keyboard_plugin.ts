import { Resource } from '../resource';
import { EcsEvent } from '../events';
import { Plugin } from '../plugin';


const KeyboardResource = new Resource<undefined>('KeyboardResource');

const prevented = new Set(['Tab']);

export const EcsKeyboardEvent = new EcsEvent<KeyboardEvent>('KeyboardEvent');
const KeyReportResource = new Resource<(event: KeyboardEvent) => void>('KeyReportResource');

export const KeyboardPlugin: Plugin = {
    name: 'KeyboardPlugin',
    build(world) {
        // Only add once
        if (world.resources.has(KeyboardResource)) {
            return;
        }
        world.resources.set(KeyboardResource, undefined);

        function report(event: KeyboardEvent) {
            if (prevented.has(event.key)) {
                event.preventDefault();
            }
            world.emit(EcsKeyboardEvent, event);
        }
        document.addEventListener('keydown', report);
        document.addEventListener('keyup', report);
        if (world.resources.has(KeyReportResource)) {
            throw new Error('World already had KeyReportResource');
        }
        world.resources.set(KeyReportResource, report);
    },
    remove(world) {
        const report = world.resources.get(KeyReportResource);
        if (report) {
            document.removeEventListener('keydown', report);
            document.removeEventListener('keyup', report);
        }
    }
};
