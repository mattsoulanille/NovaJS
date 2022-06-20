import { Sound } from '@pixi/sound';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { GameData } from '../client/gamedata/GameData';
import { GameDataResource } from '../nova_plugin/game_data_resource';
import { SoundEvent } from '../nova_plugin/sound_event';

const LoopingSounds = new Resource<Map<string, Sound>>('LoopingSounds');
const VolumeResource = new Resource<{volume: number}>('VolumeResource');

const SoundSystem = new System({
    name: 'SoundSystem',
    events: [SoundEvent],
    args: [SoundEvent, GameDataResource, LoopingSounds, VolumeResource,
           SingletonComponent] as const,
    step({ id, loop }, gameData, loopingSounds, {volume}) {
        if (loop && loopingSounds.has(id)) {
            return;
        }

        const maybeSound = (gameData as GameData).data.Sound.getCached(id);
        if (maybeSound) {
            maybeSound.volume = volume;
            if (loop) {
                loopingSounds.set(id, maybeSound);
                maybeSound.play(() => {
                    loopingSounds.delete(id);
                });
            } else {
                maybeSound.play();
            }
        }
    }
});

export const SoundPlugin: Plugin = {
    name: 'SoundPlugin',
    build(world) {
        world.resources.set(LoopingSounds, new Map());
        world.resources.set(VolumeResource, {volume: 0.045});
        world.addSystem(SoundSystem);
    },
    remove(world) {
        world.removeSystem(SoundSystem);
        world.resources.delete(VolumeResource);
        world.resources.delete(LoopingSounds);
    }
}
