// The system boundary should probably not be defined in position.ts.
// This is the distance from the center of the system to the boundary.
// The system width and height are both 2*BOUNDARY
import { Texture } from "@pixi/core";
import { Container } from "@pixi/display";
import { Graphics } from "@pixi/graphics";
import { Sprite } from "@pixi/sprite";
import { BOUNDARY } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import RBush, { BBox } from "rbush";
import { alea } from 'seedrandom';
import { GameDataResource } from "../nova_plugin/game_data_resource";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin";
import { ResizeEvent } from "./screen_size_plugin";
import { Stage } from "./stage_resource";
import { texturesFromFrames } from "./textures_from_frames";

const STAR_ID = "nova:700";

interface StarfieldArgs {
    textures: Texture[],
    density: number,
    positionFactorRange: [number, number],
    seed?: string,
}

interface Star extends BBox {
    sprite: Sprite,
    position: Vector,
    factor: number,
}

class Starfield {
    private textures: Texture[];
    private positionFactorRange: [number, number];
    container = new Container();
    private rbush = new RBush<Star>();
    private screen = { width: 100, height: 100 };
    private graphics = new Graphics();
    private fudge: number;
    private random: () => number;
    private visibleStars: Star[] = [];

    constructor({ textures, density, positionFactorRange, seed }: StarfieldArgs) {
        this.textures = textures;
        this.positionFactorRange = positionFactorRange;
        this.container.addChild(this.graphics);
        const count = density * (2 * BOUNDARY) ** 2;
        //this.container.name = 'Starfield';

        this.random = alea(seed ?? 'stars');
        for (let i = 0; i < count; i++) {
            this.rbush.insert(this.makeStar());
        }

        this.fudge = Math.max(
            ...this.textures.map(t => Math.max(t.width, t.height))) + 1;
    }

    private sampleRange(min: number, max: number) {
        return this.random() * (max - min) + min
    }

    private makeStar(): Star {
        const texture = this.textures[
            Math.floor(this.random() * this.textures.length)];
        const sprite = new Sprite(texture);
        sprite.visible = false;
        this.container.addChild(sprite);
        // TODO: not uniform
        const factor = this.sampleRange(...this.positionFactorRange);

        const maxDistance = BOUNDARY * (1 - factor);

        const position = new Vector(
            this.sampleRange(-maxDistance, maxDistance),
            this.sampleRange(-maxDistance, maxDistance),
        );

        return {
            ...this.getBBox(position, factor),
            position,
            sprite,
            factor,
        }
    }

    private getBBox(position: Vector, factor: number): BBox {
        // Sprite position when shipPos === spritePos.
        // Given: spritePos = pos + shipPos * factor
        // And:   ship === sprite
        // Then:  spritePos = pos / (1 - factor)
        const spritePos = position.scale(1 / (1 - factor));

        // Hitbox size scales depending on factor and screen size.
        // Start the ship at the star and move to where the star is at the edge.
        // Then the bbox radius is how far from that star a star with factor 0 would be,
        // since that's where we're testing the collision from.
        // Let everything start at the origin.
        // Then, we can solve for starPos to get distance from a star with factor 0:
        //     starPos = shipPos * factor
        //     shipPos - starPos = screenWidth / 2
        //     shipPos * (1 - factor) = screenWidth / 2
        //     shipPos = screenWidth / (2 * (1 - factor))
        //     starPos = factor * screenWidth / (2 * (1 - factor))

        const hitboxX = factor * this.screen.width / (2 * (1 - factor));
        const hitboxY = factor * this.screen.height / (2 * (1 - factor));
        return {
            minX: spritePos.x - hitboxX,
            minY: spritePos.y - hitboxY,
            maxX: spritePos.x + hitboxX,
            maxY: spritePos.y + hitboxY,
        }
    }

    draw(shipPos: Vector) {
        const { x, y } = shipPos;
        const screenBBox: BBox = {
            minX: x - this.screen.width / 2,
            minY: y - this.screen.height / 2,
            maxX: x + this.screen.width / 2,
            maxY: y + this.screen.height / 2,
        }

        // Hide stars from the last frame
        for (const star of this.visibleStars) {
            star.sprite.visible = false;
        }
        this.visibleStars = this.rbush.search(screenBBox);

        for (const star of this.visibleStars) {
            const spritePos = star.position
                .add(shipPos.scale(star.factor))
                .subtract(shipPos);

            star.sprite.position.x = spritePos.x;
            star.sprite.position.y = spritePos.y;
            star.sprite.visible = true;
        }
    }

    resize(width: number, height: number) {
        this.screen.width = width + this.fudge * 2;
        this.screen.height = height + this.fudge * 2;
        this.container.position.x = this.screen.width / 2 - this.fudge;
        this.container.position.y = this.screen.height / 2 - this.fudge;

        const stars = this.rbush.all();
        this.rbush.clear();
        for (const star of stars) {
            const bbox = this.getBBox(star.position, star.factor);
            star.minX = bbox.minX;
            star.minY = bbox.minY;
            star.maxX = bbox.maxX;
            star.maxY = bbox.maxY;
            star.sprite.visible = false;
        }
        this.rbush.load(stars);

        // this.graphics.clear();
        // this.graphics.lineStyle(1, 0xff0000, 0.5);
        // this.graphics.drawRect(-this.screen.width / 2, -this.screen.height / 2, this.screen.width, this.screen.height);
    }
}

const StarfieldResource = new Resource<Starfield>('Starfield');

export function starfield({ density = 0.00002,
    positionFactorRange = [0, 0.5] as [number, number] } = {}): Plugin {

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
        step(starfield, { x, y }) {
            starfield.resize(x, y);
        }
    });

    return {
        name: 'Starfield',
        async build(world) {
            const gameData = world.resources.get(GameDataResource);
            if (!gameData) {
                throw new Error('Expected GameData resource to exist');
            }
            // const app = world.resources.get(PixiAppResource);
            // if (!app) {
            //     throw new Error('Expected PixiApp resource to exist');
            // }
            const stage = world.resources.get(Stage);
            if (!stage) {
                throw new Error('Expected Stage resource to exist');
            }

            const { frames } = await gameData.data.SpriteSheetFrames.get(STAR_ID);
            const textures = texturesFromFrames(frames);
            const starfield = new Starfield({
                textures,
                density,
                positionFactorRange,
                seed: world.name,
            });

            //starfield.resize(app.screen.width, app.screen.height);
            starfield.resize(window.innerWidth, window.innerHeight);
            stage.addChildAt(starfield.container, 0);
            world.resources.set(StarfieldResource, starfield);
            world.addSystem(StarfieldResize);
            world.addSystem(StarfieldSystem);
        },
        remove(world) {
            world.removeSystem(StarfieldResize);
            world.removeSystem(StarfieldSystem);

            const starfield = world.resources.get(StarfieldResource);
            const stage = world.resources.get(Stage);
            if (starfield && stage) {
                console.log('removing starfield');
                stage.removeChild(starfield.container);
            }
            world.resources.delete(StarfieldResource);
        }
    }
}
