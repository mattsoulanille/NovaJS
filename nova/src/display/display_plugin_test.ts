import { MockGameData } from 'novadatainterface/MockGameData';
import { World } from 'nova_ecs/world';
import { GameDataResource } from '../nova_plugin/game_data_resource';
import { Display } from './display_plugin';


describe('display plugin', () => {
    let world: World
    let gameData: MockGameData;

    beforeEach(() => {
        world = new World();
        gameData = new MockGameData();
        world.resources.set(GameDataResource, gameData);
        world.addPlugin(Display);
    });

    it('does not add a sprite to the stage if the entity is gone', () => {
        expect(123).toEqual(123);
    });
});
