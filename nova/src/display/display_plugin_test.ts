import { Animation } from "novadatainterface/Animation";
import { Defaults } from 'novadatainterface/Defaults';
import { MockGameData } from 'novadatainterface/MockGameData';
import { EntityBuilder } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { GameDataResource } from '../nova_plugin/game_data_resource';
import { AnimationComponent, Display, Stage } from './display_plugin';
import * as PIXI from 'pixi.js';
import { PixiAppResource } from "./pixi_app_resource";

describe('display plugin', () => {
    let world: World
    let gameData: MockGameData;
    let stage: PIXI.Container;

    beforeEach(() => {
        world = new World();
        gameData = new MockGameData();
        world.resources.set(GameDataResource, gameData);
        world.resources.set(PixiAppResource, new PIXI.Application());
        world.addPlugin(Display);
        stage = world.resources.get(Stage)!;
    });

    // TODO: Write mocks to enable testing this.
    xit('does not add a sprite to the stage if the entity is gone', async () => {
        const animation: Animation = {
            id: 'test:128',
            exitPoints: Defaults.Ship.animation.exitPoints,
            images: Defaults.Ship.animation.images,
            name: 'test animation',
            prefix: 'test',
        }

        const testEntity = new EntityBuilder()
            .addComponent(AnimationComponent, animation)

        const spriteSheetFrames = await gameData.data.SpriteSheetFrames.get('test:128');

        let fulfillWait: (value?: unknown) => void;
        const waitPromise = new Promise((fulfill) => {
            fulfillWait = fulfill;
        });

        spyOn(gameData.data.SpriteSheetFrames, 'get').and.callFake(async () => {
            await waitPromise;
            return spriteSheetFrames;
        })

        world.entities.set('testEntity', testEntity);
        world.step();

        //world.entities.delete('testEntity');
        world.step();

        fulfillWait!();
        world.step()

        debugger;
        expect(stage.children.length).toBe(0);


    });
});
