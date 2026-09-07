import * as t from 'io-ts';
import { isLeft } from 'fp-ts/lib/Either.js';
import { Emit } from 'nova_ecs/arg_types';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { EcsKeyboardEvent } from 'nova_ecs/plugins/keyboard_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { Subject } from 'rxjs';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import { ControlAction, Controls, getActions, SavedControls } from './controls.js';
import { SimulationGameDataResource } from './game_data_resource.js';
import { PlatformResource } from './platform_plugin.js';

/**
 * The active pilot's rebindings layered over the served defaults.
 *
 * Imported on demand rather than at module load: title/pilot_registry
 * decodes pilot records with the save codec (pilot/save_game), which
 * sits at the top of the domain graph and reaches back down to this
 * module. A static import here would close a module cycle core → title
 * → session → escorts → core, and since a domain's index evaluates the
 * whole domain, whichever module first touched the cycle would find the
 * save codec still uninitialized. Only the browser main thread reads
 * pilot storage, so only it pays for the import.
 */
async function mergePilotControls(controlsJson: Record<string, unknown>):
    Promise<Record<string, unknown>> {
    const [{ mergeControls }, { loadPilotControls }] = await Promise.all([
        import('../../title/client_prefs.js'),
        import('../../title/pilot_registry.js'),
    ]);
    return mergeControls(controlsJson, loadPilotControls());
}

export interface ControlEvent {
    action: ControlAction,
    state: false | 'start' | 'repeat',
}

export const ControlsResource = new Resource<Controls>('ControlsResource');
export const EcsControlEvent = new EcsEvent<ControlEvent[]>('ControlEvent');
export const ControlsSubject = new Resource<Subject<ControlEvent>>('ControlsObservable');
export const ControlEventType = t.type({
    action: ControlAction,
    state: t.union([t.literal(false), t.literal('start'), t.literal('repeat')]),
});
export const EcsControlEventType = t.array(ControlEventType);

registerSimulationBridgeEvent({ event: EcsControlEvent });

const ControlEventSystem = new System({
    name: 'ControlEventSystem',
    events: [EcsKeyboardEvent],
    args: [EcsKeyboardEvent, ControlsSubject, ControlsResource,
        Emit, SingletonComponent] as const,
    step(keyboardEvent, controlsSubject, controls, emit) {
        const actions = getActions(controls, keyboardEvent);

        const controlEvents: ControlEvent[] = [];
        for (const action of actions) {
            const controlEvent: ControlEvent = {
                action,
                state: keyboardEvent.type === 'keyup' ? false
                    : keyboardEvent.repeat ? 'repeat' : 'start',
            }

            controlEvents.push(controlEvent);
        }
        emit(EcsControlEvent, controlEvents);
        for (const event of controlEvents) {
            controlsSubject.next(event);
        }
    }
});

export const ControlsPlugin: Plugin = {
    name: 'ControlsPlugin',
    async build(world) {
        world.resources.set(ControlsSubject, new Subject());
        world.resources.get(SerializerResource)?.addEvent(EcsControlEvent, EcsControlEventType);

        const platform = world.resources.get(PlatformResource);
        if (platform === 'browser' || platform === 'worker') {
            const gameData = world.resources.get(SimulationGameDataResource) as SimulationGameDataInterface;
            if (!gameData) {
                throw new Error('Expected world to have gameData');
            }
            if (!gameData.getSettings) {
                throw new Error('Expected simulation game data to provide getSettings');
            }
            const controlsJson = await gameData.getSettings('controls.json');
            // On the client, layer the active pilot's rebindings over the
            // served defaults so this resource agrees with the map
            // browser.ts matches against; otherwise a world built here
            // would answer to the stock keys the player rebound away.
            // Only on 'browser': the worker sim must not read
            // client-local storage, and it never matches keys itself
            // (control events reach it as already-resolved actions).
            const merged = platform === 'browser'
                ? await mergePilotControls(controlsJson as Record<string, unknown>)
                : controlsJson;
            const decoded = SavedControls.pipe(Controls).decode(merged);
            if (isLeft(decoded)) {
                console.error(decoded.left);
                throw new Error('Failed to parse controls');
            }
            world.resources.set(ControlsResource, decoded.right);
            if (platform === 'browser') {
                world.addSystem(ControlEventSystem);
            }
            return;
        }
    }
}
