import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { GameDataResource } from "../nova_plugin/game_data_resource";
import { texturesFromFrames } from "./textures_from_frames";
import { Resource } from "nova_ecs/resource";
import { PixiAppResource } from "./pixi_app_resource";
// The system boundary should probably not be defined in position.ts.
// This is the distance from the center of the system to the boundary.
// The system width and height are both 2*BOUNDARY
import { BOUNDARY } from "nova_ecs/datatypes/position";
import { Space } from "./space_resource";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin";

const STAR_ID = "nova:700";

interface StarfieldArgs {
    textures: PIXI.Texture[],
    renderer: PIXI.Renderer | PIXI.AbstractRenderer,
    layers: number,
    density: number,
    positionFactorRange: [number, number],
}

class Starfield {
    private textures: PIXI.Texture[];
    private layers: number;
    private density: number;
    private positionFactorRange: [number, number];
    container = new PIXI.Container();
    private layerSprites: PIXI.Sprite[] = [];
    private placeholderText = new PIXI.Text('This is a starfield');

    constructor({ textures, renderer, layers, density, positionFactorRange }: StarfieldArgs) {
        this.textures = textures;
        this.layers = layers;
        this.density = density;
        this.positionFactorRange = positionFactorRange;

        const starSprites = textures.map(starTexture => new PIXI.Sprite(starTexture));


        // Example starfield with none of the cool features
        // TODO: Issue #102
        const baseRenderTexture = new PIXI.BaseRenderTexture({ width: 1000, height: 1000 });
        const renderTexture = new PIXI.RenderTexture(baseRenderTexture);
        for (let i = 0; i < 10000; i++) {
            const starSprite = starSprites[Math.floor(Math.random() * starSprites.length)];
            starSprite.position.x = Math.random() * 1000;
            starSprite.position.y = Math.random() * 1000;
            renderer.render(starSprite, { renderTexture, clear: false });
        }

        const firstLayer = new PIXI.Sprite(renderTexture);
        this.container.addChild(firstLayer);
        this.layerSprites = [firstLayer];
    }

    draw(_playerPosition: { x: number, y: number }) {
        // TODO
    }
}

const StarfieldResource = new Resource<Starfield>('Starfield');

export function starfield({ layers = 8, density = 0.00002,
    positionFactorRange = [0.2, 0.8] as [number, number] } = {}): Plugin {

    const StarfieldSystem = new System({
        name: 'StarfieldSystem',
        args: [MovementStateComponent, StarfieldResource,
            PlayerShipSelector] as const,
        step(movementState, starfield) {
            starfield.draw(movementState.position);
        }
    });

    return {
        name: 'Starfield',
        async build(world) {
            const stage = world.resources.get(Space);
            if (!stage) {
                throw new Error('Expected Stage resource to exist');
            }
            const gameData = world.resources.get(GameDataResource);
            if (!gameData) {
                throw new Error('Expected GameData resource to exist');
            }
            const app = world.resources.get(PixiAppResource);
            if (!app) {
                throw new Error('Expected PixiApp resource to exist');
            }


            const { frames } = await gameData.data.SpriteSheetFrames.get(STAR_ID);
            const textures = await texturesFromFrames(frames);
            const renderer = app.renderer;
            const starfield = new Starfield({
                textures,
                renderer,
                layers,
                density,
                positionFactorRange,
            });

            stage.addChild(starfield.container);
            world.resources.set(StarfieldResource, starfield);
            world.addSystem(StarfieldSystem);
        }
    }
}
