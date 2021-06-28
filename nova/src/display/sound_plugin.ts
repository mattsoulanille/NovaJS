import { Plugin } from 'nova_ecs/plugin';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { GameData } from '../client/gamedata/GameData';
import { GameDataResource } from '../nova_plugin/game_data_resource';
import { SoundEvent } from '../nova_plugin/sound_event';


// TODO: Submunitions don't make sound because they just add projectiles.
// Perhaps refactor so subs fire with weapons?
const SoundSystem = new System({
    name: 'ProjectileSoundSystem',
    events: [SoundEvent],
    args: [SoundEvent, GameDataResource, SingletonComponent] as const,
    step(id, gameData) {
        const sound = (gameData as GameData).soundFromId(id);
        sound.play();
    }
});


export const SoundPlugin: Plugin = {
    name: 'SoundPlugin',
    build(world) {
        world.addSystem(SoundSystem);
    }
}
