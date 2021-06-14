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
import { ResizeEvent } from "./resize_event";

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
    //private layerSprites: PIXI.Sprite[] = [];
    //private placeholderText = new PIXI.Text('This is a starfield');
    private graphics = new PIXI.Graphics();
    private shaderCode = `
    precision mediump float;
    uniform vec2 pos;
    uniform sampler2D star;

    float modu(float a, float b) {
        return (b * fract(a / b));
    }
    float heck(float x, float y) {
        return fract(sin(x*1742.3231)*1313.0842+cos(y*179.48222)*18321.2);
    }
    void main() {

        //gl_FragColor = vec4(gl_FragCoord.x / 1000.0, 0.0, 0.0, 1.0);
        //gl_FragColor = vec4(pos.x / 1000.0, pos.y / 1000.0, 0.05, 1.0);
        float posx = gl_FragCoord.x + pos.x*0.5;
        float posy = gl_FragCoord.y - pos.y*0.5;
    
        float u = floor(modu(posx, 50.0))+0.5;
        float v = floor(modu(posy, 50.0))+0.5;
        
        float starcox = floor(posx/50.0);
        float starcoy = floor(posy/50.0);
        
        //float u = gl_FragCoord.x + pos.x;
        //float v = gl_FragCoord.y + pos.y;
        float starx = floor(heck(starcox,starcoy)*10.0);
        float stary = floor(heck(starcox+0.5,starcoy+0.5)*2.0);
        float nu = starx*5.0+clamp(u,0.0,5.0);
        float nv = stary*5.0+clamp(v,0.0,5.0);
        float inStar = step(0.0,u)*step(0.0,5.0-u)*step(0.0,v)*step(0.0,5.0-v);
        vec2 relPos = vec2(nu/50.0, nv/10.0);
        gl_FragColor = texture2D(star,  relPos)*inStar;
    }
    `;
    private uniforms: Record<string, any>;
    private filter: PIXI.Filter;

    constructor({ textures, layers, density, positionFactorRange }: StarfieldArgs) {
        this.textures = textures;
        this.uniforms = {
            star: this.textures[0],
            pos: new PIXI.Point(0, 0),
        };
        this.filter = new PIXI.Filter('', this.shaderCode, this.uniforms);
        this.layers = layers;
        this.density = density;
        this.positionFactorRange = positionFactorRange;
        this.container.filters = [this.filter];
        this.container.addChild(this.graphics);
        //const starSprites = textures.map(starTexture => new PIXI.Sprite(starTexture));


        // Example starfield with none of the cool features
        // TODO: Issue #102
        // const baseRenderTexture = new PIXI.BaseRenderTexture({ width: 1000, height: 1000 });
        // const renderTexture = new PIXI.RenderTexture(baseRenderTexture);
        // for (let i = 0; i < 10000; i++) {
        //     const starSprite = starSprites[Math.floor(Math.random() * starSprites.length)];
        //     starSprite.position.x = Math.random() * 1000;
        //     starSprite.position.y = Math.random() * 1000;
        //     renderer.render(starSprite, { renderTexture, clear: false });
        // }

        // const firstLayer = new PIXI.Sprite(renderTexture);
        // this.container.addChild(firstLayer);
        // this.layerSprites = [firstLayer];
    }

    draw(playerPosition: { x: number, y: number }) {
        this.uniforms.pos.x = playerPosition.x;
        this.uniforms.pos.y = playerPosition.y;
    }

    resize(x: number, y: number) {
        this.graphics.clear();
        this.graphics.lineStyle(1, 0xffffff);
        this.graphics.moveTo(0, 0);
        this.graphics.lineTo(x, y);
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

    const StarfieldResize = new System({
        name: 'StarfieldResize',
        events: [ResizeEvent],
        args: [StarfieldResource, ResizeEvent] as const,
        step(starfield, resize) {
            starfield.resize(...resize);
        }
    });

    return {
        name: 'Starfield',
        async build(world) {
            // const stage = world.resources.get(Space);
            // if (!stage) {
            //     throw new Error('Expected Stage resource to exist');
            // }
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
            starfield.resize(app.screen.width, app.screen.height);
            app.stage.addChild(starfield.container);
            world.resources.set(StarfieldResource, starfield);
            world.addSystem(StarfieldResize);
            world.addSystem(StarfieldSystem);
        }
    }
}
